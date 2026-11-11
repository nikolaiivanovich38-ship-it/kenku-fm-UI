/**
 * An in-memory LyreApi over the prototype's sample data (seed.ts), for tests and the e2e demo. It behaves as the
 * main-process implementation will: every write checks its input and refuses in plain words, makes one undo step
 * (or none when nothing changed, or for imports, which clear the history as the database does), and sends a
 * "changed" event naming the areas to reload. The shared rules come from src/common/domain.
 *
 * It has no files: a path with an audio extension counts as an audio file, a folder holds what `folderFiles` says,
 * and choosers answer what `choose` says. `arrive` stands in for files appearing in a watched folder.
 */
import {
  isFx,
  keyOfPlace,
  placeKey,
  playlistTracks,
  reflowBoard,
  shapeFromPeaks,
  shapeOf,
  usesOfBoard,
  usesOfPlaylist,
  usesOfTrack,
  PAD_MODES,
  REPEATS,
  TRACK_KINDS,
  TRACK_ROLES,
  TRACK_SHAPES,
  SHAPE_WORDS,
  NORMALISE_CHOICES,
  NORMALISE_TARGETS,
  DEFAULT_LIBRARY_NORMALISE,
  DEFAULT_DEVICES,
  DEFAULT_DISPLAY,
  type AudioProfileInput,
  type LibraryNormalise,
  type NormaliseChoice,
  type DomainLookup,
  type PlayOrder,
  type PlayOrderOverrides,
  type PlaylistRule,
  type ProfileOverrides,
  type ProfilePlace,
  type SoundRef,
  type Use,
  placeOrderToKeep,
  tracksInPlaceOrder,
  type TrackOrders,
} from "../domain";
import {
  CAMPAIGN_THEMES,
  PAD_COLORS,
  SESSION_STATUSES,
  type BringInReport,
  type CampaignInfo,
  type DuplicateChoice,
  type FindRequest,
  type FindResult,
  type FolderRoot,
  type IncomingItem,
  NOT_SAVED,
  type MoveReport,
  type OpenedFile,
  type PlayPlace,
  type HistoryState,
  type ImportProgress,
  type ImportSource,
  type ImportSummary,
  type LibraryTrack,
  type LyreApi,
  type LyreArea,
  type LyreEvent,
  type MissingTrack,
  type Pad,
  type PadBoard,
  type PadPatch,
  type PadPlace,
  type PlaylistInfo,
  type RefusalCode,
  type RelinkPlan,
  type SceneAddress,
  type SceneInfo,
  type SessionInfo,
  type TagGroup,
  type TagRef,
  type WriteResult,
} from "./api";
import { inVocabularyOrder, lookupFrom, tagTreeOf } from "./lookup";
import { prototypeLevels } from "./prototypeLevels";
import { fileAddress } from "./media";
import { plural, quoted, shownTitle, tagValue, trimmed } from "./text";
import { defaultRound7State, dropReferences, fakeRound7, itemsOf, setItems, type Round7State } from "./fakeRound7";
import { prototypeSeed, type SeedData } from "./seed";
import { estimateTransfer, transferContents, type TransferContents } from "./transfer";

export interface FakeLyreOptions {
  /** The starting library (default: the prototype's sample data). */
  seed?: SeedData;
  /** The clock, for when tracks are added. */
  now?: () => number;
  /** Sample tracks whose files have gone (default: the seed's, t19, t26 and t37). */
  missingTrackIds?: string[];
  /** File names in folders (a folder's subfolders are keys under it), for imports, relinking and watched folders. */
  folderFiles?: Record<string, string[]>;
  /** What the file and folder choosers answer; null is "closed without choosing" (the default). */
  choose?: { files?: () => string[] | null; folder?: () => string | null; saveFile?: (suggested: string) => string | null; lyreFile?: () => string | null };
  /** DAT-7: what came across from Kenku FM (default: the prototype's sample report; null: nothing did). */
  moved?: Omit<MoveReport, "missing"> | null;
}

export interface FakeLyreApi extends LyreApi {
  /** UX-19: the next write fails as a full or read-only drive would ("not-saved"), once (the test builds' hook). */
  failNextWrite(): void;
  /** SEC-17: the found file the page may preview now (import.previewFound), as the main process lists it; or none. */
  previewableFiles(): string[];
  /** Files appear in a watched folder: they become New tracks, as the real folder watcher makes them. Returns their ids. */
  arrive(folder: string, fileNames: string[]): Promise<string[]>;
}

/* ---------- state ---------- */

interface State {
  tracks: LibraryTrack[];
  tagGroups: TagGroup[];
  folders: FolderRoot[];
  playlists: PlaylistInfo[];
  boards: PadBoard[];
  campaigns: CampaignInfo[];
  overrides: ProfileOverrides;
  /** PLY-13: play order chosen in a place (part of the "playlists" area; a playlist's own order is on the playlist). */
  playOrders: PlayOrderOverrides;
  /** ORG-13: a playlist's track order chosen in a place (part of the "playlists" area). */
  trackOrders: TrackOrders;
  /** Ids of tracks whose files have gone (part of the "tracks" area). */
  missing: string[];
  /** PLY-15: the library's Normalise volume setting (part of the "tracks" area: every track's gain follows it). */
  normalise: LibraryNormalise;
  /** Round 7 (fakeRound7.ts): folders ("playlists" and "boards" areas) and the settings kept with the library. */
  playlistFolders: Round7State["playlistFolders"];
  boardFolders: Round7State["boardFolders"];
  settings: Round7State["settings"];
}

/** Which part of the state each area is: an undo step keeps a copy of the parts its areas name. */
const SLICES: Record<Exclude<LyreArea, "history">, (keyof State)[]> = {
  tracks: ["tracks", "missing", "normalise"],
  tags: ["tagGroups"],
  folders: ["folders"],
  playlists: ["playlists", "playOrders", "trackOrders", "playlistFolders"],
  boards: ["boards", "boardFolders"],
  settings: ["settings"],
  campaigns: ["campaigns"],
  profiles: ["overrides"],
  // Loudness peaks are worked out from files, outside undo: no part of the state.
  peaks: [],
};

type Slices = Partial<State>;
interface Step {
  label: string;
  areas: LyreArea[];
  before: Slices;
  after: Slices;
}

/** Thrown inside a write to refuse it; the write puts everything back. */
class Refusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    // The app's bundles compile classes to ES5, where a subclass of Error loses its prototype (errorsBuilt.test.ts).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
function refuse(code: RefusalCode, message: string, field?: string): never {
  throw new Refusal(code, message, field);
}

/** Every value the API hands out or takes in is a plain copy, so callers and the state never share objects. */
const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const AUDIO = /\.(flac|mp3|wav|ogg|m4a|aac|wma|aif|aiff|opus)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A pad key: one character (not a space), or F1 to F12. */
const KEY = /^(F([1-9]|1[0-2])|\S)$/;

const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];
const isInt = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
const clampIndex = (i: number, length: number) => Math.max(0, Math.min(length, Math.floor(Number.isFinite(i) ? i : length)));
const splitPath = (p: string) => {
  const at = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return { folder: at < 0 ? "" : p.slice(0, at), name: at < 0 ? p : p.slice(at + 1) };
};
const pathOf = (t: LibraryTrack) => (t.folder ? `${t.folder}\\${t.fileName}` : t.fileName);
/** Built at run time: the TypeScript target predates the u flag (as in src/main/data/repo/search.ts). */
const NOT_LETTER_OR_DIGIT = new RegExp("[^\\p{L}\\p{N}]+", "u");
/** Words for search: lower case, accents removed, split at anything that is not a letter or digit. */
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(NOT_LETTER_OR_DIGIT)
    .filter(Boolean);
/** The kind a new file gets from its folder (as the database's import guesses it). */
function guessKind(folder: string): LibraryTrack["kind"] {
  if (/(^|\\|\/)(ambien\w*|atmos\w*|beds?)(\\|\/|$)/i.test(folder)) return "amb";
  if (/(^|\\|\/)(effects?|sfx|foley)(\\|\/|$)/i.test(folder)) return "fx";
  return "music";
}

/** A made-up loudness for a track the fake "measures" (-26 to -14 LUFS, peaks 8 to 14 dB above it, at most 0 dBTP). */
export function madeUpLoudness(trackId: string): { lufs: number; truePeakDb: number } {
  let hash = 7;
  for (const c of trackId) hash = (hash * 33 + c.charCodeAt(0)) >>> 0;
  const lufs = -26 + (hash % 120) / 10;
  return { lufs: Math.round(lufs * 10) / 10, truePeakDb: Math.min(0, Math.round((lufs + 8 + ((hash >> 8) % 60) / 10) * 10) / 10) };
}

export function createFakeLyreApi(options: FakeLyreOptions = {}): FakeLyreApi {
  const now = options.now ?? (() => Date.now());
  const seed = copy(options.seed ?? prototypeSeed(now()));
  let state: State = {
    tracks: seed.tracks,
    tagGroups: seed.tagGroups,
    folders: seed.folders,
    playlists: seed.playlists,
    boards: seed.boards,
    campaigns: seed.campaigns,
    overrides: seed.overrides,
    playOrders: seed.playOrders,
    trackOrders: {},
    missing: [...(options.missingTrackIds ?? seed.missing)],
    normalise: { ...(seed.normalise ?? DEFAULT_LIBRARY_NORMALISE) },
    ...defaultRound7State(),
  };
  /** Round 7: this computer's settings (no undo step; LyreSettings). */
  const computer = { display: { ...DEFAULT_DISPLAY }, devices: { ...DEFAULT_DEVICES }, globalKeys: false };
  /** DAT-7: .lyre files saved so far, by path (lower case), as a real file would hold them. */
  const lyreFiles = new Map<string, { contents: TransferContents; includesAudio: boolean; savedAt: number }>();
  let opened: { id: string; file: string; items: (IncomingItem & { take: () => void; merge: () => void; copy: () => void; ids: () => { id: string; name: string } })[] } | null = null;
  const folderFiles = options.folderFiles ?? {};
  let undoStack: Step[] = [];
  let redoStack: Step[] = [];
  let importing = false;
  /** UX-19: failNextWrite was called. */
  let failNext = false;
  /** DAT-8, SEC-17: the last relink plan, and the one found file Find missing files may preview now. */
  let lastPlan: RelinkPlan | null = null;
  let previewing: string | null = null;
  /** Loudness peaks worked out so far, and those being worked out (not part of undo, as in the real library). */
  // The sample tracks' peaks are in the seed, as a library that has read their files has them (DAT-13).
  const peaks = new Map<string, number[]>(Object.entries(seed.peaks ?? {}));
  const workingOut = new Set<string>();
  let nextId = 1;
  const listeners = new Set<(event: LyreEvent) => void>();

  /* ---------- plumbing ---------- */

  function emit(event: LyreEvent) {
    // Events arrive after the call that caused them, as they will over IPC.
    queueMicrotask(() => [...listeners].forEach((l) => l(copy(event))));
  }
  /**
   * Stands in for working out peaks from the files: a made-up shape per track (a fade in, swells, a fade out), ready
   * a moment later with a "changed" event for "peaks", as the real library sends after ffmpeg has read the file.
   */
  function workOutPeaks(ids: string[]) {
    // A sample track has its peaks from the seed but may not be measured yet: the job still measures it (DAT-15).
    const todo = ids.filter((id) => (!peaks.has(id) || !state.tracks.find((t) => t.id === id)?.loudness) && !workingOut.has(id) && state.tracks.some((t) => t.id === id) && !state.missing.includes(id));
    if (todo.length === 0) return;
    todo.forEach((id) => workingOut.add(id));
    queueMicrotask(() => {
      for (const id of todo) {
        workingOut.delete(id);
        const t = state.tracks.find((x) => x.id === id);
        if (!t) continue;
        // The prototype's made-up loudness (core.js L.levels), so the suggestions are the design's.
        peaks.set(id, prototypeLevels(t));
        // DAT-13: the suggestion is kept with the peaks, outside undo, as the library keeps it.
        t.suggestedShape = shapeFromPeaks(peaks.get(id));
        // DAT-15: the same job measures loudness; a made-up figure stands in for ffmpeg's.
        t.loudness ??= madeUpLoudness(id);
      }
      emit({ type: "changed", areas: ["peaks"] });
    });
  }
  function newId(prefix: string) {
    return `${prefix}-${nextId++}`;
  }
  function slicesOf(areas: LyreArea[]): Slices {
    const out: Slices = {};
    for (const area of areas) if (area !== "history") for (const key of SLICES[area]) (out as Record<string, unknown>)[key] = copy(state[key]);
    return out;
  }
  function restore(slices: Slices) {
    state = { ...state, ...copy(slices) };
  }
  function refused(e: unknown): WriteResult<never> {
    if (e instanceof Refusal) return { ok: false, refusal: e.field ? { code: e.code, message: e.message, field: e.field } : { code: e.code, message: e.message } };
    throw e;
  }

  /**
   * One undoable write: `fn` changes the state (only the parts `areas` name) and returns the value to hand back, or
   * refuses. A refusal or a write that changed nothing leaves no undo step and sends no event.
   */
  function write<T>(label: string | ((value: T) => string), areas: LyreArea[], fn: () => T): WriteResult<T> {
    if (failNext) {
      failNext = false;
      return { ok: false, refusal: { code: "not-saved", message: NOT_SAVED } };
    }
    const before = slicesOf(areas);
    let value: T;
    try {
      value = fn();
    } catch (e) {
      restore(before);
      return refused(e);
    }
    const after = slicesOf(areas);
    if (JSON.stringify(after) === JSON.stringify(before)) return { ok: true, value: copy(value), changed: [], undoLabel: last(undoStack)?.label ?? null };
    const step: Step = { label: typeof label === "string" ? label : label(value), areas, before, after };
    undoStack.push(step);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    const changed = [...areas, "history" as const];
    emit({ type: "changed", areas: changed });
    return { ok: true, value: copy(value), changed, undoLabel: step.label };
  }
  /** A write the history does not keep (imports, watched folders): the database clears the history after an import. */
  function writeWithoutHistory<T>(areas: LyreArea[], clearHistory: boolean, fn: () => T): WriteResult<T> {
    const before = slicesOf(areas);
    let value: T;
    try {
      value = fn();
    } catch (e) {
      restore(before);
      return refused(e);
    }
    const changed: LyreArea[] = JSON.stringify(slicesOf(areas)) === JSON.stringify(before) ? [] : [...areas];
    if (clearHistory && changed.length && (undoStack.length || redoStack.length)) {
      undoStack = [];
      redoStack = [];
      changed.push("history");
    }
    if (changed.length) emit({ type: "changed", areas: changed });
    return { ok: true, value: copy(value), changed, undoLabel: last(undoStack)?.label ?? null };
  }

  /* ---------- look-ups that refuse ---------- */

  const lookup = (): DomainLookup => lookupFrom(state.tracks, state.playlists, tagTreeOf(state.tagGroups));
  function track(id: string): LibraryTrack {
    return state.tracks.find((t) => t.id === id) ?? refuse("not-found", "That track is no longer in your library.");
  }
  /** PLY-15: On, Off, or null for the library's setting. */
  function checkNormalise(choice: NormaliseChoice | null) {
    if (choice !== null && !(NORMALISE_CHOICES as readonly string[]).includes(choice)) refuse("invalid", "Choose Library setting, On or Off.", "normalise");
  }
  function playlist(id: string): PlaylistInfo {
    return state.playlists.find((p) => p.id === id) ?? refuse("not-found", "That playlist no longer exists.");
  }
  function manual(id: string): Extract<PlaylistInfo, { kind: "manual" }> {
    const pl = playlist(id);
    if (pl.kind !== "manual") return refuse("wrong-kind", `"${pl.name}" is a dynamic playlist: it picks up tracks by their tags, so tag the tracks instead.`);
    return pl;
  }
  function board(id: string): PadBoard {
    return state.boards.find((b) => b.id === id) ?? refuse("not-found", "That pad board no longer exists.");
  }
  function campaign(id: string): CampaignInfo {
    return state.campaigns.find((c) => c.id === id) ?? refuse("not-found", "That campaign no longer exists.");
  }
  function session(campaignId: string, sessionId: string): SessionInfo {
    return campaign(campaignId).sessions.find((s) => s.id === sessionId) ?? refuse("not-found", "That session no longer exists.");
  }
  function scene(a: SceneAddress): { session: SessionInfo; scene: SceneInfo; index: number } {
    const s = session(a.campaignId, a.sessionId);
    const index = s.scenes.findIndex((x) => x.id === a.sceneId);
    if (index < 0) refuse("not-found", "That scene no longer exists.");
    return { session: s, scene: s.scenes[index], index };
  }
  function group(id: string): TagGroup {
    return state.tagGroups.find((g) => g.id === id) ?? refuse("invalid", "There is no such tag group.", "group");
  }
  function padAt(b: PadBoard, padId: string): { where: "slot" | "spare"; index: number; pad: Pad } {
    const slot = b.slots.findIndex((p) => p?.id === padId);
    if (slot > -1) return { where: "slot", index: slot, pad: b.slots[slot] };
    const spare = b.spare.findIndex((p) => p.id === padId);
    if (spare > -1) return { where: "spare", index: spare, pad: b.spare[spare] };
    return refuse("not-found", "That pad no longer exists.");
  }
  function requireName(name: unknown, what: string): string {
    const n = trimmed(name);
    if (!n) refuse("invalid", `Give the ${what} a name.`, "name");
    return n;
  }
  /** PLY-13: a play order's place, checked: its key (keyOfPlace) and words for the undo label. */
  function playPlace(place: PlayPlace): { key: string; words: string } {
    if (!place || !["scene", "session", "campaign"].includes(place.kind)) refuse("invalid", "A play order applies in a scene, a session or a campaign.", "place");
    if (place.kind === "scene") return { key: keyOfPlace(place), words: `the scene ${quoted(scene(place).scene.name)}` };
    if (place.kind === "session") return { key: keyOfPlace(place), words: `session ${session(place.campaignId, place.sessionId).number}` };
    return { key: keyOfPlace(place), words: quoted(campaign(place.campaignId).name) };
  }
  function checkOrder(order: PlayOrder): PlayOrder {
    if (!order || typeof order.shuffle !== "boolean" || !(REPEATS as readonly string[]).includes(order.repeat)) refuse("invalid", "Choose shuffle or in order, and no repeat, repeat all or repeat one.", "order");
    return { shuffle: order.shuffle, repeat: order.repeat };
  }
  function placeExists(place: ProfilePlace) {
    if (place.kind === "playlist") playlist(place.playlistId);
    else if (place.kind === "session") session(place.campaignId, place.sessionId);
    else scene(place);
  }
  /** Leaves a new track New until it has a title of its own and a tag (the prototype's settle()). */
  function settle(t: LibraryTrack) {
    if (t.isNew && t.title && Object.values(t.tags).some((v) => v.length > 0)) t.isNew = false;
  }

  /**
   * A copy of the track as the library hands it out. DAT-10: its tags in vocabulary order, the groups' and tags' order
   * on the Tags screen, so a tag sits in the same place on every row (the library reads them in that order too).
   */
  function asListed(t: LibraryTrack): LibraryTrack {
    const out = copy(t);
    const tags: Record<string, string[]> = {};
    for (const g of state.tagGroups) tags[g.id] = inVocabularyOrder(g, out.tags[g.id] ?? []);
    out.tags = tags;
    return out;
  }

  /* ---------- checks ---------- */

  function checkRule(rule: PlaylistRule) {
    if (!rule || !Array.isArray(rule.conds)) refuse("invalid", "That rule cannot be kept.", "rule");
    for (const c of rule.conds) {
      const g = group(c.group);
      if (!["any", "all", "none"].includes(c.match)) refuse("invalid", "A condition matches any, all or none of its tags.", "rule");
      for (const v of c.values) if (!g.values.includes(v)) refuse("invalid", `${v} is not a ${g.name.toLowerCase()} tag.`, "rule");
    }
    if (rule.shapes !== undefined) {
      if (!Array.isArray(rule.shapes) || rule.shapes.some((x) => !(TRACK_SHAPES as readonly string[]).includes(x))) refuse("invalid", "Choose from Steady, Builds, Falls away, Peaks then falls and Rises and falls.", "rule");
      rule.shapes = TRACK_SHAPES.filter((x) => rule.shapes.includes(x));
      if (rule.shapes.length === 0) delete rule.shapes;
    }
    if (rule.energy !== undefined) {
      const [lo, hi] = rule.energy ?? [];
      if (!isInt(lo, 0, 5) || !isInt(hi, 0, 5) || lo > hi) refuse("invalid", "Energy goes from 0 to 5, lowest first.", "energy");
    }
  }
  function checkProfile(p: AudioProfileInput, durationMs: number) {
    const time = (v: unknown, field: string) => {
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) refuse("invalid", "Times are zero or more.", field);
    };
    time(p.startMs, "startMs");
    time(p.endMs, "endMs");
    time(p.loopStartMs, "loopStartMs");
    time(p.loopCrossfadeMs, "loopCrossfadeMs");
    const start = p.startMs ?? 0;
    const end = p.endMs ?? (durationMs > 0 ? durationMs : undefined);
    if (end !== undefined && start >= end) refuse("invalid", "End must come after Start.", "endMs");
    if (p.loopStartMs !== undefined && (p.loopStartMs < start || (end !== undefined && p.loopStartMs >= end))) refuse("invalid", "The loop starts between Start and End.", "loopStartMs");
    if (p.after !== undefined && !["loop", "next", "stop"].includes(p.after)) refuse("invalid", "At the end a track loops, moves on or stops.", "after");
    for (const [field, f] of [["fadeIn", p.fadeIn], ["fadeOut", p.fadeOut]] as const) {
      if (f === undefined) continue;
      if (!f || typeof f.ms !== "number" || f.ms < 0) refuse("invalid", "A fade lasts zero seconds or more.", field);
      if (typeof f.shape !== "number" || f.shape < 0 || f.shape > 100) refuse("invalid", "Fade intensity goes from 0 (gentle) to 100 (sharp).", field);
    }
    for (const m of p.markers ?? []) if (typeof m.atMs !== "number" || m.atMs < 0 || typeof m.label !== "string") refuse("invalid", "A marker needs a time and a label.", "markers");
    // DAT-3: one mix-out marker; the others carry no `mix`.
    for (const m of p.markers ?? []) if (m.mix !== undefined && typeof m.mix !== "boolean") refuse("invalid", "A marker is the mix-out point or not.", "markers");
    if ((p.markers ?? []).filter((m) => m.mix).length > 1) refuse("invalid", "A track has one mix-out marker: choose one.", "markers");
    for (const m of p.markers ?? []) if (m.mix === false) delete m.mix;
  }
  function checkPad(p: Pad) {
    if (!trimmed(p.label)) refuse("invalid", "Give the pad a label.", "label");
    if (!trimmed(p.icon)) refuse("invalid", "Choose an icon for the pad.", "icon");
    if (!(PAD_COLORS as readonly string[]).includes(p.color)) refuse("invalid", "Choose one of the pad colours.", "color");
    if (p.key !== "" && !KEY.test(p.key)) refuse("invalid", "That key cannot be used. Try a letter, a number or F1 to F12.", "key");
    if (!(PAD_MODES as readonly string[]).includes(p.mode)) refuse("invalid", "Choose how the pad plays.", "mode");
    if (typeof p.volume !== "number" || p.volume < 0 || p.volume > 1) refuse("invalid", "Volume goes from 0 to 100.", "volume");
    if (typeof p.fadeOutMs !== "number" || p.fadeOutMs < 0) refuse("invalid", "The fade lasts zero seconds or more.", "fadeOutMs");
    const s = p.sound;
    if (!["single", "variants", "tag"].includes(s.kind) || !["random", "in_turn"].includes(s.order)) refuse("invalid", "That sound cannot be kept.", "sound");
    s.trackIds.forEach(track);
    if (s.tag) {
      const g = group(s.tag.group);
      if (!g.values.includes(s.tag.value)) refuse("invalid", `${s.tag.value} is not a ${g.name.toLowerCase()} tag.`, "sound");
    }
  }
  function checkMusic(ref: SoundRef) {
    if (ref.kind === "track") {
      if (track(ref.id).kind === "amb") refuse("wrong-kind", "Ambience goes in the scene's Ambience, not its music.");
    } else if (playlist(ref.id).lane === "amb") refuse("wrong-kind", "An ambience playlist goes in the scene's Ambience, not its music.");
  }
  function checkAmbience(ref: SoundRef) {
    if (ref.kind === "track" ? track(ref.id).kind !== "amb" : playlist(ref.id).lane !== "amb") refuse("wrong-kind", "A scene's ambience is an ambience track or an ambience playlist.");
  }

  /* ---------- shared changes ---------- */

  function takeOutOfCampaigns(kind: "playlist" | "board", id: string) {
    if (kind === "playlist")
      for (const orders of [state.playOrders, state.trackOrders] as Record<string, Record<string, unknown>>[])
        for (const key of Object.keys(orders)) {
          delete orders[key][id];
          if (Object.keys(orders[key]).length === 0) delete orders[key];
        }
    for (const c of state.campaigns) {
      const key = kind === "playlist" ? "playlistIds" : "boardIds";
      c[key] = c[key].filter((x) => x !== id);
      for (const s of c.sessions) {
        s[key] = s[key].filter((x) => x !== id);
        for (const sc of s.scenes) {
          if (kind === "board") sc.boardIds = sc.boardIds.filter((x) => x !== id);
          else {
            sc.music = sc.music.filter((r) => !(r.kind === "playlist" && r.id === id));
            if (sc.ambience?.kind === "playlist" && sc.ambience.id === id) sc.ambience = null;
          }
        }
      }
    }
  }
  function blankScene(name: string): SceneInfo {
    return { id: newId("scene"), name, startsWhen: "", notes: "", noteLink: "", music: [], ambience: null, boardIds: [], trackNames: {}, repeatOnes: [], steps: null, movesOn: { when: "stay" } };
  }
  function blankPad(): Pad {
    return { id: newId("pad"), label: "New pad", icon: "star", color: "gold", key: "", mode: "oneshot", sound: { kind: "single", trackIds: [], order: "random", tag: null }, volume: 0.8, fadeOutMs: 1500, aside: false, steps: null };
  }
  function history(): HistoryState {
    return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: last(undoStack)?.label ?? null, redoLabel: last(redoStack)?.label ?? null };
  }

  /* ---------- importing (simulated files) ---------- */

  function filesUnder(folder: string): string[] {
    const lower = folder.toLowerCase();
    return Object.entries(folderFiles)
      .filter(([f]) => f.toLowerCase() === lower || f.toLowerCase().startsWith(lower + "\\"))
      .flatMap(([f, names]) => names.map((n) => `${f}\\${n}`));
  }
  const isFolder = (p: string) => filesUnder(p).length > 0;
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  function progress(p: ImportProgress) {
    emit({ type: "import-progress", progress: p });
  }
  function newTrack(path: string): LibraryTrack {
    const { folder, name } = splitPath(path);
    const kind = guessKind(folder);
    return {
      id: newId("track"),
      kind,
      title: "",
      metaTitle: name.replace(/\.[a-z0-9]+$/i, "").replace(/^[\d-]+\s*[-.]?\s*/, ""),
      fileName: name,
      durationMs: 0,
      role: kind === "fx" ? "effect" : null,
      loop: null,
      energy: null,
      tags: Object.fromEntries(state.tagGroups.map((g): [string, string[]] => [g.id, []])),
      profile: null,
      shape: null,
      suggestedShape: null,
      normalise: null,
      loudness: null,
      artist: "",
      album: "",
      folder,
      notes: "",
      addedAt: now(),
      isNew: true,
      url: fileAddress(path),
      sizeBytes: null,
      fadesOut: false,
      resume: false,
      follow: null,
    };
  }
  async function importPaths(paths: string[]): Promise<ImportSummary> {
    progress({ phase: "finding", done: 0, total: 0, message: "Looking for audio files…" });
    const files: string[] = [];
    const problems: ImportSummary["problems"] = [];
    for (const p of paths) {
      if (AUDIO.test(p)) files.push(p);
      else if (isFolder(p)) files.push(...filesUnder(p).filter((f) => AUDIO.test(f)));
      else problems.push({ file: p, reason: /\.[a-z0-9]+$/i.test(p) ? "Lyre plays audio files (FLAC, MP3, WAV, OGG and the like); this is not one." : "Lyre could not find this file or folder." });
    }
    const known = new Map(state.tracks.map((t) => [pathOf(t).toLowerCase(), t.id]));
    const added: LibraryTrack[] = [];
    const already: string[] = [];
    const trackIds: string[] = [];
    for (const [i, file] of files.entries()) {
      await tick();
      progress({ phase: "reading", done: i, total: files.length, message: `Reading ${splitPath(file).name}` });
      const existing = known.get(file.toLowerCase());
      if (existing) {
        if (!already.includes(existing)) already.push(existing);
        trackIds.push(existing);
        continue;
      }
      const t = newTrack(file);
      known.set(file.toLowerCase(), t.id);
      added.push(t);
      trackIds.push(t.id);
    }
    if (added.length) {
      writeWithoutHistory(["tracks"], true, () => state.tracks.push(...added));
      progress({ phase: "saving", done: files.length, total: files.length, message: `Saved ${plural(added.length, "track")}` });
    }
    const parts = [added.length ? `${plural(added.length, "track")} added.` : "Nothing new was added."];
    if (already.length) parts.push(`${plural(already.length, "file was", "files were")} already in your library.`);
    if (problems.length) parts.push(`${plural(problems.length, "file")} could not be added.`);
    const summary = parts.join(" ");
    progress({ phase: "done", done: files.length, total: files.length, message: summary });
    workOutPeaks(added.map((t) => t.id));
    return { added: added.map((t) => t.id), alreadyInLibrary: already, trackIds, problems, cancelled: false, summary };
  }
  function chooseFolder(): string | null {
    return options.choose?.folder?.() ?? null;
  }

  /* ---------- the API ---------- */

  /** Round 6's find (tracks and playlists); round 7's (fakeRound7.ts) adds pads and scenes. */
  async function round6Find({ text, lane, limit = 50, in: where }: FindRequest): Promise<FindResult> {
    const tracks = await api.library.search({ text, lane, limit });
    const want = words(text ?? "");
    const c = where ? state.campaigns.find((x) => x.id === where.campaignId) : undefined;
    const s = c && where?.sessionId ? c.sessions.find((x) => x.id === where.sessionId) : undefined;
    const scored: { p: PlaylistInfo; score: number }[] = [];
    for (const p of state.playlists) {
      if (lane && p.lane !== lane) continue;
      const name = words(p.name);
      const notes = words(p.notes);
      let score = 0;
      for (const w of want) {
        const best = name.some((x) => x.startsWith(w)) ? 10 : notes.some((x) => x.startsWith(w)) ? 1 : 0;
        if (!best) {
          score = -1;
          break;
        }
        score += best;
      }
      if (score >= 0) scored.push({ p, score });
    }
    scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
    const playlists = scored.slice(0, Math.max(0, limit)).map(({ p }) => {
      const place: PlayPlace | null = s?.playlistIds.includes(p.id) ? { kind: "session", campaignId: c!.id, sessionId: s.id } : c?.playlistIds.includes(p.id) ? { kind: "campaign", campaignId: c.id } : null;
      const own = playlistTracks(p, lookup());
      const ordered = tracksInPlaceOrder(own, place ? state.trackOrders[keyOfPlace(place)]?.[p.id] : undefined);
      return { id: p.id, name: p.name, lane: p.lane, kind: p.kind, trackIds: ordered.map((t) => t.id), place };
    });
    return { tracks, playlists, pads: [], scenes: [] };
  }

  // Round 7 (fakeRound7.ts): its methods join the areas below.
  const r7 = fakeRound7(
    {
      state: () => state,
      write,
      refuse,
      track,
      playlist,
      board,
      scene,
      padAt,
      newId,
      copy,
      words,
      checkMusic,
      searchTracks: (request) => api.library.search(request),
      findPlaylists: async (request) => (await round6Find(request)).playlists,
      undoLabel: () => history().undoLabel,
      changedOutsideHistory: (areas) => emit({ type: "changed", areas }),
    },
    computer,
  );

  const api: FakeLyreApi = {
    library: {
      async listTracks() {
        return state.tracks.map(asListed);
      },
      async search({ text, lane, limit = 50, shapes }) {
        const want = words(text ?? "");
        const shaped = shapes && shapes.length ? (t: LibraryTrack) => shapes.includes(shapeOf(t).shape) : () => true;
        const WEIGHT: [keyof LibraryTrack | "tagWords", number][] = [["title", 10], ["metaTitle", 6], ["tagWords", 6], ["fileName", 4], ["artist", 3], ["album", 3], ["notes", 1]];
        const scored: { t: LibraryTrack; score: number }[] = [];
        for (const t of state.tracks) {
          if (lane && (lane === "fx" ? !isFx(t) : t.kind !== lane)) continue;
          if (!shaped(t)) continue;
          const fields = WEIGHT.map(([f, w]) => [f === "tagWords" ? words(Object.values(t.tags).flat().join(" ")) : words(String(t[f] ?? "")), w] as const);
          let score = 0;
          let all = true;
          for (const w of want) {
            const best = Math.max(0, ...fields.filter(([ws]) => ws.some((x) => x.startsWith(w))).map(([, weight]) => weight));
            if (!best) {
              all = false;
              break;
            }
            score += best;
          }
          if (all) scored.push({ t, score });
        }
        scored.sort((a, b) => b.score - a.score || shownTitle(a.t).localeCompare(shownTitle(b.t)));
        return { trackIds: scored.slice(0, Math.max(0, limit)).map((x) => x.t.id), total: scored.length };
      },
      async find(request) {
        return r7.library.find(request);
      },
      async put(request) {
        return r7.library.put(request);
      },
      async updateTrack(id, patch) {
        let name = "";
        return write(() => `Change ${quoted(name)}`, ["tracks"], () => {
          const t = track(id);
          if (patch.title !== undefined && typeof patch.title !== "string") refuse("invalid", "A title is text.", "title");
          if (patch.energy !== undefined && patch.energy !== null && !isInt(patch.energy, 1, 5)) refuse("invalid", "Energy goes from 1 (calm) to 5 (intense).", "energy");
          if (patch.role !== undefined && patch.role !== null && !(TRACK_ROLES as readonly string[]).includes(patch.role)) refuse("invalid", "Choose one of the roles.", "role");
          if (patch.loop !== undefined && patch.loop !== null && !["yes", "crossfade", "no"].includes(patch.loop)) refuse("invalid", "Choose whether it loops.", "loop");
          if (patch.kind !== undefined && !(TRACK_KINDS as readonly string[]).includes(patch.kind)) refuse("invalid", "A track is music, ambience or a sound effect.", "kind");
          if (patch.fadesOut !== undefined && typeof patch.fadesOut !== "boolean") refuse("invalid", "Fades out is on or off.", "fadesOut");
          if (patch.resume !== undefined && typeof patch.resume !== "boolean") refuse("invalid", "Pick up where it stopped is on or off.", "resume");
          if (patch.follow !== undefined && patch.follow !== null) {
            if (patch.follow.kind === "track") {
              track(patch.follow.id);
              if (patch.follow.id === t.id) refuse("invalid", "A track cannot follow with itself.", "follow");
            } else if (patch.follow.kind === "playlist") playlist(patch.follow.id);
            else refuse("invalid", "Follow with a track or a playlist.", "follow");
          }
          name = shownTitle(t);
          for (const key of ["title", "notes", "energy", "role", "loop", "kind", "fadesOut", "resume", "follow"] as const) if (patch[key] !== undefined) (t as unknown as Record<string, unknown>)[key] = copy(patch[key]);
          settle(t);
          return asListed(t);
        });
      },
      async listFolders() {
        return copy(state.folders);
      },
      async peaksOf(trackId) {
        const ready = peaks.get(trackId);
        workOutPeaks([trackId]);
        return ready ? [...ready] : null;
      },
      async setShape(trackId, shape) {
        let name = "";
        return write(() => (shape ? `Give ${quoted(name)} the shape ${SHAPE_WORDS[shape] ?? shape}` : `Let Lyre suggest the shape of ${quoted(name)}`), ["tracks"], () => {
          const t = track(trackId);
          if (shape !== null && !(TRACK_SHAPES as readonly string[]).includes(shape)) refuse("invalid", "Choose from Steady, Builds, Falls away, Peaks then falls and Rises and falls.", "shape");
          name = shownTitle(t);
          t.shape = shape;
          return asListed(t);
        });
      },
      async normaliseSettings() {
        return copy(state.normalise);
      },
      async setNormaliseSettings(setting) {
        return write("Normalise volume", ["tracks"], () => {
          if (typeof setting?.on !== "boolean") refuse("invalid", "Choose whether to normalise the library.", "on");
          if (!(NORMALISE_TARGETS as readonly string[]).includes(setting.target)) refuse("invalid", "Choose Quiet, Standard or Loud.", "target");
          state.normalise = { on: setting.on, target: setting.target };
          return state.normalise;
        });
      },
      async setNormalise(trackId, choice) {
        let name = "";
        return write(() => `Normalise volume of ${quoted(name)}`, ["tracks"], () => {
          const t = track(trackId);
          checkNormalise(choice);
          name = shownTitle(t);
          t.normalise = choice;
          return asListed(t);
        });
      },
      async showInFolder(trackId) {
        try {
          track(trackId);
          if (state.missing.includes(trackId)) refuse("file-missing", "The file is not where your library expects it. Use Find missing files to look for it.");
        } catch (e) {
          return refused(e);
        }
        return { ok: true, value: undefined, changed: [], undoLabel: history().undoLabel };
      },
    },

    tags: {
      ...r7.tags,
      async listGroups() {
        return copy(state.tagGroups);
      },
      async tagTracks({ trackIds, add = [], remove = [] }) {
        return write(
          () => {
            const one = trackIds.length === 1 ? quoted(shownTitle(state.tracks.find((t) => t.id === trackIds[0]))) : plural(trackIds.length, "track");
            return add.length ? `Tag ${one}` : `Remove tags from ${one}`;
          },
          ["tracks", "tags"],
          () => {
            const tracks = trackIds.map(track);
            const created: TagRef[] = [];
            const resolve = (ref: TagRef, create: boolean): TagRef => {
              const g = group(ref.group);
              const value = tagValue(ref.value ?? "");
              if (!value) refuse("invalid", `Type a ${g.name.toLowerCase()} first.`, "value");
              const known = g.values.find((v) => v.toLowerCase() === value.toLowerCase());
              if (known) return { group: g.id, value: known };
              if (create) {
                g.values.push(value);
                g.tags.push({ name: value, parent: null, also: [], color: null });
                created.push({ group: g.id, value });
              }
              return { group: g.id, value };
            };
            for (const ref of add.map((r) => resolve(r, true)))
              for (const t of tracks) {
                const have = (t.tags[ref.group] ??= []);
                if (!have.includes(ref.value)) have.push(ref.value);
              }
            for (const ref of remove.map((r) => resolve(r, false))) for (const t of tracks) t.tags[ref.group] = (t.tags[ref.group] ?? []).filter((v) => v !== ref.value);
            tracks.forEach(settle);
            return { created };
          },
        );
      },
    },

    playlists: {
      ...r7.playlists,
      async list() {
        return copy(state.playlists);
      },
      async tracks(id) {
        const pl = state.playlists.find((p) => p.id === id);
        return pl ? playlistTracks(pl, lookup()).map((t) => t.id) : [];
      },
      async containing(trackId) {
        const lk = lookup();
        return state.playlists.filter((p) => playlistTracks(p, lk).some((t) => t.id === trackId)).map((p) => p.id);
      },
      async create(input) {
        return write(`New playlist ${quoted(trimmed(input.name))}`, ["playlists"], () => {
          const name = requireName(input.name, "playlist");
          if (!(TRACK_KINDS as readonly string[]).includes(input.lane)) refuse("invalid", "A playlist plays music, ambience or FX.", "lane");
          let pl: PlaylistInfo;
          if (input.kind === "manual") {
            const ids = [...new Set(input.trackIds ?? [])];
            ids.forEach(track);
            pl = { id: newId("playlist"), name, lane: input.lane, order: null, normalise: null, kind: "manual", trackIds: ids, notes: input.notes ?? "", folderId: null, dividers: [] };
          } else if (input.kind === "dynamic") {
            const rule = copy(input.rule ?? { conds: [] });
            checkRule(rule);
            pl = { id: newId("playlist"), name, lane: input.lane, order: null, normalise: null, kind: "dynamic", rule, notes: input.notes ?? "", folderId: null, dividers: [] };
          } else refuse("invalid", "A playlist is manual or dynamic.", "kind");
          state.playlists.unshift(pl);
          return pl;
        });
      },
      async update(id, patch) {
        return write((pl: PlaylistInfo) => `Change playlist ${quoted(pl.name)}`, ["playlists"], () => {
          const pl = playlist(id);
          if (patch.name !== undefined) pl.name = requireName(patch.name, "playlist");
          if (patch.notes !== undefined) pl.notes = String(patch.notes);
          if (patch.rule !== undefined) {
            if (pl.kind !== "dynamic") refuse("wrong-kind", `"${pl.name}" is a manual playlist: it has no rules.`);
            const rule = copy(patch.rule);
            checkRule(rule);
            pl.rule = rule;
          }
          return pl;
        });
      },
      async copyAsManual(id) {
        return write((pl: PlaylistInfo) => `Make ${quoted(pl.name)}`, ["playlists"], () => {
          const pl = playlist(id);
          const made: PlaylistInfo = { id: newId("playlist"), name: `${pl.name} (manual)`, lane: pl.lane, order: null, normalise: pl.normalise, kind: "manual", trackIds: playlistTracks(pl, lookup()).map((t) => t.id), notes: pl.notes, folderId: pl.folderId, dividers: [] };
          state.playlists.splice(state.playlists.indexOf(pl) + 1, 0, made);
          return made;
        });
      },
      async delete(id) {
        let name = "";
        return write(() => `Delete playlist ${quoted(name)}`, ["playlists", "campaigns", "profiles", "tracks", "boards"], () => {
          const pl = playlist(id);
          name = pl.name;
          state.playlists.splice(state.playlists.indexOf(pl), 1);
          takeOutOfCampaigns("playlist", id);
          dropReferences(state, { playlistId: id });
          delete state.overrides[placeKey({ kind: "playlist", playlistId: id })];
        });
      },
      async addTracks(id, trackIds, at) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = manual(id);
          trackIds.forEach(track);
          const added = [...new Set(trackIds)].filter((t) => !pl.trackIds.includes(t));
          const alreadyIn = [...new Set(trackIds)].filter((t) => pl.trackIds.includes(t));
          // ORG-4: the new tracks go before the track now at that place, below a divider above it.
          const items = itemsOf(pl);
          const before = pl.trackIds[clampIndex(at ?? pl.trackIds.length, pl.trackIds.length)];
          const i = before === undefined ? items.length : items.findIndex((x) => "trackId" in x && x.trackId === before);
          items.splice(i, 0, ...added.map((trackId) => ({ trackId })));
          setItems(pl, items);
          label = `Add ${added.length === 1 ? quoted(shownTitle(track(added[0]))) : plural(added.length, "track")} to ${quoted(pl.name)}`;
          return { added, alreadyIn };
        });
      },
      async removeTrack(id, trackId) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = manual(id);
          if (!pl.trackIds.includes(trackId)) refuse("not-found", "That track is not in this playlist.");
          setItems(pl, itemsOf(pl).filter((x) => !("trackId" in x && x.trackId === trackId)));
          label = `Remove ${quoted(shownTitle(track(trackId)))} from ${quoted(pl.name)}`;
        });
      },
      async moveTrack(id, trackId, toIndex) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = manual(id);
          if (!pl.trackIds.includes(trackId)) refuse("not-found", "That track is not in this playlist.");
          // Among the tracks, as before; dividers keep their place above the tracks they were above.
          const items = itemsOf(pl).filter((x) => !("trackId" in x && x.trackId === trackId));
          const rest = pl.trackIds.filter((x) => x !== trackId);
          const before = rest[clampIndex(toIndex, rest.length)];
          const i = before === undefined ? items.length : items.findIndex((x) => "trackId" in x && x.trackId === before);
          items.splice(i, 0, { trackId });
          setItems(pl, items);
          label = `Move ${quoted(shownTitle(track(trackId)))} in ${quoted(pl.name)}`;
        });
      },
      async playOrders() {
        return copy(state.playOrders);
      },
      async setNormalise(playlistId, choice) {
        let name = "";
        return write(() => `Normalise volume of ${quoted(name)}`, ["playlists"], () => {
          const pl = playlist(playlistId);
          checkNormalise(choice);
          name = pl.name;
          pl.normalise = choice;
          return pl;
        });
      },
      async setPlayOrder(playlistId, place, order) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = playlist(playlistId);
          const where = place ? playPlace(place) : null;
          const clean = checkOrder(order);
          if (where) (state.playOrders[where.key] ??= {})[pl.id] = clean;
          else pl.order = clean;
          label = `Change the play order of ${quoted(pl.name)}${where ? ` in ${where.words}` : ""}`;
          return clean;
        });
      },
      async clearPlayOrder(playlistId, place) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = playlist(playlistId);
          const where = place ? playPlace(place) : null;
          if (where) {
            if (state.playOrders[where.key]) {
              delete state.playOrders[where.key][pl.id];
              if (Object.keys(state.playOrders[where.key]).length === 0) delete state.playOrders[where.key];
            }
          } else pl.order = null;
          label = where ? `Use the playlist's own order in ${where.words}` : `Play ${quoted(pl.name)} in the default order`;
        });
      },
      async trackOrders() {
        return copy(state.trackOrders);
      },
      async setTrackOrder(playlistId, place, trackIds) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = playlist(playlistId);
          if (!place) refuse("invalid", "A playlist's own order is its list: choose a scene, a session or a campaign.", "place");
          const where = playPlace(place);
          if (!Array.isArray(trackIds) || trackIds.some((id) => typeof id !== "string")) refuse("invalid", "The order is a list of tracks.", "trackIds");
          const keep = placeOrderToKeep(playlistTracks(pl, lookup()).map((t) => t.id), trackIds);
          if (keep) (state.trackOrders[where.key] ??= {})[pl.id] = keep;
          else if (state.trackOrders[where.key]) {
            delete state.trackOrders[where.key][pl.id];
            if (Object.keys(state.trackOrders[where.key]).length === 0) delete state.trackOrders[where.key];
          }
          label = keep ? `Order ${quoted(pl.name)} in ${where.words}` : `Back to the order of ${quoted(pl.name)} in ${where.words}`;
          return keep;
        });
      },
      async clearTrackOrder(playlistId, place) {
        let label = "";
        return write(() => label, ["playlists"], () => {
          const pl = playlist(playlistId);
          if (!place) refuse("invalid", "A playlist's own order is its list: choose a scene, a session or a campaign.", "place");
          const where = playPlace(place);
          if (state.trackOrders[where.key]) {
            delete state.trackOrders[where.key][pl.id];
            if (Object.keys(state.trackOrders[where.key]).length === 0) delete state.trackOrders[where.key];
          }
          label = `Back to the order of ${quoted(pl.name)} in ${where.words}`;
        });
      },
    },

    boards: {
      ...r7.boards,
      async list() {
        return copy(state.boards);
      },
      async create({ name, cols, rows }) {
        const shown = trimmed(name) || "Untitled board";
        return write(`New pad board ${quoted(shown)}`, ["boards"], () => {
          if (!isInt(cols, 1, 8) || !isInt(rows, 1, 8)) refuse("invalid", "A board has 1 to 8 columns and 1 to 8 rows.", "cols");
          const b: PadBoard = { id: newId("board"), name: shown, cols, rows, slots: Array.from({ length: cols * rows }, (): Pad | null => null), spare: [], dividers: [], folderId: null };
          state.boards.push(b);
          return b;
        });
      },
      async rename(id, name) {
        return write((b: PadBoard) => `Rename the pad board to ${quoted(b.name)}`, ["boards"], () => {
          const b = board(id);
          b.name = requireName(name, "pad board");
          return b;
        });
      },
      async resize(id, cols, rows) {
        let label = "";
        return write(() => label, ["boards"], () => {
          const b = board(id);
          if (!isInt(cols, 1, 8) || !isInt(rows, 1, 8)) refuse("invalid", "A board has 1 to 8 columns and 1 to 8 rows.", "cols");
          label = `Resize ${quoted(b.name)} to ${cols} × ${rows}`;
          if (cols === b.cols && rows === b.rows) return { board: b, movedToSpare: [], cameBack: [] };
          // SFX-11: pads pack left to right, top to bottom; a pad put aside by hand stays aside.
          const next = reflowBoard(b.slots, b.spare, cols, rows, (p) => p.aside);
          const cameBack = b.spare.filter((p) => next.slots.includes(p));
          for (const p of next.slots) if (p) p.aside = false;
          Object.assign(b, { cols, rows, slots: next.slots, spare: next.spare });
          return { board: b, movedToSpare: next.spilled.map((p) => p.id), cameBack: cameBack.map((p) => p.id) };
        });
      },
      async duplicate(id) {
        return write((b: PadBoard) => `Make ${quoted(b.name)}`, ["boards"], () => {
          const b = board(id);
          const renew = (p: Pad): Pad => ({ ...copy(p), id: newId("pad") });
          const made: PadBoard = { ...copy(b), id: newId("board"), name: `${b.name} (copy)`, slots: b.slots.map((p) => (p ? renew(p) : null)), spare: b.spare.map(renew), folderId: b.folderId };
          state.boards.splice(state.boards.indexOf(b) + 1, 0, made);
          return made;
        });
      },
      async delete(id) {
        let name = "";
        return write(() => `Delete pad board ${quoted(name)}`, ["boards", "campaigns"], () => {
          const b = board(id);
          name = b.name;
          state.boards.splice(state.boards.indexOf(b), 1);
          takeOutOfCampaigns("board", id);
          dropReferences(state, { boardId: id, padIds: [...b.slots, ...b.spare].flatMap((p) => (p ? [p.id] : [])) });
        });
      },
      async addPad(boardId, slot) {
        let name = "";
        return write(() => `Add a pad to ${quoted(name)}`, ["boards"], () => {
          const b = board(boardId);
          name = b.name;
          if (!isInt(slot, 0, b.slots.length - 1)) refuse("invalid", "That place is not on the grid.", "slot");
          if (b.slots[slot]) refuse("invalid", "That place already has a pad.", "slot");
          const pad = blankPad();
          b.slots[slot] = pad;
          return pad;
        });
      },
      async updatePad(boardId, padId, patch: PadPatch) {
        return write((p: Pad) => `Change the pad ${quoted(p.label)}`, ["boards"], () => {
          const { pad } = padAt(board(boardId), padId);
          const { sound, ...rest } = copy(patch);
          Object.assign(pad, rest);
          if (sound) pad.sound = { ...pad.sound, ...sound };
          if (typeof pad.key === "string" && pad.key.length === 1) pad.key = pad.key.toLowerCase();
          pad.label = trimmed(pad.label);
          checkPad(pad);
          return pad;
        });
      },
      async duplicatePad(boardId, padId) {
        return write((r: { pad: Pad; place: PadPlace }) => `Make ${quoted(r.pad.label)}`, ["boards"], () => {
          const b = board(boardId);
          const at = padAt(b, padId);
          const made: Pad = { ...copy(at.pad), id: newId("pad"), label: `${at.pad.label} (copy)`, key: "", aside: false };
          const start = at.where === "slot" ? at.index + 1 : 0;
          let place: PadPlace = "spare";
          for (let k = 0; k < b.slots.length; k++) {
            const i = (start + k) % b.slots.length;
            if (!b.slots[i]) {
              place = { slot: i };
              break;
            }
          }
          if (place === "spare") b.spare.push(made);
          else b.slots[place.slot] = made;
          return { pad: made, place };
        });
      },
      async movePad(boardId, padId, to) {
        let label = "";
        return write(() => label, ["boards"], () => {
          const b = board(boardId);
          const at = padAt(b, padId);
          label = `Move the pad ${quoted(at.pad.label)}`;
          if (to === "spare") {
            if (at.where === "slot") {
              b.slots[at.index] = null;
              at.pad.aside = true;
              b.spare.push(at.pad);
            }
            return { swappedWith: null };
          }
          if (!to || !isInt(to.slot, 0, b.slots.length - 1)) refuse("invalid", "That place is not on the grid.", "slot");
          const other = b.slots[to.slot];
          if (at.where === "slot") {
            if (at.index === to.slot) return { swappedWith: null };
            b.slots[to.slot] = at.pad;
            b.slots[at.index] = other;
          } else {
            b.spare.splice(at.index, 1);
            b.slots[to.slot] = at.pad;
            at.pad.aside = false;
            // The pad it replaced goes to Spare pads by hand (SFX-11).
            if (other) b.spare.splice(at.index, 0, Object.assign(other, { aside: true }));
          }
          return { swappedWith: other?.id ?? null };
        });
      },
      async putAllBack(boardId) {
        let name = "";
        return write(() => `Put spare pads back on ${quoted(name)}`, ["boards"], () => {
          const b = board(boardId);
          name = b.name;
          const putBack: string[] = [];
          while (b.spare.length && b.slots.includes(null)) {
            const pad = b.spare.shift();
            pad.aside = false;
            b.slots[b.slots.indexOf(null)] = pad;
            putBack.push(pad.id);
          }
          return { putBack };
        });
      },
      async deletePad(boardId, padId) {
        let label = "";
        return write(() => label, ["boards"], () => {
          const b = board(boardId);
          const at = padAt(b, padId);
          label = `Delete the pad ${quoted(at.pad.label)}`;
          if (at.where === "slot") b.slots[at.index] = null;
          else b.spare.splice(at.index, 1);
          dropReferences(state, { padIds: [padId] });
        });
      },
    },

    campaigns: {
      async list() {
        return copy(state.campaigns);
      },
      async get(id) {
        return copy(state.campaigns.find((c) => c.id === id) ?? null);
      },
      async create(input) {
        return write((c: CampaignInfo) => `New campaign ${quoted(c.name)}`, ["campaigns"], () => {
          const name = requireName(input.name, "campaign");
          const theme = input.theme ?? "candle";
          if (!(CAMPAIGN_THEMES as readonly string[]).includes(theme)) refuse("invalid", "Choose one of the themes.", "theme");
          const id = newId("campaign");
          const c: CampaignInfo = {
            id,
            name,
            system: trimmed(input.system),
            theme,
            description: trimmed(input.description),
            notes: "",
            obsidian: { vault: "", note: "", sessionsFolder: "", ...copy(input.obsidian ?? {}) },
            playlistIds: [],
            boardIds: [],
            trackIds: [],
            sessions: [{ id: newId("session"), campaignId: id, number: 1, name: "", date: null, status: "draft", noteLink: "", playlistIds: [], boardIds: [], trackIds: [], scenes: [blankScene("Opening scene")] }],
          };
          state.campaigns.push(c);
          return c;
        });
      },
      async move(id, toIndex) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const c = campaign(id);
          state.campaigns.splice(state.campaigns.indexOf(c), 1);
          state.campaigns.splice(clampIndex(toIndex, state.campaigns.length), 0, c);
          label = `Move the campaign ${quoted(c.name)}`;
        });
      },
      async update(id, patch) {
        return write((c: CampaignInfo) => `Change the campaign ${quoted(c.name)}`, ["campaigns"], () => {
          const c = campaign(id);
          if (patch.name !== undefined) c.name = requireName(patch.name, "campaign");
          if (patch.theme !== undefined && !(CAMPAIGN_THEMES as readonly string[]).includes(patch.theme)) refuse("invalid", "Choose one of the themes.", "theme");
          for (const key of ["system", "theme", "description", "notes"] as const) if (patch[key] !== undefined) (c as unknown as Record<string, unknown>)[key] = String(patch[key]);
          if (patch.obsidian !== undefined) c.obsidian = { ...c.obsidian, ...copy(patch.obsidian) };
          return c;
        });
      },
      async setOnHand(owner, kind, ids) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const c = campaign(owner.campaignId);
          const target = owner.sessionId ? session(owner.campaignId, owner.sessionId) : c;
          if (!["playlists", "boards", "tracks"].includes(kind)) refuse("invalid", "A campaign keeps playlists, pad boards and tracks on hand.", "kind");
          ids.forEach(kind === "playlists" ? playlist : kind === "boards" ? board : track);
          target[kind === "playlists" ? "playlistIds" : kind === "boards" ? "boardIds" : "trackIds"] = [...new Set(ids)];
          label = `Change the ${kind === "playlists" ? "playlists" : kind === "boards" ? "pad boards" : "tracks"} on hand in ${owner.sessionId ? `session ${(target as SessionInfo).number}` : quoted(c.name)}`;
        });
      },
      async usesOf(ref) {
        const uses: Use[] = ref.kind === "playlist" ? usesOfPlaylist(ref.id, state.campaigns) : ref.kind === "board" ? usesOfBoard(ref.id, state.campaigns) : usesOfTrack(ref.id, state.campaigns);
        return copy(uses);
      },
      async setUses(ref, places) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const name = ref.kind === "board" ? board(ref.id).name : ref.kind === "track" ? shownTitle(track(ref.id)) : playlist(ref.id).name;
          const isAmb = ref.kind === "track" ? track(ref.id).kind === "amb" : ref.kind === "playlist" && playlist(ref.id).lane === "amb";
          const kind = ref.kind;
          const keyOf = (p: { campaignId: string; sessionId?: string; sceneId?: string }) => [p.campaignId, p.sessionId ?? "", p.sceneId ?? ""].join("|");
          for (const p of places) {
            if (p.sceneId) scene({ campaignId: p.campaignId, sessionId: p.sessionId, sceneId: p.sceneId });
            else if (p.sessionId) session(p.campaignId, p.sessionId);
            else campaign(p.campaignId);
          }
          const ticked = new Set(places.map(keyOf));
          const listKey = ref.kind === "board" ? "boardIds" : ref.kind === "track" ? "trackIds" : "playlistIds";
          const setIn = (list: string[], on: boolean) => (on ? (list.includes(ref.id) ? list : [...list, ref.id]) : list.filter((x) => x !== ref.id));
          for (const c of state.campaigns) {
            c[listKey] = setIn(c[listKey], ticked.has(keyOf({ campaignId: c.id })));
            for (const s of c.sessions) {
              s[listKey] = setIn(s[listKey], ticked.has(keyOf({ campaignId: c.id, sessionId: s.id })));
              for (const sc of s.scenes) {
                const on = ticked.has(keyOf({ campaignId: c.id, sessionId: s.id, sceneId: sc.id }));
                const sound = kind === "track" ? "track" : "playlist";
                const isIt = (r: SoundRef | null) => r?.kind === sound && r.id === ref.id;
                if (kind === "board") sc.boardIds = setIn(sc.boardIds, on);
                else if (isAmb) {
                  if (on) sc.ambience = { kind: sound, id: ref.id };
                  else if (isIt(sc.ambience)) sc.ambience = null;
                } else if (on) {
                  if (!sc.music.some(isIt)) sc.music.push({ kind: sound, id: ref.id });
                } else {
                  sc.music = sc.music.filter((r) => !isIt(r));
                  if (isIt(sc.ambience)) sc.ambience = null;
                }
              }
            }
          }
          label = places.length ? `Use ${quoted(name)} in ${plural(places.length, "place")}` : `Stop using ${quoted(name)}`;
        });
      },
    },

    sessions: {
      ...r7.sessions,
      async create(campaignId) {
        return write((s: SessionInfo) => `New session ${s.number}`, ["campaigns"], () => {
          const c = campaign(campaignId);
          const latest = last(c.sessions);
          const s: SessionInfo = {
            id: newId("session"),
            campaignId,
            number: latest ? latest.number + 1 : 1,
            name: "",
            date: null,
            status: c.sessions.some((x) => x.status === "next") ? "draft" : "next",
            noteLink: "",
            playlistIds: [],
            boardIds: [],
            trackIds: [],
            scenes: [blankScene("Opening scene")],
          };
          c.sessions.push(s);
          return s;
        });
      },
      async update(campaignId, sessionId, patch) {
        return write((s: SessionInfo) => `Change session ${s.number}`, ["campaigns"], () => {
          const c = campaign(campaignId);
          const s = session(campaignId, sessionId);
          if (patch.name !== undefined) s.name = trimmed(patch.name);
          if (patch.noteLink !== undefined) s.noteLink = String(patch.noteLink);
          if (patch.date !== undefined) {
            const date = patch.date || null;
            if (date !== null && (!DATE.test(date) || Number.isNaN(Date.parse(date)))) refuse("invalid", "Choose a date from the calendar.", "date");
            s.date = date;
          }
          if (patch.status !== undefined) {
            if (!(SESSION_STATUSES as readonly string[]).includes(patch.status)) refuse("invalid", "A session is played, next or a draft.", "status");
            // One "next" per campaign: the old one becomes played when it came earlier, a draft when it comes later.
            if (patch.status === "next") {
              const at = c.sessions.indexOf(s);
              c.sessions.forEach((o, i) => {
                if (o !== s && o.status === "next") o.status = i < at ? "played" : "draft";
              });
            }
            s.status = patch.status;
          }
          return s;
        });
      },
      async move(campaignId, sessionId, toIndex) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const c = campaign(campaignId);
          const s = session(campaignId, sessionId);
          c.sessions.splice(c.sessions.indexOf(s), 1);
          c.sessions.splice(clampIndex(toIndex, c.sessions.length), 0, s);
          // Sessions are numbered in their order, starting from the lowest number they had.
          const base = Math.min(...c.sessions.map((x) => x.number));
          c.sessions.forEach((x, i) => (x.number = base + i));
          label = `Move ${s.name ? quoted(s.name) : "a session"} to session ${s.number}`;
        });
      },
      async createScene(campaignId, sessionId, after) {
        return write(`Add a scene`, ["campaigns"], () => {
          const s = session(campaignId, sessionId);
          let at = s.scenes.length;
          if (after !== undefined) {
            const i = s.scenes.findIndex((x) => x.id === after);
            if (i < 0) refuse("not-found", "That scene no longer exists.");
            at = i + 1;
          }
          const made = blankScene("New scene");
          s.scenes.splice(at, 0, made);
          return made;
        });
      },
      async updateScene(address, patch) {
        return write((sc: SceneInfo) => `Change the scene ${quoted(sc.name)}`, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          for (const key of ["name", "startsWhen", "notes", "noteLink"] as const) if (patch[key] !== undefined) sc[key] = String(patch[key]);
          return sc;
        });
      },
      async moveScene(address, toIndex) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { session: s, scene: sc, index } = scene(address);
          s.scenes.splice(index, 1);
          s.scenes.splice(clampIndex(toIndex, s.scenes.length), 0, sc);
          label = `Move the scene ${quoted(sc.name)}`;
        });
      },
      async duplicateScene(address) {
        // "playlists": the copy's track orders and play orders are the playlists' places.
        return write((sc: SceneInfo) => `Make ${quoted(sc.name)}`, ["campaigns", "playlists"], () => {
          const { session: s, scene: sc, index } = scene(address);
          // DAT-14, PLY-17: a copy keeps the scene's names for its tracks and its Repeat ones; the lead's decision (b6
          // notes, contracts Q1): its track orders and play orders too, so a copy is the whole scene.
          const made: SceneInfo = { ...copy(sc), id: newId("scene"), name: `${sc.name || "Scene"} (copy)` };
          s.scenes.splice(index + 1, 0, made);
          const from = keyOfPlace({ kind: "scene", ...address });
          const to = keyOfPlace({ kind: "scene", ...address, sceneId: made.id });
          if (state.trackOrders[from]) state.trackOrders[to] = copy(state.trackOrders[from]);
          if (state.playOrders[from]) state.playOrders[to] = copy(state.playOrders[from]);
          return made;
        });
      },
      async deleteScene(address) {
        let label = "";
        return write(() => label, ["campaigns", "profiles", "playlists", "boards"], () => {
          const { session: s, scene: sc, index } = scene(address);
          s.scenes.splice(index, 1);
          delete state.overrides[placeKey({ kind: "scene", ...address })];
          delete state.playOrders[keyOfPlace({ kind: "scene", ...address })];
          delete state.trackOrders[keyOfPlace({ kind: "scene", ...address })];
          dropReferences(state, { sceneId: address.sceneId });
          label = `Delete the scene ${quoted(sc.name)}`;
        });
      },
      async setSceneMusic(address, music) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          music.forEach(checkMusic);
          sc.music = copy(music);
          label = `Change the music of ${quoted(sc.name)}`;
        });
      },
      async setSceneAmbience(address, ambience) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          if (ambience) checkAmbience(ambience);
          sc.ambience = copy(ambience);
          label = `Change the ambience of ${quoted(sc.name)}`;
        });
      },
      async setSceneBoards(address, boardIds) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          boardIds.forEach(board);
          sc.boardIds = [...new Set(boardIds)];
          label = `Change the pad boards of ${quoted(sc.name)}`;
        });
      },
      async setTrackName(address, trackId, name) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          const t = track(trackId);
          const clean = typeof name === "string" ? name.trim() : refuse("invalid", "A name is text.", "name");
          if (clean.length > 200) refuse("invalid", "A name in a scene is at most 200 characters.", "name");
          if (clean) sc.trackNames[t.id] = clean;
          else delete sc.trackNames[t.id];
          const where = sc.name ? `the scene ${quoted(sc.name)}` : "this scene";
          label = clean ? `Name the track ${quoted(clean)} in ${where}` : `Use the track's own name in ${where}`;
        });
      },
      async setRepeatOne(address, trackId, on) {
        let label = "";
        return write(() => label, ["campaigns"], () => {
          const { scene: sc } = scene(address);
          const t = track(trackId);
          if (typeof on !== "boolean") refuse("invalid", "Repeat one is on or off.", "on");
          const ones = new Set(sc.repeatOnes);
          if (on) ones.add(t.id);
          else ones.delete(t.id);
          sc.repeatOnes = [...ones].sort();
          const where = sc.name ? `the scene ${quoted(sc.name)}` : "this scene";
          label = on ? `Repeat one in ${where}` : `Stop repeating one in ${where}`;
        });
      },
    },

    profiles: {
      async overrides() {
        return copy(state.overrides);
      },
      async set(trackId, place, profile) {
        let label = "";
        return write(() => label, place ? ["profiles"] : ["tracks", "profiles"], () => {
          const t = track(trackId);
          if (place) placeExists(place);
          const p = copy(profile ?? {});
          checkProfile(p, t.durationMs);
          if (place) (state.overrides[placeKey(place)] ??= {})[trackId] = p;
          else t.profile = p;
          label = `Change the audio profile of ${quoted(shownTitle(t))}`;
        });
      },
      async clear(trackId, place) {
        let label = "";
        return write(() => label, ["profiles"], () => {
          const t = track(trackId);
          const key = placeKey(place);
          if (!state.overrides[key]?.[trackId]) refuse("not-found", "This place already uses the track's own settings.");
          delete state.overrides[key][trackId];
          if (Object.keys(state.overrides[key]).length === 0) delete state.overrides[key];
          label = `Use the track's own settings for ${quoted(shownTitle(t))}`;
        });
      },
    },

    import: {
      async start(source: ImportSource) {
        if (importing) return { ok: false, refusal: { code: "busy", message: "Lyre is still adding files. Wait for it to finish, then try again." } };
        importing = true;
        try {
          let paths: string[] | null;
          if (source.from === "paths") paths = source.paths;
          else if (source.from === "choose-files") paths = options.choose?.files?.() ?? null;
          else {
            const folder = chooseFolder();
            paths = folder ? [folder] : null;
          }
          if (!paths) {
            const summary: ImportSummary = { added: [], alreadyInLibrary: [], trackIds: [], problems: [], cancelled: true, summary: "Nothing was added." };
            return { ok: true, value: summary, changed: [], undoLabel: history().undoLabel };
          }
          const summary = await importPaths(paths);
          const changed: LyreArea[] = summary.added.length ? ["tracks", "history"] : [];
          return { ok: true, value: summary, changed, undoLabel: history().undoLabel };
        } finally {
          importing = false;
        }
      },
      async watchFolder(source) {
        const path = source.from === "path" ? source.path : chooseFolder();
        if (!path) return { ok: true, value: null, changed: [], undoLabel: history().undoLabel };
        return writeWithoutHistory(["folders"], false, () => {
          const known = state.folders.find((f) => f.path.toLowerCase() === path.toLowerCase());
          if (known?.watched) refuse("already-watched", `Lyre is already watching ${path}.`);
          if (known) known.watched = true;
          else state.folders.push({ path, watched: true });
          return { path: known?.path ?? path, watched: true };
        });
      },
      async findMissing() {
        const out: MissingTrack[] = state.tracks
          .filter((t) => state.missing.includes(t.id))
          .map((t) => ({ id: t.id, title: shownTitle(t), path: pathOf(t), fileName: t.fileName, folder: t.folder, sizeBytes: t.sizeBytes }));
        return out.sort((a, b) => a.title.localeCompare(b.title));
      },
      async planRelink(source) {
        const folder = source.from === "path" ? source.path : chooseFolder();
        const missing = await api.import.findMissing();
        const taken = new Set(state.tracks.filter((t) => !state.missing.includes(t.id)).map((t) => pathOf(t).toLowerCase()));
        const plan: RelinkPlan = { folder: folder ?? "", matches: [], ambiguous: [], notFound: [], summary: "" };
        const files = folder ? filesUnder(folder).filter((f) => !taken.has(f.toLowerCase())) : [];
        for (const m of missing) {
          const name = splitPath(m.path).name.toLowerCase();
          const hits = files.filter((f) => splitPath(f).name.toLowerCase() === name);
          if (hits.length === 1) plan.matches.push({ trackId: m.id, from: m.path, to: hits[0], confidence: "name", toUrl: fileAddress(hits[0]) });
          else if (hits.length > 1) plan.ambiguous.push({ trackId: m.id, candidates: hits });
          else plan.notFound.push(m.id);
        }
        plan.summary = folder
          ? [`Found ${plural(plan.matches.length, "missing file")}.`, plan.ambiguous.length ? `${plural(plan.ambiguous.length, "track")} could be one of several files.` : "", plan.notFound.length ? `${plural(plan.notFound.length, "file")} not found.` : ""].filter(Boolean).join(" ")
          : "No folder was chosen.";
        lastPlan = plan;
        previewing = null;
        return { ok: true, value: plan, changed: [], undoLabel: history().undoLabel };
      },
      async previewFound(trackId) {
        const match = lastPlan?.matches.find((m) => m.trackId === trackId);
        if (!match) return { ok: false, refusal: { code: "not-found", message: "Look for the missing files again: Lyre has no file found for that track now." } };
        if (match.confidence !== "name") return { ok: false, refusal: { code: "invalid", message: "Only a file found by its name alone needs a listen before relinking.", field: "trackId" } };
        previewing = match.to;
        emit({ type: "changed", areas: ["folders"] });
        return { ok: true, value: { url: match.toUrl }, changed: ["folders"], undoLabel: history().undoLabel };
      },
      async endRelinkPreview() {
        previewing = null;
        emit({ type: "changed", areas: ["folders"] });
        return { ok: true, value: undefined, changed: ["folders"], undoLabel: history().undoLabel };
      },
      async applyRelink(matches) {
        return write((r: { relinked: string[] }) => `Find ${plural(r.relinked.length, "missing file")}`, ["tracks"], () => {
          for (const m of matches) {
            const t = track(m.trackId);
            const other = state.tracks.find((x) => x !== t && pathOf(x).toLowerCase() === m.to.toLowerCase());
            if (other) refuse("invalid", `${m.to} is already the file of "${shownTitle(other)}".`, "to");
            const { folder, name } = splitPath(m.to);
            t.folder = folder;
            t.fileName = name;
            t.url = fileAddress(m.to);
            state.missing = state.missing.filter((id) => id !== t.id);
          }
          return { relinked: matches.map((m) => m.trackId) };
        });
      },
    },

    transfer: {
      async estimate(scope) {
        const out = estimateTransfer(scope, state, new Date(now()).toISOString().slice(0, 10));
        if (!out) throw new Error("That is no longer in your library.");
        return out;
      },
      async save({ scope, includeAudio, path }) {
        const estimate = estimateTransfer(scope, state, new Date(now()).toISOString().slice(0, 10));
        if (!estimate) return { ok: false, refusal: { code: "not-found", message: "That is no longer in your library." } };
        const to = path ?? options.choose?.saveFile?.(estimate.fileName) ?? null;
        if (!to) return { ok: true, value: null, changed: [], undoLabel: history().undoLabel };
        const contents = copy(transferContents(scope, state));
        const audio = includeAudio && !estimate.leaveAudioOutBecause;
        lyreFiles.set(to.toLowerCase(), { contents, includesAudio: audio, savedAt: now() });
        const bytes = JSON.stringify(contents).length + (audio ? (estimate.audioBytes ?? 0) : 0);
        const size = bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
        return { ok: true, value: { path: to, bytes, summary: `Saved ${splitPath(to).name} (${size}) in ${splitPath(to).folder}.` }, changed: [], undoLabel: history().undoLabel };
      },
      async open(source) {
        const path = source.from === "path" ? source.path : (options.choose?.lyreFile?.() ?? null);
        if (!path) return { ok: true, value: null, changed: [], undoLabel: history().undoLabel };
        const file = lyreFiles.get(path.toLowerCase());
        if (!file) return { ok: false, refusal: { code: "not-lyre-file", message: `${splitPath(path).name} is not a Lyre file, or it is damaged. Nothing was changed.` } };
        const c = file.contents;
        const items: NonNullable<typeof opened>["items"] = [];
        const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        // Tracks first: the playlists, boards and campaigns brought in refer to them by id.
        const trackMap = new Map<string, string>();
        const yoursTrack = (t: LibraryTrack) => state.tracks.find((x) => same(x.fileName, t.fileName) && x.durationMs === t.durationMs);
        if (c.tracks.length) {
          const dupes = c.tracks.filter((t) => yoursTrack(t));
          const add = (asCopy: boolean) => {
            for (const t of c.tracks) {
              const mine = yoursTrack(t);
              if (mine && !asCopy) trackMap.set(t.id, mine.id);
              else {
                const made = { ...copy(t), id: newId("track") };
                state.tracks.push(made);
                trackMap.set(t.id, made.id);
              }
            }
          };
          items.push({
            key: "tracks", kind: "tracks", name: plural(c.tracks.length, "track"),
            detail: dupes.length ? `${dupes.length} already in your library (same file name and length)` : "All new",
            status: dupes.length ? "duplicate" : "new", yours: null,
            take: () => add(false), merge: () => add(false), copy: () => add(true), ids: () => ({ id: "", name: plural(c.tracks.length, "track") }),
          });
        }
        const tid = (id: string) => trackMap.get(id) ?? id;
        const from = ` (from ${splitPath(path).name.replace(/\.lyre$/i, "")})`;
        for (const p of c.playlists) {
          const mine = state.playlists.find((x) => same(x.name, p.name));
          let made: PlaylistInfo | null = null;
          const take = (name: string) => {
            made = { ...copy(p), id: newId("playlist"), name, order: p.order } as PlaylistInfo;
            if (made.kind === "manual") made.trackIds = made.trackIds.map(tid);
            state.playlists.push(made);
          };
          items.push({
            key: `playlist:${p.id}`, kind: "playlist", name: p.name, detail: p.kind === "dynamic" ? `Dynamic${mine ? " · yours has the same name" : ""}` : `${plural(p.trackIds.length, "track")}${mine ? " · yours has the same name" : ""}`,
            status: mine ? "duplicate" : "new", yours: mine ? { kind: "playlist", id: mine.id } : null,
            take: () => take(p.name),
            merge: () => { if (mine?.kind === "manual" && p.kind === "manual") for (const t of p.trackIds.map(tid)) if (!mine.trackIds.includes(t)) mine.trackIds.push(t); },
            copy: () => take(p.name + from),
            ids: (): { id: string; name: string } => (made ? { id: made.id, name: made.name } : { id: mine?.id ?? "", name: p.name }),
          });
        }
        for (const b of c.boards) {
          const mine = state.boards.find((x) => same(x.name, b.name));
          let made: PadBoard | null = null;
          const renew = (pad: Pad): Pad => ({ ...copy(pad), id: newId("pad"), sound: { ...copy(pad.sound), trackIds: pad.sound.trackIds.map(tid) } });
          const take = (name: string) => {
            made = { ...copy(b), id: newId("board"), name, slots: b.slots.map((x) => (x ? renew(x) : null)), spare: b.spare.map(renew) };
            state.boards.push(made);
          };
          items.push({
            key: `board:${b.id}`, kind: "board", name: b.name, detail: `${plural([...b.slots, ...b.spare].filter(Boolean).length, "pad")}${mine ? " · yours has the same name" : ""}`,
            status: mine ? "duplicate" : "new", yours: mine ? { kind: "board", id: mine.id } : null,
            take: () => take(b.name),
            merge: () => { if (mine) for (const x of [...b.slots, ...b.spare]) if (x && ![...mine.slots, ...mine.spare].some((y) => y && same(y.label, x.label))) mine.spare.push({ ...renew(x), aside: false }); },
            copy: () => take(b.name + from),
            ids: (): { id: string; name: string } => (made ? { id: made.id, name: made.name } : { id: mine?.id ?? "", name: b.name }),
          });
        }
        for (const camp of c.campaigns) {
          const mine = state.campaigns.find((x) => same(x.name, camp.name));
          let made: CampaignInfo | null = null;
          const renewSessions = (cid: string) => camp.sessions.map((s) => ({
            ...copy(s), id: newId("session"), campaignId: cid, status: "draft" as const, trackIds: s.trackIds.map(tid),
            scenes: s.scenes.map((sc) => ({ ...copy(sc), id: newId("scene"), music: sc.music.map((r) => (r.kind === "track" ? { ...r, id: tid(r.id) } : r)), ambience: sc.ambience?.kind === "track" ? { ...sc.ambience, id: tid(sc.ambience.id) } : copy(sc.ambience), trackNames: Object.fromEntries(Object.entries(sc.trackNames).map(([k, v]) => [tid(k), v])) })),
          }));
          const take = (name: string) => {
            const id = newId("campaign");
            made = { ...copy(camp), id, name, trackIds: camp.trackIds.map(tid), sessions: renewSessions(id) };
            state.campaigns.push(made);
          };
          items.push({
            key: `campaign:${camp.id}`, kind: "campaign", name: camp.name, detail: `${plural(camp.sessions.length, "session")}, ${plural(camp.sessions.reduce((n, s) => n + s.scenes.length, 0), "scene")}`,
            status: mine ? "duplicate" : "new", yours: mine ? { kind: "campaign", id: mine.id } : null,
            take: () => take(camp.name),
            merge: () => { if (mine) mine.sessions.push(...renewSessions(mine.id)); },
            copy: () => take(camp.name + from),
            ids: (): { id: string; name: string } => (made ? { id: made.id, name: made.name } : { id: mine?.id ?? "", name: camp.name }),
          });
        }
        if (c.tagGroups.length) {
          const fresh = c.tagGroups.flatMap((g) => g.values.filter((v) => !state.tagGroups.find((x) => x.id === g.id)?.values.some((y) => same(y, v))).map((v) => `${g.name}: ${v}`));
          const add = () => {
            for (const g of c.tagGroups) {
              const mine = state.tagGroups.find((x) => x.id === g.id) ?? (state.tagGroups.push({ ...copy(g), values: [] }), state.tagGroups[state.tagGroups.length - 1]);
              for (const v of g.values) if (!mine.values.some((y) => same(y, v))) mine.values.push(v);
            }
          };
          items.push({ key: "tags", kind: "tags", name: plural(fresh.length, "new tag value"), detail: fresh.join(" · ") || "You have them all", status: "new", yours: null, take: add, merge: add, copy: add, ids: () => ({ id: "", name: "tags" }) });
        }
        opened = { id: newId("opened"), file: path, items };
        const value: OpenedFile = {
          id: opened.id,
          fileName: splitPath(path).name,
          madeWith: `Lyre, ${new Date(file.savedAt).toISOString().slice(0, 10)}`,
          includesAudio: file.includesAudio,
          items: items.map(({ key, kind, name, detail, status, yours }) => ({ key, kind, name, detail, status, yours })),
        };
        return { ok: true, value, changed: [], undoLabel: history().undoLabel };
      },
      async bringIn(openedId, choices) {
        if (!opened || opened.id !== openedId) return { ok: false, refusal: { code: "not-found", message: "Open the file again: Lyre no longer has it open." } };
        const file = opened;
        return write(() => `Bring in ${splitPath(file.file).name}`, ["tracks", "tags", "playlists", "boards", "campaigns"], () => {
          const report: BringInReport = { added: [], merged: [], keptBoth: [], skipped: [], missingFiles: 0, summary: "" };
          for (const item of file.items) {
            const choice: DuplicateChoice = choices?.each?.[item.key] ?? choices?.all ?? "skip";
            if (item.status === "new") {
              item.take();
              report.added.push({ kind: item.kind, ...item.ids() });
            } else if (choice === "skip") {
              // Tracks the file shares with the library are always the library's own: skipping keeps yours and adds the rest.
              if (item.kind === "tracks") item.merge();
              report.skipped.push({ kind: item.kind, name: item.name });
            } else if (choice === "merge") {
              item.merge();
              report.merged.push({ kind: item.kind, ...item.ids() });
            } else {
              item.copy();
              report.keptBoth.push({ kind: item.kind, ...item.ids() });
            }
          }
          const parts = [`Brought in ${plural(report.added.length + report.merged.length + report.keptBoth.length, "item")} from ${splitPath(file.file).name}.`];
          if (report.skipped.length) parts.push(`${plural(report.skipped.length, "duplicate")} skipped.`);
          if (report.keptBoth.length) parts.push(`${plural(report.keptBoth.length, "copy", "copies")} kept beside yours.`);
          report.summary = parts.join(" ");
          opened = null;
          return report;
        });
      },
      async movedReport() {
        const moved = options.moved === undefined ? seed.moved : options.moved;
        if (!moved) return null;
        return { ...copy(moved), missing: await api.import.findMissing() };
      },
    },

    history: {
      async state() {
        return history();
      },
      async undo() {
        const step = undoStack.pop();
        if (!step) return { ok: false, refusal: { code: "nothing-to-undo", message: "There is nothing to undo." } };
        restore(step.before);
        redoStack.push(step);
        const changed = [...step.areas, "history" as const];
        emit({ type: "changed", areas: changed });
        return { ok: true, value: { undone: step.label }, changed, undoLabel: history().undoLabel };
      },
      async redo() {
        const step = redoStack.pop();
        if (!step) return { ok: false, refusal: { code: "nothing-to-redo", message: "There is nothing to redo." } };
        restore(step.after);
        undoStack.push(step);
        const changed = [...step.areas, "history" as const];
        emit({ type: "changed", areas: changed });
        return { ok: true, value: { redone: step.label }, changed, undoLabel: history().undoLabel };
      },
    },

    // Round 7 (fakeRound7.ts).
    folders: r7.folders,
    settings: r7.settings,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    failNextWrite() {
      failNext = true;
    },
    previewableFiles() {
      return previewing ? [previewing] : [];
    },
    async arrive(folder, fileNames) {
      if (!state.folders.some((f) => f.watched && f.path.toLowerCase() === folder.toLowerCase())) return [];
      const known = new Set(state.tracks.map((t) => pathOf(t).toLowerCase()));
      const made = fileNames.filter((n) => AUDIO.test(n) && !known.has(`${folder}\\${n}`.toLowerCase())).map((n) => newTrack(`${folder}\\${n}`));
      if (!made.length) return [];
      writeWithoutHistory(["tracks"], true, () => state.tracks.push(...made));
      const ids = made.map((t) => t.id);
      emit({ type: "watched-files", folder, trackIds: ids });
      return ids;
    },
  };
  return api;
}
