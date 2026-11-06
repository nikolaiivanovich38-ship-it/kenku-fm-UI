/**
 * LyreApi over the real library (WP5, wave 3 step 2): every method of src/common/lyre/api.ts on src/main/data.
 * It runs where the library's Store is, which in the app is the library's own utility process (libraryProcess.ts),
 * never the main process beside the Discord bots. The same contract tests pass here as on the fake.
 *
 * - Each write is one undo step with a plain-words label: the repository functions it calls run inside one
 *   `store.change` (theirs then nest), or `store.changeInBatches` for work over many tracks, so the event loop
 *   stays free between batches. A write that changed nothing makes no step and sends no event.
 * - Input the library cannot take is refused in plain words (`refusalFor` turns the library's errors into
 *   refusals); anything else is a fault and rejects.
 * - What needs a person or the desktop (choosing files, opening File Explorer) is asked of the host.
 */
import path from "path";

import { isFx, type DomainCampaign, type Lane, type NormaliseChoice, type PlaylistRule, type ProfilePlace, type SoundRef, type Use } from "../../common/domain";
import type {
  AddedTracks,
  CampaignInfo,
  FolderRoot,
  ImportSummary,
  LibraryTrack,
  LyreApi,
  LyreArea,
  LyreEvent,
  MissingTrack,
  Pad as ApiPad,
  PadBoard,
  PadPlace,
  PlaylistInfo,
  Refusal as ApiRefusal,
  RefusalCode,
  RelinkPlan as ApiRelinkPlan,
  SceneAddress,
  SceneInfo,
  SessionInfo,
  TagGroup as ApiTagGroup,
  TagRef,
  TrackPatch as ApiTrackPatch,
  WriteResult,
} from "../../common/lyre/api";
import { CAMPAIGN_THEMES } from "../../common/lyre/api";
import { estimateTransfer, NOT_BROUGHT_ACROSS, transferContents, type TransferLibrary } from "../../common/lyre/transfer";
import { fileAddress } from "../../common/lyre/media";
import { plural, quoted, shownTitle, tagValue, trimmed } from "../../common/lyre/text";
import {
  LibraryBusyError,
  NotFoundError,
  ValidationError,
  addPad,
  addRoot,
  addSceneBoards,
  addSceneMusic,
  addToCampaign,
  addToSession,
  addTracksToPlaylist,
  applyRelink,
  clearPlayOrder,
  clearProfileOverride,
  copyPlaylist,
  createBoard,
  createCampaign,
  createPlaylist,
  createScene,
  createSession,
  createTag,
  deleteBoard,
  deletePads,
  deletePlaylist,
  deleteScene,
  findMissingTracks,
  getBoardLayout,
  getDomainCampaign,
  getDomainLookup,
  getLibraryNormalise,
  getPlayOrderOverrides,
  getTrackNames,
  getProfileOverride,
  getProfileOverrides,
  importAudio,
  listBoards,
  listCampaigns,
  listDomainCampaigns,
  listPlaylistItems,
  listPlaylistTrackIds,
  listPlaylists,
  listRoots,
  listSceneMusic,
  listScenes,
  listSessions,
  listTagGroups,
  listTags,
  listTrackIdsByShape,
  listUses,
  ownPlayOrders,
  movePad,
  movePlaylistItems,
  moveScene,
  moveSession,
  planRelink,
  removeFromCampaign,
  removeFromSession,
  removePlaylistItems,
  removeSceneBoards,
  removeSceneMusic,
  resizeBoard,
  search,
  searchCount,
  setBoardUses,
  setPlaylistUses,
  setLibraryNormalise,
  setPlaylistNormalise,
  setPlayOrder,
  setProfileOverride,
  setSceneTrackName,
  setTrackNormalise,
  setTrackUses,
  setSceneAmbience,
  tagTracks,
  untagTracks,
  updateBoard,
  updateCampaign,
  updatePad,
  updatePlaylist,
  updateRoot,
  updateScene,
  updateSession,
  updateTrack,
  PeakJobs,
  tracksNeedingLoudness,
  type LoudnessReader,
  trackPeaks,
  type Library,
  type Pad,
  type PeakReader,
  type Placement,
  type RelinkMatch,
  type TagReader,
  type UseTarget,
} from "../data";
import { nextTurn } from "../data/store";
import { diskProbe, type FileProbe } from "../data/import/relink";
import { joinRoot, unsafeFolderReason } from "../data/paths";
import { saveLyreFile, openLyreFile, bringInLyreFile, type OpenTransfer, type TransferFiles } from "./transferApi";
import { withCheckedArguments } from "./argChecks";
import { Refused } from "./refused";

/** What the library's API asks of the app around it: a person to choose files, the desktop to show a folder. */
export interface LibraryHost {
  /** A file chooser; null when closed without choosing. */
  chooseFiles(): Promise<string[] | null>;
  /** A folder chooser; null when closed without choosing. */
  chooseFolder(): Promise<string | null>;
  /** Opens File Explorer with the file selected. */
  showItemInFolder(path: string): void;
  /** DAT-7: a save dialog for a .lyre file, starting at the suggested name; null when closed. */
  chooseSaveFile(suggestedName: string): Promise<string | null>;
  /** DAT-7: an open dialog for .lyre files; null when closed. */
  chooseLyreFile(): Promise<string | null>;
}

export interface LibraryApiOptions {
  /** Reads titles, artist and album from files (music-metadata); without it tracks are named after their files. */
  tagReader?: TagReader;
  /** Works out loudness peaks from files (ffmpeg); without it `library.peaksOf` answers null. */
  peakReader?: PeakReader;
  /** ffmpeg's length of a file the tag reader found no audio in (UX review 3); without it such a file is refused. */
  lengthProbe?: (filePath: string) => Promise<number | null>;
  /** How often a "changed" event for "peaks" may be sent while they are worked out (default 250 ms). */
  peakNotifyEveryMs?: number;
  /**
   * How Lyre looks at and reads files on the computer (missing files, relinking, audio for a .lyre file). The disk,
   * unless a test build of the sample library stands in for the prototype's computer (sampleComputer.ts).
   */
  files?: FileProbe & { open?(file: string): NodeJS.ReadableStream };
  /** DAT-7: where brought-in audio files go, and the day in file names (a test build of the sample library: 5 Nov 2026). */
  transfer?: Partial<TransferFiles>;
  /** DAT-15: measures each track's loudness (ffmpeg) with its peaks; without it tracks stay not measured. */
  loudnessReader?: LoudnessReader;
  /**
   * DAT-15: how long after start every track not measured yet (a library from before version 4, or files changed
   * while Lyre was closed) is queued in the background (default 20 s, so starting up is not slowed).
   */
  loudnessSweepAfterMs?: number;
  log?: (message: string, error?: unknown) => void;
}

/** LyreApi plus what its owner calls before closing the library. */
export type LibraryApi = LyreApi & {
  /** Stops background work (the peaks being worked out); call before library.close(). */
  stopBackgroundWork(): void;
};

/** A level byte (repo/peaks.ts) as the API's 0 to 1, to three places (enough for any screen, a third of the JSON). */
const levelOut = (byte: number) => Math.round((byte / 255) * 1000) / 1000;

/** Thrown inside a write to refuse it in plain words. */
const refuse = (code: RefusalCode, message: string, field?: string): never => {
  throw new Refused(code, message, field);
};

const ENTITY_WORDS: Record<string, string> = {
  track: "That track is no longer in your library.",
  playlist: "That playlist no longer exists.",
  board: "That pad board no longer exists.",
  pad: "That pad no longer exists.",
  campaign: "That campaign no longer exists.",
  session: "That session no longer exists.",
  scene: "That scene no longer exists.",
  tag: "That tag no longer exists.",
};

/**
 * The refusal a screen shows for an error from the library, or null when the error is a fault (a damaged file, a
 * full disk, a bug): those reject the call, and the page says something went wrong.
 */
export function refusalFor(error: unknown): ApiRefusal | null {
  if (error instanceof Refused) return error.field ? { code: error.code, message: error.message, field: error.field } : { code: error.code, message: error.message };
  if (error instanceof ValidationError) return { code: "invalid", message: error.message, field: error.field };
  if (error instanceof NotFoundError) return { code: "not-found", message: ENTITY_WORDS[error.entity] ?? "That is no longer in your library." };
  if (error instanceof LibraryBusyError) return { code: "busy", message: error.message };
  return null;
}

/** "f5" as stored, "F5" as the screens show it; a letter or digit as it is. */
const keyOut = (hotkey: string | null) => (hotkey === null ? "" : /^f([1-9]|1[0-2])$/.test(hotkey) ? hotkey.toUpperCase() : hotkey);
const lastSeparator = (p: string) => Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));

type TrackExtra = {
  id: string;
  root_id: string | null;
  path: string | null;
  url: string | null;
  file_size: number | null;
  notes: string;
  source_composer: string | null;
  source_album: string | null;
  created_at: number;
  is_new: number;
};
const TRACK_EXTRA_SQL = "SELECT id, root_id, path, url, file_size, notes, source_composer, source_album, created_at, is_new FROM tracks";

export function createLibraryApi(library: Library, host: LibraryHost, options: LibraryApiOptions = {}): LibraryApi {
  const { store, history } = library;
  const probe = options.files ?? diskProbe;
  const transferFiles: TransferFiles = {
    broughtInFolder: options.transfer?.broughtInFolder ?? path.join(path.dirname(library.databasePath), "Brought in"),
    today: options.transfer?.today ?? store.now,
    freeBytes: options.transfer?.freeBytes,
  };
  /** The .lyre file opened last, waiting for Bring in (one at a time). */
  let opened: OpenTransfer | null = null;
  const listeners = new Set<(event: LyreEvent) => void>();
  let importing = false;
  /**
   * The last relink plan (security review 4): its matches with their full facts, and the files offered for each
   * ambiguous track. applyRelink accepts only these; the plan is used up when applied, and is not kept across a
   * restart of the library's process (a match is then refused, and the game master looks again).
   */
  let planned = new Map<string, RelinkMatch>();
  let plannedChoices = new Set<string>();
  const relinkKey = (trackId: string, to: string) => `${trackId}\u0000${to}`;

  const emit = (event: LyreEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const stateLabel = () => history.state().undoLabel;
  // Loudness peaks: worked out one track at a time by ffmpeg in its own process; screens hear when some are ready.
  // DAT-15: the same job measures loudness; a "peaks" event then also means some tracks' loudness is known.
  const peakJobs = options.peakReader
    ? new PeakJobs(store, options.peakReader, {
        onReady: () => emit({ type: "changed", areas: ["peaks"] }),
        notifyEveryMs: options.peakNotifyEveryMs ?? 250,
        log: options.log,
        loudness: options.loudnessReader,
      })
    : null;
  const loudnessSweep =
    peakJobs && options.loudnessReader
      ? setTimeout(() => {
          try {
            peakJobs.inBackground(tracksNeedingLoudness(store));
          } catch (error) {
            options.log?.("Could not list the tracks to measure", error);
          }
        }, options.loudnessSweepAfterMs ?? 20_000)
      : null;
  loudnessSweep?.unref?.();

  /**
   * One write: refusals in plain words, faults passed on, and a "changed" event when it made an undo step.
   * `body` makes its own `store.change` (or batches) with the step's label.
   */
  async function write<T>(areas: LyreArea[], body: () => T | Promise<T>): Promise<WriteResult<T>> {
    const before = history.recorded;
    let value: T;
    try {
      value = await body();
    } catch (error) {
      const refusal = refusalFor(error);
      if (refusal) return { ok: false, refusal };
      throw error;
    }
    if (history.recorded === before) return { ok: true, value, changed: [], undoLabel: stateLabel() };
    const changed: LyreArea[] = [...areas, "history"];
    emit({ type: "changed", areas: changed });
    return { ok: true, value, changed, undoLabel: stateLabel() };
  }
  /** A write the history does not keep (watching a folder, importing: an import clears the history). */
  async function writeOutside<T>(areas: LyreArea[], body: () => T | Promise<T>): Promise<WriteResult<T>> {
    let value: T;
    try {
      value = await body();
    } catch (error) {
      const refusal = refusalFor(error);
      if (refusal) return { ok: false, refusal };
      throw error;
    }
    if (areas.length) emit({ type: "changed", areas });
    return { ok: true, value, changed: areas, undoLabel: stateLabel() };
  }
  /** Runs a read that may name something gone; such a read answers `fallback`. */
  function quietly<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) return fallback;
      throw error;
    }
  }

  /* ---------- reading in the API's shapes ---------- */

  const rootPaths = () => new Map(listRoots(store).map((r) => [r.id, r.path]));
  function fullPath(row: TrackExtra, roots: Map<string, string>): string | null {
    if (row.url !== null) return null;
    if (row.root_id !== null) return joinRoot(roots.get(row.root_id) ?? "", row.path ?? "");
    return row.path;
  }
  function libraryTracks(only?: string): LibraryTrack[] {
    const lookup = getDomainLookup(store);
    const domain = only === undefined ? [...lookup.tracks()] : [lookup.track(only)].filter(Boolean);
    const extras = new Map(
      (only === undefined ? store.all<TrackExtra>(TRACK_EXTRA_SQL) : store.all<TrackExtra>(`${TRACK_EXTRA_SQL} WHERE id = ?`, only)).map((r) => [r.id, r]),
    );
    const roots = rootPaths();
    return domain.map((t) => {
      const row = extras.get(t.id) as TrackExtra;
      const file = fullPath(row, roots);
      return {
        ...t,
        shape: t.shape ?? null,
        suggestedShape: t.suggestedShape ?? null,
        normalise: t.normalise ?? null,
        loudness: t.loudness ?? null,
        artist: row.source_composer ?? "",
        album: row.source_album ?? "",
        folder: file === null ? "" : file.slice(0, Math.max(0, lastSeparator(file))),
        notes: row.notes,
        addedAt: row.created_at,
        isNew: row.is_new === 1,
        url: row.url ?? (file === null ? null : fileAddress(file)),
        sizeBytes: row.file_size,
      };
    });
  }
  const requireTrack = (id: string) => libraryTracks(id)[0] ?? refuse("not-found", ENTITY_WORDS.track);

  function tagGroups(): ApiTagGroup[] {
    const tags = listTags(store);
    return listTagGroups(store).map((g) => ({ id: g.id, name: g.name, values: tags.filter((t) => t.groupId === g.id).map((t) => t.name) }));
  }
  /** The tag's id, by group and name in any letter case; undefined when the group has no such tag. */
  function tagIdOf(ref: TagRef): string | undefined {
    const name = ref.value.toLowerCase();
    return listTags(store, { groupId: ref.group }).find((t) => t.name.toLowerCase() === name)?.id;
  }
  function tagRefsById(): Map<string, TagRef> {
    const groups = new Map(listTagGroups(store).map((g) => [g.id, g.id]));
    return new Map(listTags(store).map((t) => [t.id, { group: groups.get(t.groupId) as string, value: t.name }]));
  }

  function playlistInfos(): PlaylistInfo[] {
    const items = new Map<string, string[]>();
    for (const row of store.all<{ playlist_id: string; track_id: string }>(
      "SELECT playlist_id, track_id FROM playlist_items WHERE kind = 'track' ORDER BY playlist_id, position",
    )) {
      const list = items.get(row.playlist_id);
      if (list) list.push(row.track_id);
      else items.set(row.playlist_id, [row.track_id]);
    }
    const orders = ownPlayOrders(store, "all");
    const choices = new Map(store.all<{ id: string; normalise: NormaliseChoice | null }>("SELECT id, normalise FROM playlists").map((r) => [r.id, r.normalise]));
    return listPlaylists(store).map((p): PlaylistInfo => {
      const order = orders.get(p.id) ?? null;
      const normalise = choices.get(p.id) ?? null;
      return p.kind === "dynamic"
        ? { id: p.id, name: p.title, lane: p.lane, order, normalise, kind: "dynamic", rule: p.rule as PlaylistRule, notes: p.notes }
        : { id: p.id, name: p.title, lane: p.lane, order, normalise, kind: "manual", trackIds: items.get(p.id) ?? [], notes: p.notes };
    });
  }
  const requirePlaylist = (id: string) => playlistInfos().find((p) => p.id === id) ?? refuse("not-found", ENTITY_WORDS.playlist);
  function requireManual(id: string) {
    const pl = requirePlaylist(id);
    if (pl.kind !== "manual") refuse("wrong-kind", `"${pl.name}" is a dynamic playlist: it picks up tracks by their tags, so tag the tracks instead.`);
    return pl as Extract<PlaylistInfo, { kind: "manual" }>;
  }
  /** Where to put things so they land at `index` among a manual playlist's tracks (dividers are passed over). */
  function placementAmongTracks(playlistId: string, index: number | undefined, leaving?: string): Placement {
    const items = listPlaylistItems(store, playlistId).filter((i) => i.kind === "track" && i.id !== leaving);
    if (index === undefined || !Number.isFinite(index) || index >= items.length) return "end";
    return { before: items[Math.max(0, Math.floor(index))].id };
  }

  function apiPad(pad: Pad, tags: Map<string, TagRef>): ApiPad {
    return {
      id: pad.id,
      label: pad.label,
      icon: pad.icon,
      color: pad.color,
      key: keyOut(pad.hotkey),
      mode: pad.mode,
      sound: { kind: pad.sound.kind, trackIds: [...pad.sound.trackIds], order: pad.sound.order, tag: pad.sound.tagId ? (tags.get(pad.sound.tagId) ?? null) : null },
      volume: pad.volume,
      fadeOutMs: pad.fadeMs,
      aside: pad.putAside,
    };
  }
  function padBoard(id: string, tags = tagRefsById()): PadBoard {
    const layout = getBoardLayout(store, id);
    return {
      id: layout.board.id,
      name: layout.board.title,
      cols: layout.board.cols,
      rows: layout.board.rows,
      slots: layout.slots.map((p) => (p ? apiPad(p, tags) : null)),
      spare: layout.spare.map((p) => apiPad(p, tags)),
    };
  }
  const requireBoard = (id: string) => quietly(() => padBoard(id), null) ?? refuse("not-found", ENTITY_WORDS.board);
  function requirePad(boardId: string, padId: string) {
    const layout = quietly(() => getBoardLayout(store, boardId), null) ?? refuse("not-found", ENTITY_WORDS.board);
    const slot = layout.slots.findIndex((p) => p?.id === padId);
    if (slot > -1) return { layout, pad: layout.slots[slot] as Pad, where: "slot" as const, index: slot };
    const spare = layout.spare.findIndex((p) => p.id === padId);
    if (spare > -1) return { layout, pad: layout.spare[spare], where: "spare" as const, index: spare };
    return refuse("not-found", ENTITY_WORDS.pad);
  }
  const cellOf = (slot: number, cols: number) => ({ row: Math.floor(slot / cols), col: slot % cols });

  /** What every campaign's info reads, read once for a list of them (security review w4, Should 3). */
  const campaignLookups = () => ({ campaigns: new Map(listCampaigns(store).map((c) => [c.id, c])), names: getTrackNames(store) });
  function campaignInfo(tree: DomainCampaign, lookups = campaignLookups()): CampaignInfo {
    const campaign = lookups.campaigns.get(tree.id);
    const sessions = new Map(listSessions(store, tree.id).map((s) => [s.id, s]));
    const { names } = lookups;
    return {
      id: tree.id,
      name: campaign.name,
      system: campaign.system,
      theme: campaign.theme,
      description: campaign.description,
      notes: campaign.notes,
      obsidian: { ...campaign.obsidian },
      playlistIds: tree.playlistIds,
      boardIds: tree.boardIds,
      trackIds: tree.trackIds ?? [],
      sessions: tree.sessions.map((s): SessionInfo => {
        const row = sessions.get(s.id);
        const scenes = new Map(listScenes(store, s.id).map((sc) => [sc.id, sc]));
        return {
          ...s,
          number: row.number,
          name: row.name,
          date: row.date,
          status: row.status,
          noteLink: row.noteLink,
          trackIds: s.trackIds ?? [],
          scenes: s.scenes.map((sc): SceneInfo => {
            const scene = scenes.get(sc.id);
            const trackNames = { ...(names[`sc:${tree.id}:${s.id}:${sc.id}`] ?? {}) };
            return { ...sc, name: scene.name, startsWhen: scene.startsWhen, notes: scene.notes, noteLink: scene.noteLink, trackNames };
          }),
        };
      }),
    };
  }
  function allCampaignInfos(): CampaignInfo[] {
    const lookups = campaignLookups();
    return listDomainCampaigns(store).map((tree) => campaignInfo(tree, lookups));
  }
  function campaignById(id: string): CampaignInfo | null {
    const tree = quietly(() => getDomainCampaign(store, id), null);
    return tree ? campaignInfo(tree) : null;
  }
  const requireCampaign = (id: string) => campaignById(id) ?? refuse("not-found", ENTITY_WORDS.campaign);
  function requireSession(campaignId: string, sessionId: string): SessionInfo {
    return requireCampaign(campaignId).sessions.find((s) => s.id === sessionId) ?? refuse("not-found", ENTITY_WORDS.session);
  }
  function requireScene(address: SceneAddress): { session: SessionInfo; scene: SceneInfo; index: number } {
    const session = requireSession(address.campaignId, address.sessionId);
    const index = session.scenes.findIndex((s) => s.id === address.sceneId);
    if (index < 0) refuse("not-found", ENTITY_WORDS.scene);
    return { session, scene: session.scenes[index], index };
  }
  /** Where to put a session or scene so it lands at `index` among `ids` (the moving one left out). */
  function placementAt(ids: string[], moving: string, index: number): Placement {
    const others = ids.filter((id) => id !== moving);
    const at = Math.max(0, Math.min(others.length, Math.floor(Number.isFinite(index) ? index : others.length)));
    return at >= others.length ? "end" : { before: others[at] };
  }

  function checkMusic(ref: SoundRef, tracks: Map<string, LibraryTrack>, playlists: Map<string, PlaylistInfo>) {
    if (ref.kind === "track") {
      const t = tracks.get(ref.id) ?? refuse("not-found", ENTITY_WORDS.track);
      if (t.kind === "amb") refuse("wrong-kind", "Ambience goes in the scene's Ambience, not its music.");
    } else {
      const p = playlists.get(ref.id) ?? refuse("not-found", ENTITY_WORDS.playlist);
      if (p.lane === "amb") refuse("wrong-kind", "An ambience playlist goes in the scene's Ambience, not its music.");
    }
  }
  function placeExists(place: ProfilePlace) {
    if (place.kind === "playlist") requirePlaylist(place.playlistId);
    else if (place.kind === "session") requireSession(place.campaignId, place.sessionId);
    else requireScene(place);
  }
  /** A rule may only name tag groups and values the library has (the database would call them "not found"). */
  function checkRule(rule: PlaylistRule) {
    const groups = new Map(tagGroups().map((g) => [g.id, g]));
    for (const c of rule?.conds ?? []) {
      const g = groups.get(c.group) ?? refuse("invalid", "There is no such tag group.", "rule");
      for (const value of c.values ?? []) if (!g.values.includes(value)) refuse("invalid", `${value} is not a ${g.name.toLowerCase()} tag.`, "rule");
    }
  }
  const requireName = (name: unknown, what: string) => trimmed(name) || refuse("invalid", `Give the ${what} a name.`, "name");

  /** The library in the API's shapes: what a .lyre file is made from, and what an opened one is compared with. */
  function currentLibrary(): TransferLibrary {
    const tags = tagRefsById();
    return { tracks: libraryTracks(), playlists: playlistInfos(), boards: listBoards(store).map((b) => padBoard(b.id, tags)), campaigns: allCampaignInfos(), tagGroups: tagGroups() };
  }
  /** A track's file on this computer, or null for a web address. */
  function trackFile(trackId: string): string | null {
    const row = store.get<TrackExtra>(`${TRACK_EXTRA_SQL} WHERE id = ?`, trackId);
    return row ? fullPath(row, rootPaths()) : null;
  }
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  /* ---------- the API ---------- */

  const api: LibraryApi = {
    library: {
      async listTracks() {
        return libraryTracks();
      },
      async search({ text, lane, limit = 50, shapes }) {
        const max = Math.max(0, limit);
        const inLane = (t: LibraryTrack) => !lane || (lane === "fx" ? isFx(t) : t.kind === lane);
        if (shapes && shapes.length) {
          // DAT-13, the Shape filter: the shape index gives the tracks; words and lane narrow them in memory.
          const shaped = new Set(quietly(() => listTrackIdsByShape(store, shapes), []));
          const wanted = trimmed(text) ? new Set(search(store, text, { kinds: ["track"], lane, limit: 100_000 }).map((h) => h.id)) : null;
          const all = libraryTracks().filter((t) => shaped.has(t.id) && inLane(t) && (!wanted || wanted.has(t.id)));
          if (wanted) all.sort((a, b) => [...wanted].indexOf(a.id) - [...wanted].indexOf(b.id));
          return { trackIds: all.slice(0, max).map((t) => t.id), total: all.length };
        }
        if (!trimmed(text)) {
          const all = libraryTracks().filter(inLane);
          return { trackIds: all.slice(0, max).map((t) => t.id), total: all.length };
        }
        const hits = max === 0 ? [] : search(store, text, { kinds: ["track"], lane, limit: Math.min(max, 1000) });
        return { trackIds: hits.map((h) => h.id), total: searchCount(store, text, { kinds: ["track"], lane }) };
      },
      async updateTrack(id, patch: ApiTrackPatch) {
        return write(["tracks"], () => {
          const track = requireTrack(id);
          const changes: Record<string, unknown> = {};
          for (const key of ["title", "notes", "energy", "role", "kind"] as const) if (patch[key] !== undefined) changes[key] = patch[key];
          if (patch.loop !== undefined) changes.loopable = patch.loop;
          store.change(`Change ${quoted(shownTitle(track))}`, () => updateTrack(store, id, changes));
          return requireTrack(id);
        });
      },
      async listFolders() {
        return listRoots(store).map((r): FolderRoot => ({ path: r.path, watched: r.watched }));
      },
      async showInFolder(trackId) {
        return writeOutside([], async () => {
          const track = requireTrack(trackId);
          const row = store.get<TrackExtra>(`${TRACK_EXTRA_SQL} WHERE id = ?`, trackId) as TrackExtra;
          const file = fullPath(row, rootPaths());
          if (file === null) refuse("invalid", `"${shownTitle(track)}" plays from a web address, not a file.`);
          if (!(await probe.exists(file))) refuse("file-missing", "The file is not where your library expects it. Use Find missing files to look for it.");
          host.showItemInFolder(file);
        });
      },
      async setShape(trackId, shape) {
        return write(["tracks"], () => {
          const track = requireTrack(trackId);
          const label = shape === null ? `Let Lyre suggest the shape of ${quoted(shownTitle(track))}` : `Give ${quoted(shownTitle(track))} a shape`;
          store.change(label, () => updateTrack(store, trackId, { shape }));
          return requireTrack(trackId);
        });
      },
      async normaliseSettings() {
        return getLibraryNormalise(store);
      },
      async setNormaliseSettings(setting) {
        // Every track's gain follows it, so screens showing tracks reload.
        return write(["tracks"], () => {
          setLibraryNormalise(store, setting);
          return getLibraryNormalise(store);
        });
      },
      async setNormalise(trackId, choice) {
        return write(["tracks"], () => {
          setTrackNormalise(store, trackId, choice);
          return requireTrack(trackId);
        });
      },
      async peaksOf(trackId) {
        const state = trackPeaks(store, trackId);
        if (state.state === "ready") return Array.from(state.levels, levelOut);
        if (state.state === "needed") peakJobs?.soon(trackId);
        return null;
      },
    },

    tags: {
      async listGroups() {
        return tagGroups();
      },
      async tagTracks({ trackIds, add = [], remove = [] }) {
        return write(["tracks", "tags"], async () => {
          const ids = [...new Set(trackIds)];
          const names = new Map(libraryTracks().map((t) => [t.id, t]));
          ids.forEach((id) => names.get(id) ?? refuse("not-found", ENTITY_WORDS.track));
          const groups = new Map(tagGroups().map((g) => [g.id, g]));
          const clean = (ref: TagRef): TagRef => {
            const group = groups.get(ref.group) ?? refuse("invalid", "There is no such tag group.", "group");
            const value = tagValue(ref.value ?? "");
            if (!value) refuse("invalid", `Type a ${group.name.toLowerCase()} first.`, "value");
            return { group: group.id, value: group.values.find((v) => v.toLowerCase() === value.toLowerCase()) ?? value };
          };
          const adding = add.map(clean);
          const removing = remove.map(clean);
          const one = ids.length === 1 ? quoted(shownTitle(names.get(ids[0]))) : plural(ids.length, "track");
          const created: TagRef[] = [];
          let addIds: string[] | null = null;
          const removeIds = removing.map(tagIdOf).filter((id): id is string => !!id);
          // Many tracks are saved in batches with the event loop free between them; still one undo step.
          await store.changeInBatches(adding.length ? `Tag ${one}` : `Remove tags from ${one}`, ids, (batch) => {
            // New values are made with the first batch, so they belong to the same undo step.
            if (addIds === null) {
              addIds = adding.map((ref) => {
                const known = tagIdOf(ref);
                if (known) return known;
                created.push(ref);
                return createTag(store, { groupId: ref.group, name: ref.value }).id;
              });
            }
            if (addIds.length) void tagTracks(store, batch, addIds);
            if (removeIds.length) void untagTracks(store, batch, removeIds);
          });
          return { created };
        });
      },
    },

    playlists: {
      async list() {
        return playlistInfos();
      },
      async tracks(id) {
        return quietly(() => listPlaylistTrackIds(store, id), []);
      },
      async containing(trackId) {
        const inManual = new Set(store.all<{ playlist_id: string }>("SELECT DISTINCT playlist_id FROM playlist_items WHERE track_id = ?", trackId).map((r) => r.playlist_id));
        return playlistInfos()
          .filter((p) => (p.kind === "manual" ? inManual.has(p.id) : listPlaylistTrackIds(store, p.id).includes(trackId)))
          .map((p) => p.id);
      },
      async create(input) {
        return write(["playlists"], () => {
          const name = requireName(input.name, "playlist");
          if (!["music", "amb", "fx"].includes(input.lane)) refuse("invalid", "A playlist plays music, ambience or FX.", "lane");
          if (input.kind === "dynamic" && input.rule) checkRule(input.rule);
          let id = "";
          store.change(`New playlist ${quoted(name)}`, () => {
            if (input.kind === "manual") {
              id = createPlaylist(store, { title: name, kind: "manual", lane: input.lane as Lane, notes: input.notes ?? "", placement: "start" }).id;
              const ids = [...new Set(input.trackIds ?? [])];
              if (ids.length) addTracksToPlaylist(store, id, ids);
            } else if (input.kind === "dynamic") {
              id = createPlaylist(store, { title: name, kind: "dynamic", lane: input.lane as Lane, rule: input.rule ?? { conds: [] }, notes: input.notes ?? "", placement: "start" }).id;
            } else refuse("invalid", "A playlist is manual or dynamic.", "kind");
          });
          return requirePlaylist(id);
        });
      },
      async update(id, patch) {
        return write(["playlists"], () => {
          const pl = requirePlaylist(id);
          const changes: { title?: string; notes?: string; rule?: PlaylistRule } = {};
          if (patch.name !== undefined) changes.title = requireName(patch.name, "playlist");
          if (patch.notes !== undefined) changes.notes = String(patch.notes);
          if (patch.rule !== undefined) {
            if (pl.kind !== "dynamic") refuse("wrong-kind", `"${pl.name}" is a manual playlist: it has no rules.`);
            checkRule(patch.rule);
            changes.rule = patch.rule;
          }
          store.change(`Change playlist ${quoted(changes.title ?? pl.name)}`, () => updatePlaylist(store, id, changes));
          return requirePlaylist(id);
        });
      },
      async copyAsManual(id) {
        return write(["playlists"], () => {
          const pl = requirePlaylist(id);
          const name = `${pl.name} (manual)`;
          let made = "";
          store.change(`Make ${quoted(name)}`, () => (made = copyPlaylist(store, id, { title: name, kind: "manual" }).id));
          return requirePlaylist(made);
        });
      },
      async delete(id) {
        return write(["playlists", "campaigns", "profiles"], () => {
          const pl = requirePlaylist(id);
          store.change(`Delete playlist ${quoted(pl.name)}`, () => deletePlaylist(store, id));
        });
      },
      async addTracks(id, trackIds, at) {
        return write(["playlists"], (): AddedTracks => {
          const pl = requireManual(id);
          const known = new Set(libraryTracks().map((t) => t.id));
          trackIds.forEach((t) => known.has(t) || refuse("not-found", ENTITY_WORDS.track));
          const unique = [...new Set(trackIds)];
          const added = unique.filter((t) => !pl.trackIds.includes(t));
          const alreadyIn = unique.filter((t) => pl.trackIds.includes(t));
          if (added.length) {
            const label = `Add ${added.length === 1 ? quoted(shownTitle(requireTrack(added[0]))) : plural(added.length, "track")} to ${quoted(pl.name)}`;
            store.change(label, () => addTracksToPlaylist(store, id, added, placementAmongTracks(id, at)));
          }
          return { added, alreadyIn };
        });
      },
      async removeTrack(id, trackId) {
        return write(["playlists"], () => {
          const pl = requireManual(id);
          const item = listPlaylistItems(store, id).find((i) => i.kind === "track" && i.trackId === trackId) ?? refuse("not-found", "That track is not in this playlist.");
          store.change(`Remove ${quoted(shownTitle(requireTrack(trackId)))} from ${quoted(pl.name)}`, () => removePlaylistItems(store, [item.id]));
        });
      },
      async moveTrack(id, trackId, toIndex) {
        return write(["playlists"], () => {
          const pl = requireManual(id);
          const item = listPlaylistItems(store, id).find((i) => i.kind === "track" && i.trackId === trackId) ?? refuse("not-found", "That track is not in this playlist.");
          store.change(`Move ${quoted(shownTitle(requireTrack(trackId)))} in ${quoted(pl.name)}`, () =>
            movePlaylistItems(store, [item.id], placementAmongTracks(id, Math.max(0, toIndex), item.id)),
          );
        });
      },
      async playOrders() {
        return getPlayOrderOverrides(store);
      },
      async setPlayOrder(playlistId, place, order) {
        return write(["playlists"], () => {
          setPlayOrder(store, playlistId, place, order);
          return { shuffle: order.shuffle, repeat: order.repeat };
        });
      },
      async clearPlayOrder(playlistId, place) {
        return write(["playlists"], () => clearPlayOrder(store, playlistId, place));
      },
      async setNormalise(playlistId, choice) {
        return write(["playlists"], () => {
          setPlaylistNormalise(store, playlistId, choice);
          return requirePlaylist(playlistId);
        });
      },
    },

    boards: {
      async list() {
        const tags = tagRefsById();
        return listBoards(store).map((b) => padBoard(b.id, tags));
      },
      async create({ name, cols, rows }) {
        return write(["boards"], () => {
          const title = trimmed(name) || "Untitled board";
          let id = "";
          store.change(`New pad board ${quoted(title)}`, () => (id = createBoard(store, { title, cols, rows }).id));
          return padBoard(id);
        });
      },
      async rename(id, name) {
        return write(["boards"], () => {
          requireBoard(id);
          const title = requireName(name, "pad board");
          store.change(`Rename the pad board to ${quoted(title)}`, () => updateBoard(store, id, { title }));
          return padBoard(id);
        });
      },
      async resize(id, cols, rows) {
        return write(["boards"], () => {
          const board = requireBoard(id);
          let moved = { movedToSpare: [] as string[], cameBack: [] as string[] };
          store.change(`Resize ${quoted(board.name)} to ${cols} × ${rows}`, () => (moved = resizeBoard(store, id, { cols, rows })));
          return { board: padBoard(id), movedToSpare: moved.movedToSpare, cameBack: moved.cameBack };
        });
      },
      async duplicate(id) {
        return write(["boards"], () => {
          const board = requireBoard(id);
          const layout = getBoardLayout(store, id);
          let made = "";
          store.change(`Make ${quoted(`${board.name} (copy)`)}`, () => {
            made = createBoard(store, { title: `${board.name} (copy)`, cols: board.cols, rows: board.rows, placement: { after: id } }).id;
            const copyOf = (p: Pad, at: { row: number; col: number } | "spare") =>
              addPad(store, made, { label: p.label, icon: p.icon, color: p.color, hotkey: p.hotkey, mode: p.mode, volume: p.volume, fadeMs: p.fadeMs, fadeInMs: p.fadeInMs, sound: { ...p.sound }, at });
            layout.slots.forEach((p, i) => p && copyOf(p, cellOf(i, board.cols)));
            layout.spare.forEach((p) => copyOf(p, "spare"));
          });
          return padBoard(made);
        });
      },
      async delete(id) {
        return write(["boards", "campaigns"], () => {
          const board = requireBoard(id);
          store.change(`Delete pad board ${quoted(board.name)}`, () => deleteBoard(store, id));
        });
      },
      async addPad(boardId, slot) {
        return write(["boards"], () => {
          const board = requireBoard(boardId);
          if (!Number.isInteger(slot) || slot < 0 || slot >= board.slots.length) refuse("invalid", "That place is not on the grid.", "slot");
          if (board.slots[slot]) refuse("invalid", "That place already has a pad.", "slot");
          let id = "";
          store.change(`Add a pad to ${quoted(board.name)}`, () => (id = addPad(store, boardId, { at: cellOf(slot, board.cols) }).id));
          return requirePad(boardId, id) && padBoard(boardId).slots[slot];
        });
      },
      async updatePad(boardId, padId, patch) {
        return write(["boards"], () => {
          const { pad } = requirePad(boardId, padId);
          const changes: Record<string, unknown> = {};
          if (patch.label !== undefined) changes.label = trimmed(patch.label) || refuse("invalid", "Give the pad a label.", "label");
          for (const key of ["icon", "color", "mode", "volume"] as const) if (patch[key] !== undefined) changes[key] = patch[key];
          if (patch.key !== undefined) changes.hotkey = patch.key === "" ? null : patch.key;
          if (patch.fadeOutMs !== undefined) changes.fadeMs = patch.fadeOutMs;
          if (patch.sound !== undefined) {
            const sound: Record<string, unknown> = {};
            for (const key of ["kind", "trackIds", "order"] as const) if (patch.sound[key] !== undefined) sound[key] = patch.sound[key];
            if (patch.sound.tag !== undefined) {
              const tag = patch.sound.tag;
              sound.tagId = tag === null ? null : (tagIdOf(tag) ?? refuse("invalid", `${tag.value} is not a tag in that group.`, "sound"));
            }
            changes.sound = sound;
          }
          store.change(`Change the pad ${quoted(trimmed(patch.label) || pad.label)}`, () => updatePad(store, padId, changes));
          return requirePad(boardId, padId) && apiPad(requirePad(boardId, padId).pad, tagRefsById());
        });
      },
      async duplicatePad(boardId, padId) {
        return write(["boards"], () => {
          const { layout, pad, where, index } = requirePad(boardId, padId);
          // As the prototype: the next empty place after the pad (round to the start), else the spare pads.
          const start = where === "slot" ? index + 1 : 0;
          let place: PadPlace = "spare";
          for (let k = 0; k < layout.slots.length; k++) {
            const i = (start + k) % layout.slots.length;
            if (!layout.slots[i]) {
              place = { slot: i };
              break;
            }
          }
          let id = "";
          store.change(`Make ${quoted(`${pad.label} (copy)`)}`, () => {
            id = addPad(store, boardId, {
              label: `${pad.label} (copy)`,
              icon: pad.icon,
              color: pad.color,
              hotkey: null,
              mode: pad.mode,
              volume: pad.volume,
              fadeMs: pad.fadeMs,
              fadeInMs: pad.fadeInMs,
              sound: { ...pad.sound },
              at: place === "spare" ? "spare" : cellOf(place.slot, layout.board.cols),
            }).id;
          });
          return { pad: apiPad(requirePad(boardId, id).pad, tagRefsById()), place };
        });
      },
      async movePad(boardId, padId, to) {
        return write(["boards"], () => {
          const { layout, pad } = requirePad(boardId, padId);
          if (to === "spare") {
            store.change(`Move the pad ${quoted(pad.label)}`, () => movePad(store, padId, "spare"));
            return { swappedWith: null };
          }
          if (!to || !Number.isInteger(to.slot) || to.slot < 0 || to.slot >= layout.slots.length) refuse("invalid", "That place is not on the grid.", "slot");
          const other = layout.slots[to.slot];
          if (other?.id === padId) return { swappedWith: null };
          store.change(`Move the pad ${quoted(pad.label)}`, () => movePad(store, padId, cellOf(to.slot, layout.board.cols)));
          return { swappedWith: other?.id ?? null };
        });
      },
      async putAllBack(boardId) {
        return write(["boards"], () => {
          const board = requireBoard(boardId);
          const empty = board.slots.map((p, i) => (p ? -1 : i)).filter((i) => i > -1);
          const moving = board.spare.slice(0, empty.length);
          if (moving.length) {
            store.change(`Put spare pads back on ${quoted(board.name)}`, () => moving.forEach((p, n) => movePad(store, p.id, cellOf(empty[n], board.cols))));
          }
          return { putBack: moving.map((p) => p.id) };
        });
      },
      async deletePad(boardId, padId) {
        return write(["boards"], () => {
          const { pad } = requirePad(boardId, padId);
          store.change(`Delete the pad ${quoted(pad.label)}`, () => deletePads(store, [padId]));
        });
      },
    },

    campaigns: {
      async list() {
        return allCampaignInfos();
      },
      async get(id) {
        return campaignById(id);
      },
      async create(input) {
        return write(["campaigns"], () => {
          const name = requireName(input.name, "campaign");
          const theme = input.theme ?? "candle";
          if (!(CAMPAIGN_THEMES as readonly string[]).includes(theme)) refuse("invalid", "Choose one of the themes.", "theme");
          let id = "";
          store.change(`New campaign ${quoted(name)}`, () => {
            id = createCampaign(store, { name, theme, system: trimmed(input.system), description: trimmed(input.description), obsidian: input.obsidian ?? {} }).id;
            const session = createSession(store, { campaignId: id, status: "draft" });
            createScene(store, { sessionId: session.id, name: "Opening scene" });
          });
          return requireCampaign(id);
        });
      },
      async update(id, patch) {
        return write(["campaigns"], () => {
          const c = requireCampaign(id);
          const changes: Record<string, unknown> = {};
          if (patch.name !== undefined) changes.name = requireName(patch.name, "campaign");
          for (const key of ["system", "theme", "description", "notes", "obsidian"] as const) if (patch[key] !== undefined) changes[key] = patch[key];
          store.change(`Change the campaign ${quoted((changes.name as string) ?? c.name)}`, () => updateCampaign(store, id, changes));
          return requireCampaign(id);
        });
      },
      async setOnHand(owner, kind, ids) {
        return write(["campaigns"], () => {
          const c = requireCampaign(owner.campaignId);
          const target = owner.sessionId ? requireSession(owner.campaignId, owner.sessionId) : c;
          const wanted = [...new Set(ids)];
          if (kind === "playlists") wanted.forEach(requirePlaylist);
          else if (kind === "boards") wanted.forEach(requireBoard);
          else if (kind === "tracks") wanted.forEach(requireTrack);
          else refuse("invalid", "A campaign keeps playlists, pad boards and tracks on hand.", "kind");
          const key = kind === "playlists" ? "playlistIds" : kind === "boards" ? "boardIds" : "trackIds";
          const words = kind === "playlists" ? "playlists" : kind === "boards" ? "pad boards" : "tracks";
          const where = owner.sessionId ? `session ${(target as SessionInfo).number}` : quoted(c.name);
          store.change(`Change the ${words} on hand in ${where}`, () => {
            const current = { playlistIds: [] as string[], boardIds: [] as string[], trackIds: [] as string[], [key]: target[key] };
            if (owner.sessionId) {
              removeFromSession(store, owner.sessionId, current);
              addToSession(store, owner.sessionId, { [key]: wanted });
            } else {
              removeFromCampaign(store, owner.campaignId, current);
              addToCampaign(store, owner.campaignId, { [key]: wanted });
            }
          });
        });
      },
      async usesOf(ref) {
        const item = ref.kind === "playlist" ? { playlistId: ref.id } : ref.kind === "board" ? { boardId: ref.id } : { trackId: ref.id };
        return quietly((): Use[] => listUses(store, item), []);
      },
      async setUses(ref, places) {
        return write(["campaigns"], () => {
          const name = ref.kind === "board" ? requireBoard(ref.id).name : ref.kind === "track" ? shownTitle(requireTrack(ref.id)) : requirePlaylist(ref.id).name;
          const targets: UseTarget[] = places.map((p) => {
            if (p.sceneId) return { sceneId: requireScene({ campaignId: p.campaignId, sessionId: p.sessionId, sceneId: p.sceneId }).scene.id };
            if (p.sessionId) return { sessionId: requireSession(p.campaignId, p.sessionId).id };
            return { campaignId: requireCampaign(p.campaignId).id };
          });
          const label = places.length ? `Use ${quoted(name)} in ${plural(places.length, "place")}` : `Stop using ${quoted(name)}`;
          store.change(label, () =>
            ref.kind === "board" ? setBoardUses(store, ref.id, targets) : ref.kind === "track" ? setTrackUses(store, ref.id, targets) : setPlaylistUses(store, ref.id, targets),
          );
        });
      },
    },

    sessions: {
      async create(campaignId) {
        return write(["campaigns"], () => {
          requireCampaign(campaignId);
          let id = "";
          store.change("New session", () => {
            id = createSession(store, { campaignId }).id;
            createScene(store, { sessionId: id, name: "Opening scene" });
          });
          return requireSession(campaignId, id);
        });
      },
      async update(campaignId, sessionId, patch) {
        return write(["campaigns"], () => {
          const s = requireSession(campaignId, sessionId);
          const changes: Record<string, unknown> = {};
          if (patch.name !== undefined) changes.name = trimmed(patch.name);
          if (patch.noteLink !== undefined) changes.noteLink = String(patch.noteLink);
          if (patch.date !== undefined) changes.date = patch.date || null;
          if (patch.status !== undefined) changes.status = patch.status;
          store.change(`Change session ${s.number}`, () => updateSession(store, sessionId, changes));
          return requireSession(campaignId, sessionId);
        });
      },
      async move(campaignId, sessionId, toIndex) {
        return write(["campaigns"], () => {
          const c = requireCampaign(campaignId);
          const s = requireSession(campaignId, sessionId);
          const placement = placementAt(c.sessions.map((x) => x.id), sessionId, toIndex);
          store.change(`Move ${s.name ? quoted(s.name) : `session ${s.number}`}`, () => moveSession(store, sessionId, { placement }));
        });
      },
      async createScene(campaignId, sessionId, after) {
        return write(["campaigns"], () => {
          const s = requireSession(campaignId, sessionId);
          if (after !== undefined && !s.scenes.some((x) => x.id === after)) refuse("not-found", ENTITY_WORDS.scene);
          let id = "";
          store.change("Add a scene", () => (id = createScene(store, { sessionId, name: "New scene", placement: after === undefined ? "end" : { after } }).id));
          return requireScene({ campaignId, sessionId, sceneId: id }).scene;
        });
      },
      async updateScene(address, patch) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          const changes: Record<string, string> = {};
          for (const key of ["name", "startsWhen", "notes", "noteLink"] as const) if (patch[key] !== undefined) changes[key] = String(patch[key]);
          store.change(`Change the scene ${quoted(changes.name ?? scene.name)}`, () => updateScene(store, address.sceneId, changes));
          return requireScene(address).scene;
        });
      },
      async moveScene(address, toIndex) {
        return write(["campaigns"], () => {
          const { session, scene } = requireScene(address);
          const placement = placementAt(session.scenes.map((x) => x.id), scene.id, toIndex);
          store.change(`Move the scene ${quoted(scene.name)}`, () => moveScene(store, scene.id, { placement }));
        });
      },
      async duplicateScene(address) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          const name = `${scene.name || "Scene"} (copy)`;
          let id = "";
          store.change(`Make ${quoted(name)}`, () => {
            id = createScene(store, { sessionId: address.sessionId, name, startsWhen: scene.startsWhen, notes: scene.notes, noteLink: scene.noteLink, placement: { after: scene.id } }).id;
            if (scene.music.length) addSceneMusic(store, id, scene.music);
            if (scene.ambience) setSceneAmbience(store, id, scene.ambience);
            if (scene.boardIds.length) addSceneBoards(store, id, scene.boardIds);
            // DAT-14: a copy of the scene keeps its names for its tracks.
            for (const [trackId, name] of Object.entries(scene.trackNames)) setSceneTrackName(store, id, trackId, name);
          });
          return requireScene({ ...address, sceneId: id }).scene;
        });
      },
      async deleteScene(address) {
        // The scene's own play orders go with it (ON DELETE CASCADE), so playlists' places change too.
        return write(["campaigns", "profiles", "playlists"], () => {
          const { scene } = requireScene(address);
          store.change(`Delete the scene ${quoted(scene.name)}`, () => deleteScene(store, scene.id));
        });
      },
      async setSceneMusic(address, music) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          const tracks = new Map(libraryTracks().map((t) => [t.id, t]));
          const playlists = new Map(playlistInfos().map((p) => [p.id, p]));
          music.forEach((ref) => checkMusic(ref, tracks, playlists));
          store.change(`Change the music of ${quoted(scene.name)}`, () => {
            const items = listSceneMusic(store, scene.id).map((i) => i.id);
            if (items.length) removeSceneMusic(store, items);
            if (music.length) addSceneMusic(store, scene.id, music);
          });
        });
      },
      async setSceneAmbience(address, ambience) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          if (ambience) {
            const isAmb = ambience.kind === "track" ? requireTrack(ambience.id).kind === "amb" : requirePlaylist(ambience.id).lane === "amb";
            if (!isAmb) refuse("wrong-kind", "A scene's ambience is an ambience track or an ambience playlist.");
          }
          store.change(`Change the ambience of ${quoted(scene.name)}`, () => setSceneAmbience(store, scene.id, ambience));
        });
      },
      async setSceneBoards(address, boardIds) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          const wanted = [...new Set(boardIds)];
          wanted.forEach(requireBoard);
          store.change(`Change the pad boards of ${quoted(scene.name)}`, () => {
            if (scene.boardIds.length) removeSceneBoards(store, scene.id, scene.boardIds);
            if (wanted.length) addSceneBoards(store, scene.id, wanted);
          });
        });
      },
      async setTrackName(address, trackId, name) {
        return write(["campaigns"], () => {
          const { scene } = requireScene(address);
          requireTrack(trackId);
          if (typeof name !== "string") refuse("invalid", "A name is text.", "name");
          setSceneTrackName(store, scene.id, trackId, name);
        });
      },
    },

    profiles: {
      async overrides() {
        return getProfileOverrides(store);
      },
      async set(trackId, place, profile) {
        return write(place ? ["profiles"] : ["tracks", "profiles"], () => {
          const track = requireTrack(trackId);
          if (place) placeExists(place);
          store.change(`Change the audio profile of ${quoted(shownTitle(track))}`, () => {
            if (place) setProfileOverride(store, place, trackId, profile ?? {});
            else updateTrack(store, trackId, { profile: profile ?? {} });
          });
        });
      },
      async clear(trackId, place) {
        return write(["profiles"], () => {
          const track = requireTrack(trackId);
          placeExists(place);
          if (!getProfileOverride(store, place, trackId)) refuse("not-found", "This place already uses the track's own settings.");
          store.change(`Use the track's own settings for ${quoted(shownTitle(track))}`, () => clearProfileOverride(store, place, trackId));
        });
      },
    },

    import: {
      async start(source) {
        if (importing) return { ok: false, refusal: { code: "busy", message: "Lyre is still adding files. Wait for it to finish, then try again." } };
        importing = true;
        try {
          let paths: string[] | null;
          if (source.from === "paths") paths = source.paths;
          else if (source.from === "choose-files") paths = await host.chooseFiles();
          else {
            const folder = await host.chooseFolder();
            paths = folder ? [folder] : null;
          }
          if (!paths || paths.length === 0) {
            const nothing: ImportSummary = { added: [], alreadyInLibrary: [], trackIds: [], problems: [], cancelled: true, summary: "Nothing was added." };
            return { ok: true, value: nothing, changed: [], undoLabel: stateLabel() };
          }
          let added = false;
          const done = await writeOutside([], async () => {
            const result = await importAudio(store, { paths }, { tagReader: options.tagReader, lengthProbe: options.lengthProbe, onProgress: (progress) => emit({ type: "import-progress", progress }) });
            added = result.added.length > 0;
            peakJobs?.inBackground(result.added);
            // The import clears the undo history (DB review item 10), so the history changed too.
            if (added) emit({ type: "changed", areas: ["tracks", "history"] });
            const summary: ImportSummary = {
              added: result.added,
              alreadyInLibrary: result.alreadyInLibrary,
              trackIds: result.trackIds,
              problems: result.problems.map((p) => ({ file: p.path, reason: p.reason })),
              cancelled: result.cancelled,
              summary: result.summary,
            };
            return summary;
          });
          return done.ok && added ? { ...done, changed: ["tracks", "history"] } : done;
        } finally {
          importing = false;
        }
      },
      async watchFolder(source) {
        const path = source.from === "path" ? source.path : await host.chooseFolder();
        if (!path) return { ok: true, value: null, changed: [], undoLabel: stateLabel() };
        return writeOutside(["folders", "tracks"], async () => {
          const known = listRoots(store).find((r) => r.path.toLowerCase() === path.toLowerCase());
          if (known?.watched) refuse("already-watched", `Lyre is already watching ${path}.`);
          // Adding a library folder is kept by itself: the history is not the place to take a watch back.
          store.changeWithoutHistory(
            () => {
              if (known) updateRoot(store, known.id, { watched: true });
              else void addRoot(store, { name: path.split(/[\\/]/).filter(Boolean).pop() || path, path, watched: true });
            },
            { bookkeeping: true },
          );
          const root = listRoots(store).find((r) => r.path.toLowerCase() === path.toLowerCase());
          return { path: root.path, watched: true };
        });
      },
      async findMissing() {
        return (await findMissingTracks(store, { probe })).map((m): MissingTrack => ({
          id: m.id,
          title: m.title,
          path: m.path,
          fileName: m.fileName,
          folder: m.path.slice(0, Math.max(0, lastSeparator(m.path))),
          sizeBytes: m.size,
        }));
      },
      async planRelink(source) {
        const folder = source.from === "path" ? source.path : await host.chooseFolder();
        if (!folder) {
          const none: ApiRelinkPlan = { folder: "", matches: [], ambiguous: [], notFound: [], summary: "No folder was chosen." };
          return { ok: true, value: none, changed: [], undoLabel: stateLabel() };
        }
        return writeOutside([], async () => {
          // Security review 5: looking through a whole drive or a system folder would read every file in it.
          const unsafe = unsafeFolderReason(folder);
          if (unsafe) refuse("invalid", unsafe, "path");
          const plan = await planRelink(store, await findMissingTracks(store, { probe }), folder, { probe });
          planned = new Map(plan.matches.map((m) => [relinkKey(m.trackId, m.to), m]));
          plannedChoices = new Set(plan.ambiguous.flatMap((a) => a.candidates.map((to) => relinkKey(a.trackId, to))));
          return {
            folder,
            matches: plan.matches.map((m) => ({ trackId: m.trackId, from: m.from, to: m.to, confidence: m.confidence, toUrl: fileAddress(m.to) })),
            ambiguous: plan.ambiguous,
            notFound: plan.notFound,
            summary: plan.summary,
          };
        });
      },
      async applyRelink(matches) {
        return write(["tracks"], async () => {
          matches.forEach((m) => requireTrack(m.trackId));
          const chosen = matches.map((m) => {
            const key = relinkKey(m.trackId, m.to);
            const match = planned.get(key) ?? (plannedChoices.has(key) ? { trackId: m.trackId, to: m.to } : undefined);
            if (!match) refuse("invalid", "Lyre did not find that file for this track. Look for the missing files again, then relink.", "to");
            return match;
          });
          await applyRelink(store, chosen);
          planned = new Map();
          plannedChoices = new Set();
          return { relinked: matches.map((m) => m.trackId) };
        });
      },
    },

    transfer: {
      async estimate(scope) {
        const out = estimateTransfer(scope, currentLibrary(), dayOf(transferFiles.today()));
        if (!out) throw new Error("That is no longer in your library.");
        return out;
      },
      async save(request) {
        return writeOutside([], async () => {
          const lib = currentLibrary();
          const estimate = estimateTransfer(request.scope, lib, dayOf(transferFiles.today())) ?? refuse("not-found", "That is no longer in your library.");
          const target = request.path ?? (await host.chooseSaveFile(estimate.fileName));
          if (!target) return null;
          return saveLyreFile({
            target,
            scope: request.scope,
            estimate,
            contents: transferContents(request.scope, lib) ?? refuse("not-found", "That is no longer in your library."),
            overrides: getProfileOverrides(store),
            playOrders: getPlayOrderOverrides(store),
            includeAudio: request.includeAudio,
            fileOf: (trackId) => trackFile(trackId),
            probe,
            savedAt: transferFiles.today(),
          });
        });
      },
      async open(source) {
        return writeOutside([], async () => {
          const file = source.from === "path" ? source.path : await host.chooseLyreFile();
          if (!file) return null;
          const next = await openLyreFile(file, currentLibrary());
          await opened?.close();
          opened = next;
          return next.preview;
        });
      },
      async bringIn(openedId, choices) {
        const file = opened;
        if (!file || file.preview.id !== openedId) return { ok: false, refusal: { code: "not-found", message: "Open the file again: Lyre no longer has it open." } };
        return write(["tracks", "tags", "playlists", "boards", "campaigns", "profiles"], async () => {
          // As an import does: a backup first, so the library can be put back as it was.
          await library.backupBeforeImport();
          // The backup's last step and reading the library each take a turn of their own (security review w4, Should 3).
          await nextTurn();
          const report = await bringInLyreFile(store, file, currentLibrary(), choices, transferFiles);
          opened = null;
          await file.close();
          return report;
        });
      },
      async movedReport() {
        // What the first start's move from the old player recorded (import/legacy.ts, library_jobs).
        const job = store.get<{ detail: string; finished_at: number | null }>("SELECT detail, finished_at FROM library_jobs WHERE name = 'legacy-player' AND state = 'done'");
        const report = job
          ? (JSON.parse(job.detail).report as { status?: string; from?: string; bookmarks?: number; counts?: { playlists: number; tracks: number; boards: number; pads: number }; missingTrackIds?: string[] } | undefined)
          : undefined;
        if (!job || !report?.counts || report.status === "nothing-to-move") return null;
        const gone = new Set(report.missingTrackIds ?? []);
        const missing = gone.size ? (await api.import.findMissing()).filter((m) => gone.has(m.id)) : [];
        return {
          // The record names the app and its version when it knows them ("Kenku FM 1.5.5").
          from: typeof report.from === "string" && /^Kenku FM\b/.test(report.from) ? report.from : "Kenku FM",
          at: job.finished_at ?? 0,
          copied: [
            { what: "Playlists", count: report.counts.playlists, nowIn: "Playlists (Manual)", route: "#/playlists" },
            { what: "Tracks", count: report.counts.tracks, nowIn: "Library", route: "#/library" },
            { what: "Soundboards", count: report.counts.boards, nowIn: "Pad boards", route: "#/boards" },
            { what: "Sounds", count: report.counts.pads, nowIn: "Pads on those boards", route: "#/boards" },
            ...(typeof report.bookmarks === "number" ? [{ what: "Bookmarks", count: report.bookmarks, nowIn: "Website tabs", route: null }] : []),
          ],
          missing,
          notBrought: NOT_BROUGHT_ACROSS.map((x) => ({ ...x })),
        };
      },
    },

    history: {
      async state() {
        return history.state();
      },
      async undo() {
        try {
          const label = await history.undo();
          if (label === null) return { ok: false, refusal: { code: "nothing-to-undo", message: "There is nothing to undo." } };
          // The history does not know which parts a step touched, so every part is reloaded.
          const changed: LyreArea[] = ["tracks", "tags", "folders", "playlists", "boards", "campaigns", "profiles", "history"];
          emit({ type: "changed", areas: changed });
          return { ok: true, value: { undone: label }, changed, undoLabel: stateLabel() };
        } catch (error) {
          const refusal = refusalFor(error);
          if (refusal) return { ok: false, refusal };
          throw error;
        }
      },
      async redo() {
        try {
          const label = await history.redo();
          if (label === null) return { ok: false, refusal: { code: "nothing-to-redo", message: "There is nothing to redo." } };
          const changed: LyreArea[] = ["tracks", "tags", "folders", "playlists", "boards", "campaigns", "profiles", "history"];
          emit({ type: "changed", areas: changed });
          return { ok: true, value: { redone: label }, changed, undoLabel: stateLabel() };
        } catch (error) {
          const refusal = refusalFor(error);
          if (refusal) return { ok: false, refusal };
          throw error;
        }
      },
    },

    stopBackgroundWork() {
      if (loudnessSweep) clearTimeout(loudnessSweep);
      peakJobs?.close();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  // Security review 5: every method's arguments are checked for their shape before the library acts on them.
  return withCheckedArguments(api, options.log);
}
