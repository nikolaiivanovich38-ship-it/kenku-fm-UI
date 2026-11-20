/**
 * The Library's and Playlists' rules that need no screen: which tracks a filter shows, in what order, and the words
 * the screens use for times, kinds, rules and audio profiles. Ported from design/prototype/src/views/library.js
 * (matches, visible, filterSummary, kindMark, profileSummary) and playlists.js (ruleWords, fmtLong).
 *
 * Built for 20,000 tracks: each track's search text is worked out once per track object (a track changed by a write
 * is a new object), and sorting uses one shared collator.
 */
import { isFx, resolveProfile, shapeOf, SHAPE_WORDS, type DomainTrack, type PlaylistRule, type ProfileOverrides, type TrackShape } from "../../../common/domain";
import type { FolderRoot, LibraryTrack, TagGroup } from "../../../common/lyre/api";
import { lengthText, plural, shownTitle } from "../../../common/lyre/text";
import { trackHasTag, type TagTree } from "../../../common/domain/round7";
import { inVocabularyOrder } from "../../../common/lyre/lookup";
import { USE_WORDS } from "./trackEnd";

export { inVocabularyOrder, plural, shownTitle };

export type KindFilter = "all" | "music" | "amb" | "fx";
export type SortKey =
  | "title"
  | "title-za"
  | "tag"
  | "tag-za"
  | "energy"
  | "energy-desc"
  | "artist"
  | "short"
  | "long"
  | "new"
  | "old"
  // --- r10-tracks --- Round 9 (item 26): a sort for each column a header can sort by.
  | "artist-za"
  | "album"
  | "album-za"
  | "type"
  | "type-za"
  | "use"
  | "use-za"
  | "shape"
  | "shape-za"
  | "plays"
  | "plays-desc"
  | "folder"
  | "folder-za";

export const SORTS: readonly [SortKey, string][] = [
  ["title", "Title A to Z"],
  ["title-za", "Title Z to A"],
  ["tag", "Tag A to Z"],
  ["tag-za", "Tag Z to A"],
  ["energy", "Energy, calm first"],
  ["energy-desc", "Energy, intense first"],
  ["artist", "Artist A to Z"],
  ["short", "Shortest first"],
  ["long", "Longest first"],
  ["new", "Newest first"],
  ["old", "Oldest first"],
];

export const KIND_NAMES: Record<"music" | "amb" | "fx", string> = { music: "Music", amb: "Ambience", fx: "FX" };

/**
 * Round 9 (ROUND9.md §7, item 26: "I need a way to configure the columns visible in the library tracks pane"): the
 * columns the track list can show beside Title, which is always there, in the prototype's order and words; the usual
 * three are Tags, Energy and Length.
 */
export type ColumnKey = "artist" | "album" | "type" | "use" | "tags" | "shape" | "energy" | "length" | "plays" | "added" | "folder";
export const COLUMNS: readonly (readonly [ColumnKey, string])[] = [
  ["artist", "Artist"],
  ["album", "Album"],
  ["type", "Type"],
  ["use", "Use it for"],
  ["tags", "Tags"],
  ["shape", "Shape"],
  ["energy", "Energy"],
  ["length", "Length"],
  ["plays", "Plays for"],
  ["added", "Added"],
  ["folder", "Folder"],
];
export const USUAL_COLUMNS: readonly ColumnKey[] = ["tags", "energy", "length"];
/** The chosen columns in the list's order, whatever order they were ticked in; unknown names are dropped. */
export function inColumnOrder(keys: readonly string[]): ColumnKey[] {
  return COLUMNS.map(([k]) => k).filter((k) => keys.includes(k));
}

/** The roles a track can have, in the prototype's order and words ("Effect" is offered for sound effects only). */
export const ROLES: readonly [NonNullable<DomainTrack["role"]>, string][] = [
  ["loop_bed", "Loop bed"],
  ["underscore", "Underscore"],
  ["sting", "Sting"],
  ["transition", "Transition"],
];
export const EFFECT_ROLE: [NonNullable<DomainTrack["role"]>, string] = ["effect", "Effect"];
export const LOOPS: readonly [NonNullable<DomainTrack["loop"]>, string][] = [
  ["yes", "Loops well"],
  ["crossfade", "Crossfade the loop"],
  ["no", "Do not loop"],
];
export const ENERGY_WORDS = ["Calm", "Low", "Moderate", "High", "Intense"];

export interface LibraryFilter {
  kind: KindFilter;
  newOnly: boolean;
  /** Ticked values by tag group id; a track matches a group when it has any of them. */
  tags: Record<string, string[]>;
  emin: number;
  emax: number;
  /** A folder path ("" for every folder). */
  folder: string;
  /** DAT-13: only tracks of one of these shapes (the game master's choice, else Lyre's suggestion). Empty: any. */
  shapes: TrackShape[];
  /** DAT-8: only tracks whose files Lyre cannot find. */
  missing: boolean;
  // --- r10-tracks --- Round 9 (item 34: "choose filters /not/ to show"): what a second click hides. Hide wins over show.
  /** Hidden values by tag group id: a track with any of them is left out. */
  hide: Record<string, string[]>;
  hideShapes: TrackShape[];
  /** Folder paths whose tracks (and their subfolders') are left out. */
  hideFolders: string[];
}

export const DEFAULT_FILTER: LibraryFilter = { kind: "all", newOnly: false, tags: {}, emin: 1, emax: 5, folder: "", shapes: [], missing: false, hide: {}, hideShapes: [], hideFolders: [] };

/** The three states of a filter chip (or folder): off, Show (only these), Hide (leave these out). */
export type ChipState = "off" | "show" | "hide";
/** Round 9 (item 34): one click moves a chip on: off → Show → Hide → off. */
export function nextChipState(state: ChipState): ChipState {
  return state === "off" ? "show" : state === "show" ? "hide" : "off";
}
/** A value's state, from the lists of shown and hidden values. */
export const chipState = (shown: readonly string[], hidden: readonly string[], value: string): ChipState => (hidden.includes(value) ? "hide" : shown.includes(value) ? "show" : "off");
/** The two lists after one click on a value. */
export function cycleChip<T extends string>(shown: readonly T[], hidden: readonly T[], value: T): { shown: T[]; hidden: T[]; now: ChipState } {
  const now = nextChipState(chipState(shown, hidden, value));
  return { shown: now === "show" ? [...shown, value] : shown.filter((x) => x !== value), hidden: now === "hide" ? [...hidden, value] : hidden.filter((x) => x !== value), now };
}
/** A folder: once shows only it, again hides it (and shows every folder), again shows it with the rest. */
export function cycleFolder(f: LibraryFilter, path: string): Pick<LibraryFilter, "folder" | "hideFolders"> & { now: ChipState } {
  if (!path) return { folder: "", hideFolders: [], now: "off" };
  if (f.folder === path) return { folder: "", hideFolders: [...f.hideFolders, path], now: "hide" };
  if (f.hideFolders.includes(path)) return { folder: f.folder, hideFolders: f.hideFolders.filter((x) => x !== path), now: "off" };
  return { folder: path, hideFolders: f.hideFolders, now: "show" };
}

/** The shapes in the prototype's order, with their words (Filters › Shape, a track's details, Rules › Shape). */
export const SHAPES = (Object.keys(SHAPE_WORDS) as TrackShape[]).map((s) => [s, SHAPE_WORDS[s]] as const);

/* ---------- small helpers ---------- */

export const tagsOf = (t: DomainTrack): string[] => Object.values(t.tags).flat();
export const untagged = (t: DomainTrack): boolean => tagsOf(t).length === 0;
/** New, not tagged yet: just added, or without any tag. */
export const isNewish = (t: LibraryTrack): boolean => t.isNew || untagged(t);
export const shortPath = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const inFolder = (t: { folder: string }, f: string): boolean => !f || t.folder === f || t.folder.startsWith(`${f}\\`) || t.folder.startsWith(`${f}/`);
export const kindOk = (t: DomainTrack, k: KindFilter): boolean => k === "all" || (k === "fx" ? isFx(t) : t.kind === k);
const energyOff = (f: LibraryFilter) => f.emin <= 1 && f.emax >= 5;

/** "1:35" from milliseconds (item 51: the one helper, common/lyre/text.ts lengthText). */
export const fmt = lengthText;
/** A playlist's length: "19:26", or "1:02:05" from an hour (the same helper). */
export const fmtLong = lengthText;

/** Item 7: how long a track plays with its own Audio profile, Start to End (the file's length when it has none). */
export function playedMs(t: DomainTrack): number {
  const p = resolveProfile(t, [], {}).profile;
  return Math.max(0, p.endMs - p.startMs);
}

/** When a track was added, as the Details pane says it: "Today", "12 Sep", or "12 Sep 2025" in another year. */
export function addedText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return "Today";
  // A fixed month list: the locale's short names vary ("Sept" in some).
  const day = `${d.getDate()} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** The small marker before a title: text as well as colour. Null for music. */
export function kindMark(t: DomainTrack): { lane: "amb" | "fx"; text: string; title: string } | null {
  if (t.kind === "fx") return { lane: "fx", text: "FX", title: "Sound effect" };
  if (t.kind === "amb") return { lane: "amb", text: "Amb", title: "Ambience" };
  if (isFx(t)) return { lane: "fx", text: "FX · Short cue", title: "FX: a short music cue" };
  return null;
}

/* ---------- which tracks show ---------- */

const haystacks = new WeakMap<LibraryTrack, string>();
function haystack(t: LibraryTrack): string {
  let h = haystacks.get(t);
  if (h === undefined) {
    h = [t.title, t.metaTitle, t.fileName, t.artist, t.album, ...tagsOf(t)].join(" ").toLowerCase();
    haystacks.set(t, h);
  }
  return h;
}
/** Every word must appear somewhere in the track's names, artist, album or tags. */
export function searchWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** No track is known to be missing (the list of missing files has not come yet). */
const NONE_MISSING: ReadonlySet<string> = new Set();

/**
 * `missing`: ids of the tracks whose files Lyre cannot find (LyreApi import.findMissing). `tree` (DAT-10): tags inside
 * tags, so a tag finds the tracks of the tags inside it too (r7tags.js L.trackHasTag).
 */
export function matches(t: LibraryTrack, f: LibraryFilter, words: string[], skipNew = false, missing: ReadonlySet<string> = NONE_MISSING, tree?: TagTree): boolean {
  if (!kindOk(t, f.kind)) return false;
  if (f.newOnly && !skipNew && !isNewish(t)) return false;
  if (f.missing && !missing.has(t.id)) return false;
  if (f.shapes.length) {
    const { shape } = shapeOf(t);
    if (!shape || !f.shapes.includes(shape)) return false;
  }
  if (!inFolder(t, f.folder)) return false;
  if (!energyOff(f) && ((t.energy ?? 0) < f.emin || (t.energy ?? 0) > f.emax)) return false;
  for (const [group, want] of Object.entries(f.tags)) {
    if (want.length && !want.some((v) => trackHasTag(t, group, v, tree))) return false;
  }
  // Round 9 (item 34): hidden values, shapes and folders leave their tracks out.
  for (const [group, hidden] of Object.entries(f.hide ?? {})) {
    if (hidden.some((v) => trackHasTag(t, group, v, tree))) return false;
  }
  if (f.hideShapes?.length) {
    const { shape } = shapeOf(t);
    if (shape && f.hideShapes.includes(shape)) return false;
  }
  if (f.hideFolders?.some((h) => inFolder(t, h))) return false;
  if (words.length) {
    const h = haystack(t);
    if (!words.every((w) => h.includes(w))) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byTitle = (a: LibraryTrack, b: LibraryTrack) => collator.compare(shownTitle(a), shownTitle(b));
/** A track's first tag as its row shows it; "" when it has none (sorted last, whichever way). */
const firstTag = (t: LibraryTrack) => tagsOf(t)[0] ?? "";
const blanksLast = (a: string | number | null, b: string | number | null) => Number(a === "" || a === null) - Number(b === "" || b === null);
/** Sorts by words a column shows, A to Z or Z to A, with blank cells last either way, then by title. */
const byWords = (of: (t: LibraryTrack) => string, down = false) => (a: LibraryTrack, b: LibraryTrack) =>
  blanksLast(of(a), of(b)) || (down ? collator.compare(of(b), of(a)) : collator.compare(of(a), of(b))) || byTitle(a, b);
const typeWord = (t: LibraryTrack) => KIND_NAMES[t.kind];
const useWord = (t: LibraryTrack) => (t.role ? USE_WORDS[t.role] : "");
const shapeWord = (t: LibraryTrack) => {
  const { shape } = shapeOf(t);
  return shape ? SHAPE_WORDS[shape] : "";
};
const SORTERS: Record<SortKey, (a: LibraryTrack, b: LibraryTrack) => number> = {
  title: byTitle,
  "title-za": (a, b) => byTitle(b, a),
  tag: (a, b) => blanksLast(firstTag(a), firstTag(b)) || collator.compare(firstTag(a), firstTag(b)) || byTitle(a, b),
  "tag-za": (a, b) => blanksLast(firstTag(a), firstTag(b)) || collator.compare(firstTag(b), firstTag(a)) || byTitle(a, b),
  energy: (a, b) => blanksLast(a.energy, b.energy) || (a.energy ?? 0) - (b.energy ?? 0) || byTitle(a, b),
  "energy-desc": (a, b) => blanksLast(a.energy, b.energy) || (b.energy ?? 0) - (a.energy ?? 0) || byTitle(a, b),
  artist: (a, b) => collator.compare(a.artist, b.artist) || byTitle(a, b),
  short: (a, b) => a.durationMs - b.durationMs,
  long: (a, b) => b.durationMs - a.durationMs,
  new: (a, b) => b.addedAt - a.addedAt || byTitle(a, b),
  old: (a, b) => a.addedAt - b.addedAt || byTitle(a, b),
  "artist-za": byWords((t) => t.artist, true),
  album: byWords((t) => t.album),
  "album-za": byWords((t) => t.album, true),
  type: byWords(typeWord),
  "type-za": byWords(typeWord, true),
  use: byWords(useWord),
  "use-za": byWords(useWord, true),
  shape: byWords(shapeWord),
  "shape-za": byWords(shapeWord, true),
  plays: (a, b) => playedMs(a) - playedMs(b) || byTitle(a, b),
  "plays-desc": (a, b) => playedMs(b) - playedMs(a) || byTitle(a, b),
  folder: byWords((t) => t.folder),
  "folder-za": byWords((t) => t.folder, true),
};

/**
 * Item 25: the column headers that sort, each with its sort one way and the other (a first click sorts ascending, a
 * second descending), and what aria-sort says for a sort.
 */
export const COLUMN_SORTS = {
  title: ["title", "title-za"],
  tags: ["tag", "tag-za"],
  energy: ["energy", "energy-desc"],
  length: ["short", "long"],
  // --- r10-tracks --- Round 9 (item 26): every column sorts.
  artist: ["artist", "artist-za"],
  album: ["album", "album-za"],
  type: ["type", "type-za"],
  use: ["use", "use-za"],
  shape: ["shape", "shape-za"],
  plays: ["plays", "plays-desc"],
  added: ["old", "new"],
  folder: ["folder", "folder-za"],
} as const satisfies Record<"title" | ColumnKey, readonly [SortKey, SortKey]>;
export type SortColumn = keyof typeof COLUMN_SORTS;
export function columnSort(column: SortColumn, now: SortKey): { aria: "ascending" | "descending" | undefined; next: SortKey } {
  const [up, down] = COLUMN_SORTS[column];
  return { aria: now === up ? "ascending" : now === down ? "descending" : undefined, next: now === up ? down : up };
}

/** The tracks a filter, search and sort show, in order. */
export function visibleTracks(tracks: readonly LibraryTrack[], f: LibraryFilter, q: string, sort: SortKey, missing: ReadonlySet<string> = NONE_MISSING, tree?: TagTree): LibraryTrack[] {
  const words = searchWords(q);
  return tracks.filter((t) => matches(t, f, words, false, missing, tree)).sort(SORTERS[sort]);
}

/* ---------- describing the filters ---------- */

export function filterCount(f: LibraryFilter): number {
  return (
    Number(f.kind !== "all") +
    Number(f.newOnly) +
    Number(f.missing) +
    f.shapes.length +
    Number(!!f.folder) +
    Number(!energyOff(f)) +
    Object.values(f.tags).reduce((n, v) => n + v.length, 0) +
    Object.values(f.hide ?? {}).reduce((n, v) => n + v.length, 0) +
    (f.hideShapes?.length ?? 0) +
    (f.hideFolders?.length ?? 0)
  );
}
export const filtersOn = (f: LibraryFilter): boolean => filterCount(f) > 0;

export function filterSummary(f: LibraryFilter, groups: readonly TagGroup[]): string {
  const parts: string[] = [];
  if (f.kind !== "all") parts.push(KIND_NAMES[f.kind]);
  if (f.newOnly) parts.push("New, not tagged yet");
  if (f.missing) parts.push("Missing files");
  if (f.shapes.length) parts.push(f.shapes.map((x) => SHAPE_WORDS[x]).join(", "));
  // Round 9 (item 34): what is hidden reads "not …": "Tense · not Combat".
  const not = (words: readonly string[]) => `not ${words.join(", not ")}`;
  if (f.hideShapes?.length) parts.push(not(f.hideShapes.map((x) => SHAPE_WORDS[x])));
  for (const g of groups) {
    if (f.tags[g.id]?.length) parts.push(f.tags[g.id].join(", "));
    if (f.hide?.[g.id]?.length) parts.push(not(f.hide[g.id]));
  }
  if (f.hideFolders?.length) parts.push(not(f.hideFolders.map(shortPath)));
  if (!energyOff(f)) parts.push(`energy ${f.emin} to ${f.emax}`);
  if (f.folder) parts.push(shortPath(f.folder));
  // Round 6 (UX-R3): no filter is the usual case, so nothing is said.
  return parts.join(" · ");
}

export interface FolderRow {
  path: string;
  label: string;
  count: number;
  watched: boolean;
  /** A subfolder of the chosen library folder, shown under it. */
  sub: boolean;
  /** 0.5.2 items 20 and 40: the library folder this row is (its ⋯), or null for any other row. */
  root: FolderRoot | null;
}

/**
 * The Folders filter: "All folders", each library folder (and the folder of any track outside them), and, under the
 * chosen folder, its subfolders. Counts follow the kind filter.
 */
export function folderRows(tracks: readonly LibraryTrack[], roots: readonly FolderRoot[], chosen: string, kind: KindFilter): FolderRow[] {
  const base = tracks.filter((t) => kindOk(t, kind));
  const all: { path: string; watched: boolean; root: FolderRoot | null }[] = roots.map((r) => ({ path: r.path, watched: r.watched, root: r }));
  for (const t of tracks) {
    if (!all.some((r) => inFolder(t, r.path))) all.push({ path: t.folder.split("\\").slice(0, 3).join("\\"), watched: false, root: null });
  }
  const count = (f: string) => base.filter((t) => inFolder(t, f)).length;
  const rows: FolderRow[] = [{ path: "", label: "All folders", count: base.length, watched: false, sub: false, root: null }];
  for (const r of all) {
    rows.push({ path: r.path, label: r.path, count: count(r.path), watched: r.watched, sub: false, root: r.root });
    if (chosen && inFolder({ folder: chosen }, r.path)) {
      const subs = new Set<string>();
      for (const t of base) if (t.folder.startsWith(`${r.path}\\`)) subs.add(`${r.path}\\${t.folder.slice(r.path.length + 1).split("\\")[0]}`);
      for (const s of [...subs].sort()) rows.push({ path: s, label: shortPath(s), count: count(s), watched: false, sub: true, root: null });
    }
  }
  return rows;
}

/* ---------- audio profile and rules in words ---------- */

/** One line about a track's own audio profile, e.g. "Ends at 5:18, then loops from 1:04 · fades in 2 s." */
export function profileSummary(t: DomainTrack, overrides: ProfileOverrides): string {
  const p = resolveProfile(t, [], overrides).profile;
  const dur = t.durationMs;
  const cut = p.startMs > 0 || p.endMs < dur;
  const range = !cut
    ? "Whole track"
    : p.startMs > 0 && p.endMs < dur
      ? `Starts at ${fmt(p.startMs)}, ends at ${fmt(p.endMs)}`
      : p.startMs > 0
        ? `Starts at ${fmt(p.startMs)}`
        : `Ends at ${fmt(p.endMs)}`;
  const after = p.after === "loop" ? `then loops from ${p.loopStartMs > p.startMs ? fmt(p.loopStartMs) : "the start"}` : p.after === "stop" ? "then stops" : "then the next one";
  const parts = [`${range}, ${after}`];
  const fades: string[] = [];
  if (p.fadeIn.ms) fades.push(`in ${Math.round(p.fadeIn.ms / 100) / 10} s`);
  if (p.fadeOut.ms) fades.push(`out ${Math.round(p.fadeOut.ms / 100) / 10} s`);
  if (fades.length) parts.push(`fades ${fades.join(", ")}`);
  const places = Object.values(overrides).filter((byTrack) => byTrack[t.id]).length;
  return `${parts.join(" · ")}.${places ? ` Has its own settings in ${places === 1 ? "1 playlist or scene" : `${places} playlists and scenes`}.` : ""}`;
}

/** A dynamic playlist's rule in the prototype's words (L.ruleText), leaving out conditions that have no values yet. */
export function ruleWords(rule: PlaylistRule, groupNames: Record<string, string>): string {
  const how = { any: "any of", all: "all of", none: "none of" } as const;
  const parts = rule.conds.filter((c) => c.values.length).map((c) => `${groupNames[c.group] ?? c.group} ${how[c.match]} ${c.values.join(", ")}`);
  if (rule.energy) parts.push(`energy ${rule.energy[0]} to ${rule.energy[1]}`);
  if (rule.leaveOutStings) parts.push("not short cues");
  if (rule.shapes?.length) parts.push(`shape ${rule.shapes.map((x) => SHAPE_WORDS[x].toLowerCase()).join(" or ")}`);
  return parts.join("; ");
}
