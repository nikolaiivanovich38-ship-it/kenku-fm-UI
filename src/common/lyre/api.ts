/**
 * LyreApi (WP5, wave 3): the one way the new interface's screens read and change the library.
 *
 * Shapes come from src/common/domain (DAT-12) plus the extra fields the screens show. Every call is async: the
 * real implementation runs in the main process behind IPC, the fake (fake.ts) in memory. Every write resolves to
 * what changed, or to a refusal a screen can show as it is (`refusal.message` is plain words for the game master).
 * Writes never throw for something the game master did; a thrown error means a fault (a lost connection, a bug).
 * After every write the API sends a "changed" event naming the areas to reload (see `subscribe`).
 *
 * Each method names the prototype action it serves (design/prototype/src/views/<file>.js, `L.acts.<name>` or
 * `L.inputs.<name>`), so the contract stays as small as the screens need.
 * Times are milliseconds; volumes are 0 to 1.
 */
import type {
  AudioProfileInput,
  DomainCampaign,
  DomainPlaylist,
  DomainScene,
  DomainSession,
  DomainTrack,
  Lane,
  PadMode,
  PlaylistRule,
  ProfileOverrides,
  ProfilePlace,
  SoundRef,
  TrackKind,
  TrackRole,
  LoopAdvice,
  Use,
} from "../domain";

/* ---------- results, refusals and events ---------- */

/** Why a write was refused. Screens choose what to offer by code and show `message`. */
export const REFUSAL_CODES = [
  /** The thing named no longer exists (another window deleted it, or an old link). */
  "not-found",
  /** A value the library cannot take (an empty name, an end before its start, a grid of 9 columns). */
  "invalid",
  /** The thing is the wrong kind for this (adding tracks to a dynamic playlist, music as a scene's ambience). */
  "wrong-kind",
  /** Undo or Redo with nothing to undo or redo. */
  "nothing-to-undo",
  "nothing-to-redo",
  /** Watching a folder Lyre already watches. */
  "already-watched",
  /** The track's file is not where the library expects it. */
  "file-missing",
  /** Another import is still running. */
  "busy",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  code: RefusalCode;
  /** Plain words for the game master, for example "Give the campaign a name." */
  message: string;
  /** The input at fault, when there is one (for example "name"), so a form can mark that field. */
  field?: string;
}

/** The parts of the library a screen may show. A "changed" event lists the areas to reload. */
export const LYRE_AREAS = ["tracks", "tags", "folders", "playlists", "boards", "campaigns", "profiles", "history"] as const;
export type LyreArea = (typeof LYRE_AREAS)[number];

export interface Done<T> {
  ok: true;
  value: T;
  /** The areas this write changed (the same areas the "changed" event names). */
  changed: LyreArea[];
  /** What Undo would now undo, in plain words; null when the write made no undo step (imports, opening a folder). */
  undoLabel: string | null;
}
export interface Refused {
  ok: false;
  refusal: Refusal;
}
export type WriteResult<T = void> = Done<T> | Refused;

/** True when a write was refused (a type guard: the project's compiler settings do not narrow on `ok` alone). */
export function isRefused(result: WriteResult<unknown>): result is Refused {
  return result.ok === false;
}

export type LyreEvent =
  /** Something in these areas changed (from this window, another window, undo, or a watched folder). */
  | { type: "changed"; areas: LyreArea[] }
  /** An import is under way; the last event of an import has phase "done". */
  | { type: "import-progress"; progress: ImportProgress }
  /** New audio files appeared in a watched folder and are now New tracks (library.js, lbwatch's arrival guide). */
  | { type: "watched-files"; folder: string; trackIds: string[] };

/* ---------- library ---------- */

/** A track as the Library shows it: the domain track plus where it came from and when it was added. */
export interface LibraryTrack extends DomainTrack {
  artist: string;
  album: string;
  /** The folder the file is in, for example "H:\\Audio\\Scores\\Hans Zimmer\\Gladiator". */
  folder: string;
  notes: string;
  /** When it was added to the library (ms since 1970). */
  addedAt: number;
  /** Marked New until it has a title of your own and at least one tag. */
  isNew: boolean;
}

/** The fields a screen can change on a track (Details pane, and a dropped file's kind in the session planner). */
export type TrackPatch = Partial<{
  title: string;
  notes: string;
  energy: number | null;
  role: TrackRole | null;
  loop: LoopAdvice | null;
  kind: TrackKind;
}>;

/** A folder the Library lists under Folders: a library folder, or one Lyre watches for new files. */
export interface FolderRoot {
  path: string;
  watched: boolean;
}

export interface SearchRequest {
  /** Words to look for; each must start a word in a title, file name, artist, album, tag or notes. Empty: every track. */
  text: string;
  /** Only this lane: music or ambience by kind; FX is sound effects and stings. */
  lane?: Lane;
  /** At most this many ids (default 50). */
  limit?: number;
}
export interface SearchResult {
  /** Best matches first. */
  trackIds: string[];
  /** How many tracks match in all, for "Show 25 more of 80". */
  total: number;
}

/* ---------- tags ---------- */

export interface TagGroup {
  id: string;
  name: string;
  /** Values in the order the game master keeps them. */
  values: string[];
}

/** One tag value of one group, as tracks carry them (DomainTrack.tags). */
export interface TagRef {
  group: string;
  value: string;
}

export interface TagChange {
  trackIds: string[];
  /** Added to every track; a value the group does not have yet is created (any letter case finds an existing one). */
  add?: TagRef[];
  /** Taken off every track that has it. */
  remove?: TagRef[];
}

/* ---------- playlists ---------- */

export type PlaylistInfo = DomainPlaylist & { notes: string };

export type NewPlaylist = { name: string; lane: Lane; notes?: string } & (
  | { kind: "manual"; trackIds?: string[] }
  | { kind: "dynamic"; rule?: PlaylistRule }
);

export type PlaylistPatch = Partial<{ name: string; notes: string; rule: PlaylistRule }>;

export interface AddedTracks {
  /** Added, in order. */
  added: string[];
  /** Already in the playlist, so not added twice. */
  alreadyIn: string[];
}

/* ---------- pad boards ---------- */

export const PAD_COLORS = ["steel", "ember", "gold", "moss", "violet", "plum", "sea", "bone"] as const;
export type PadColor = (typeof PAD_COLORS)[number];

export interface PadSound {
  /** One file, several variants, or any effect with a tag. */
  kind: "single" | "variants" | "tag";
  /** Library tracks the pad plays (one for "single"). */
  trackIds: string[];
  order: "random" | "in_turn";
  /** For kind "tag": any FX track with this tag. */
  tag: TagRef | null;
}

export interface Pad {
  id: string;
  label: string;
  icon: string;
  color: PadColor;
  /** One lower-case character, or F1 to F12; empty for none. */
  key: string;
  mode: PadMode;
  sound: PadSound;
  volume: number;
  fadeOutMs: number;
}

export type PadPatch = Partial<Omit<Pad, "id" | "sound">> & { sound?: Partial<PadSound> };

export interface PadBoard {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** cols × rows places, row by row; null is an empty place. */
  slots: (Pad | null)[];
  /** Pads that are not on the grid; their keys do nothing. */
  spare: Pad[];
}

/** Where a pad goes: a place on the grid (row by row from 0) or the spare pads. */
export type PadPlace = { slot: number } | "spare";

/* ---------- campaigns, sessions and scenes ---------- */

export const CAMPAIGN_THEMES = ["fern", "hearth", "candle", "parchment", "elysium"] as const;
export type CampaignTheme = (typeof CAMPAIGN_THEMES)[number];

export const SESSION_STATUSES = ["played", "next", "draft"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Where the campaign's notes live in Obsidian (kept for a later version; nothing connects yet). */
export interface ObsidianLinks {
  vault: string;
  note: string;
  sessionsFolder: string;
}

export interface SceneInfo extends DomainScene {
  startsWhen: string;
  notes: string;
  /** An Obsidian note (coming later). */
  noteLink: string;
}

export interface SessionInfo extends DomainSession {
  number: number;
  name: string;
  /** YYYY-MM-DD, or null when there is no date yet. */
  date: string | null;
  status: SessionStatus;
  /** The session's Obsidian note (coming later). */
  noteLink: string;
  scenes: SceneInfo[];
}

/** A whole campaign tree: what Campaigns, the session planner and Live read. */
export interface CampaignInfo extends DomainCampaign {
  name: string;
  system: string;
  theme: CampaignTheme;
  /** One line about the story. */
  description: string;
  notes: string;
  obsidian: ObsidianLinks;
  sessions: SessionInfo[];
}

export type NewCampaign = { name: string } & Partial<Pick<CampaignInfo, "system" | "theme" | "description" | "obsidian">>;
export type CampaignPatch = Partial<Pick<CampaignInfo, "name" | "system" | "theme" | "description" | "notes" | "obsidian">>;
export type SessionPatch = Partial<Pick<SessionInfo, "name" | "date" | "status" | "noteLink">>;
export type ScenePatch = Partial<Pick<SceneInfo, "name" | "startsWhen" | "notes" | "noteLink">>;

/** A campaign, or one of its sessions: the owners of playlists and boards kept "on hand". */
export type Owner = { campaignId: string; sessionId?: string };
export interface SceneAddress {
  campaignId: string;
  sessionId: string;
  sceneId: string;
}
/** A place "Use in…" can tick: a whole campaign, one session, or one scene. */
export type UsePlace = { campaignId: string; sessionId?: string; sceneId?: string };
/** Something that can be used in campaigns, sessions and scenes. */
export type UsableRef = { kind: "playlist" | "board" | "track"; id: string };

/* ---------- import ---------- */

/** Where new audio comes from: a file or folder chooser shown by Lyre, or paths (dropped files and folders). */
export type ImportSource = { from: "choose-files" } | { from: "choose-folder" } | { from: "paths"; paths: string[] };

export interface ImportProgress {
  /** finding: walking folders; reading: file facts and tags; saving: a batch was saved; done: finished or stopped. */
  phase: "finding" | "reading" | "saving" | "done";
  done: number;
  total: number;
  /** One line for the progress bar. */
  message: string;
}

export interface ImportSummary {
  /** Tracks created, in order. */
  added: string[];
  /** Tracks that were already in the library for the files given. */
  alreadyInLibrary: string[];
  /** Every track for the files given, added or already there. */
  trackIds: string[];
  /** Files that could not be added, in plain words. */
  problems: { file: string; reason: string }[];
  /** True when the chooser was closed without choosing, or the import was stopped. */
  cancelled: boolean;
  /** What happened, in plain words. */
  summary: string;
}

export interface MissingTrack {
  id: string;
  title: string;
  /** Where the library expects the file. */
  path: string;
}

export interface RelinkMatch {
  trackId: string;
  from: string;
  to: string;
  /** sure: same content; likely: same name and size; name: same name only. */
  confidence: "sure" | "likely" | "name";
}

export interface RelinkPlan {
  /** The folder that was searched. */
  folder: string;
  matches: RelinkMatch[];
  /** Missing tracks with several equally good files: the screen asks which. */
  ambiguous: { trackId: string; candidates: string[] }[];
  notFound: string[];
  summary: string;
}

/* ---------- history ---------- */

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** What Undo would undo, for a button such as "Undo: Resize Combat to 3 × 3". */
  undoLabel: string | null;
  redoLabel: string | null;
}

/* ---------- the API ---------- */

export interface LyreApi {
  library: {
    /** Every track. library.js visible() and filtersBody(); _shared.js pickTracks, pickSceneMusic, pickAmbience; boards.js fxTrackByFile. */
    listTracks(): Promise<LibraryTrack[]>;
    /** Tracks matching words, in one lane. playlists.js addPane (L.inputs.plq, L.acts.pladdlane, L.acts.plmore). */
    search(request: SearchRequest): Promise<SearchResult>;
    /** library.js L.inputs.lbtitle, L.acts.lbusemeta, L.inputs.lbnotes, L.acts.lbenergy, lbrole, lbloop; campaigns.js drop on Ambience (kind). */
    updateTrack(id: string, patch: TrackPatch): Promise<WriteResult<LibraryTrack>>;
    /** The Folders filter. library.js filtersBody() and folderBtn(). */
    listFolders(): Promise<FolderRoot[]>;
    /** Opens the track's folder in File Explorer. library.js L.acts.lbshow. */
    showInFolder(trackId: string): Promise<WriteResult>;
  };
  tags: {
    /** Tag groups and their values. library.js filters, tag combobox and Tag… sheet; playlists.js rule builder (plvaladd). */
    listGroups(): Promise<TagGroup[]>;
    /** Adds and removes tags on tracks, creating new values. library.js L.acts.lbcbxpick, lbuntag, lbtsapply, lbtsnew. */
    tagTracks(change: TagChange): Promise<WriteResult<{ created: TagRef[] }>>;
  };
  playlists: {
    /** Every playlist, in list order. playlists.js renderList(); _shared.js pickPlaylists. */
    list(): Promise<PlaylistInfo[]>;
    /** A playlist's tracks in playing order (dynamic: every match). playlists.js renderOne(); _shared.js contentsHTML. */
    tracks(id: string): Promise<string[]>;
    /** Playlists a track is in, manual or by a dynamic rule. library.js detailsBody() "In playlists"; profile.js places(). */
    containing(trackId: string): Promise<string[]>;
    /** New playlist, at the top of the list. playlists.js L.acts.plcreate, pldropnew; library.js newPlaylist (lbbnew, lbplnew1). */
    create(playlist: NewPlaylist): Promise<WriteResult<PlaylistInfo>>;
    /** playlists.js L.inputs.plname, plnotes; rule builder plcadd, plcrm, plcgroup, plcmatch, plvalrm, plvalpick, plen, plsting. */
    update(id: string, patch: PlaylistPatch): Promise<WriteResult<PlaylistInfo>>;
    /** A manual copy of the tracks it has now, placed after it. playlists.js L.acts.plcopyhand. */
    copyAsManual(id: string): Promise<WriteResult<PlaylistInfo>>;
    /** Deletes it and takes it out of every campaign, session and scene; tracks stay. playlists.js L.acts.pldeldo. */
    delete(id: string): Promise<WriteResult>;
    /** Adds tracks to a manual playlist at a place (default the end). playlists.js pladd, drops; library.js lbpladd, lbbpl, lbrmpl. */
    addTracks(id: string, trackIds: string[], at?: number): Promise<WriteResult<AddedTracks>>;
    /** playlists.js L.acts.plrm; library.js L.acts.lbplrm. */
    removeTrack(id: string, trackId: string): Promise<WriteResult>;
    /** playlists.js L.acts.plmove, Alt+Up/Down, row drag. */
    moveTrack(id: string, trackId: string, toIndex: number): Promise<WriteResult>;
  };
  boards: {
    /** Every pad board with its pads. boards.js list view, board editor; _shared.js pickBoards, contentsHTML. */
    list(): Promise<PadBoard[]>;
    /** boards.js L.acts.pbnbcreate. */
    create(board: { name: string; cols: number; rows: number }): Promise<WriteResult<PadBoard>>;
    /** boards.js L.inputs.pbname. */
    rename(id: string, name: string): Promise<WriteResult<PadBoard>>;
    /** Pads that no longer fit go to spare, keeping row and column; undo puts them back. boards.js pbsize, pbquick. */
    resize(id: string, cols: number, rows: number): Promise<WriteResult<{ board: PadBoard; movedToSpare: string[] }>>;
    /** A copy used nowhere yet, placed after it. boards.js L.acts.pbdupboard. */
    duplicate(id: string): Promise<WriteResult<PadBoard>>;
    /** Deletes it and takes it out of every campaign, session and scene. boards.js L.acts.pbdelboardok. */
    delete(id: string): Promise<WriteResult>;
    /** A new pad in an empty place. boards.js L.acts.pbadd. */
    addPad(boardId: string, slot: number): Promise<WriteResult<Pad>>;
    /** boards.js pblabel, pbsoundkind, pbpicklib, pbaddfile, pbrmfile, pborder, pbtag, pbmode, pbkeycap, pbkeyclear, pbkeyswap, pbcolour, pbicon, pbvol, pbfade. */
    updatePad(boardId: string, padId: string, patch: PadPatch): Promise<WriteResult<Pad>>;
    /** A copy without a key, in the next empty place (or spare). boards.js L.acts.pbduppad. */
    duplicatePad(boardId: string, padId: string): Promise<WriteResult<{ pad: Pad; place: PadPlace }>>;
    /** Moving onto a pad swaps the two (a pad from spare sends the other to spare). boards.js pbmoveto, pbputback, drag, Alt+arrow. */
    movePad(boardId: string, padId: string, to: PadPlace): Promise<WriteResult<{ swappedWith: string | null }>>;
    /** Spare pads into empty places, in order. boards.js L.acts.pbputall. */
    putAllBack(boardId: string): Promise<WriteResult<{ putBack: string[] }>>;
    /** boards.js L.acts.pbdelpadok. */
    deletePad(boardId: string, padId: string): Promise<WriteResult>;
  };
  campaigns: {
    /** Every campaign tree. campaigns.js Campaigns view; _shared.js assignSheet targets; boards.js campaign filter. */
    list(): Promise<CampaignInfo[]>;
    /** One campaign tree (null when it is gone). campaigns.js Campaign and Session views; live.js (wave 4). */
    get(id: string): Promise<CampaignInfo | null>;
    /** With a first draft session holding an "Opening scene". campaigns.js L.acts.cpcreate. */
    create(campaign: NewCampaign): Promise<WriteResult<CampaignInfo>>;
    /** campaigns.js L.inputs.cpcamp, cpcampnotes, cpobs. */
    update(id: string, patch: CampaignPatch): Promise<WriteResult<CampaignInfo>>;
    /** The playlists or boards a campaign or session keeps on hand, in order. campaigns.js L.acts.cpadd, cprm. */
    setOnHand(owner: Owner, kind: "playlists" | "boards", ids: string[]): Promise<WriteResult>;
    /** Where something is used. playlists.js usesPane, pldel; boards.js usedPane, card, pbdelboard; library.js "Used in". */
    usesOf(ref: UsableRef): Promise<Use[]>;
    /** "Use in…": exactly these places use it. _shared.js L.assignSheet onDone (playlists.js pluse, boards.js pbuse). */
    setUses(ref: { kind: "playlist" | "board"; id: string }, places: UsePlace[]): Promise<WriteResult>;
  };
  sessions: {
    /** Next number; "next" when the campaign has none, else draft. campaigns.js L.acts.cpnewsession. */
    create(campaignId: string): Promise<WriteResult<SessionInfo>>;
    /** Making one "next" makes the old next played (earlier) or draft (later). campaigns.js L.inputs.cpsess. */
    update(campaignId: string, sessionId: string, patch: SessionPatch): Promise<WriteResult<SessionInfo>>;
    /** Sessions are renumbered in their new order. campaigns.js L.acts.cpmove (sessions), drag. */
    move(campaignId: string, sessionId: string, toIndex: number): Promise<WriteResult>;
    /** A blank scene after another (default: at the end). campaigns.js L.acts.cpaddscene. */
    createScene(campaignId: string, sessionId: string, after?: string): Promise<WriteResult<SceneInfo>>;
    /** campaigns.js L.inputs.cpscf. */
    updateScene(scene: SceneAddress, patch: ScenePatch): Promise<WriteResult<SceneInfo>>;
    /** campaigns.js L.acts.cpmove (scenes), drag. */
    moveScene(scene: SceneAddress, toIndex: number): Promise<WriteResult>;
    /** A copy named "(copy)" right after it. campaigns.js L.acts.cpdup. */
    duplicateScene(scene: SceneAddress): Promise<WriteResult<SceneInfo>>;
    /** campaigns.js L.acts.cpdel. */
    deleteScene(scene: SceneAddress): Promise<WriteResult>;
    /** The music list in playing order (tracks and playlists, no ambience). campaigns.js cpaddmusic, cpitem, music drops. */
    setSceneMusic(scene: SceneAddress, music: SoundRef[]): Promise<WriteResult>;
    /** One ambience track or ambience playlist, or none. campaigns.js cppickamb, cpclearamb, ambience drops. */
    setSceneAmbience(scene: SceneAddress, ambience: SoundRef | null): Promise<WriteResult>;
    /** campaigns.js L.acts.cpaddboards, cpitem (boards). */
    setSceneBoards(scene: SceneAddress, boardIds: string[]): Promise<WriteResult>;
  };
  profiles: {
    /** Every place's own settings, keyed by placeKey (src/common/domain). profile.js, library.js profileSummary, playlists.js and campaigns.js own-settings marks. */
    overrides(): Promise<ProfileOverrides>;
    /** A track's own profile (place null) or its own settings in one place. profile.js write(), apown, apreset. */
    set(trackId: string, place: ProfilePlace | null, profile: AudioProfileInput): Promise<WriteResult>;
    /** Back to the track's own settings in that place. profile.js L.acts.apclear. */
    clear(trackId: string, place: ProfilePlace): Promise<WriteResult>;
  };
  import: {
    /** Adds audio files as New tracks; progress comes as events. library.js lbaddfiles, lbaddfolder, drop; playlists.js and campaigns.js drops. */
    start(source: ImportSource): Promise<WriteResult<ImportSummary>>;
    /** Watches a folder: new audio files there become New tracks; null when the chooser was closed. library.js L.acts.lbwatch. */
    watchFolder(source: { from: "choose-folder" } | { from: "path"; path: string }): Promise<WriteResult<FolderRoot | null>>;
    /** Tracks whose files are gone (DAT-8; the lead's wave 3 brief, no prototype screen yet). */
    findMissing(): Promise<MissingTrack[]>;
    /** Looks for missing files in a folder; nothing changes until applyRelink (DAT-8). */
    planRelink(source: { from: "choose-folder" } | { from: "path"; path: string }): Promise<WriteResult<RelinkPlan>>;
    /** Points tracks at the files the game master confirmed, in one undo step (DAT-8). */
    applyRelink(matches: Pick<RelinkMatch, "trackId" | "to">[]): Promise<WriteResult<{ relinked: string[] }>>;
  };
  history: {
    /** boards.js gridPane message with Undo; profile.js apundo (and the shell's Undo and Redo). */
    state(): Promise<HistoryState>;
    /** boards.js L.acts.pbundo; profile.js L.acts.apundo. */
    undo(): Promise<WriteResult<{ undone: string }>>;
    redo(): Promise<WriteResult<{ redone: string }>>;
  };
  /** Change events; returns a function that stops them. core.js L.changed() (every view re-renders on change). */
  subscribe(listener: (event: LyreEvent) => void): () => void;
}

/** Method names by area, for the contract tests' "every method is covered" guard and for IPC channel lists. */
export const LYRE_API_METHODS = {
  library: ["listTracks", "search", "updateTrack", "listFolders", "showInFolder"],
  tags: ["listGroups", "tagTracks"],
  playlists: ["list", "tracks", "containing", "create", "update", "copyAsManual", "delete", "addTracks", "removeTrack", "moveTrack"],
  boards: ["list", "create", "rename", "resize", "duplicate", "delete", "addPad", "updatePad", "duplicatePad", "movePad", "putAllBack", "deletePad"],
  campaigns: ["list", "get", "create", "update", "setOnHand", "usesOf", "setUses"],
  sessions: ["create", "update", "move", "createScene", "updateScene", "moveScene", "duplicateScene", "deleteScene", "setSceneMusic", "setSceneAmbience", "setSceneBoards"],
  profiles: ["overrides", "set", "clear"],
  import: ["start", "watchFolder", "findMissing", "planRelink", "applyRelink"],
  history: ["state", "undo", "redo"],
} as const satisfies { [A in Exclude<keyof LyreApi, "subscribe">]: readonly (keyof LyreApi[A])[] };
