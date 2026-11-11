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
import { plural, shownTitle } from "../../../common/lyre/text";
import { trackHasTag, type TagTree } from "../../../common/domain/round7";
import { inVocabularyOrder } from "../../../common/lyre/lookup";

export { inVocabularyOrder, plural, shownTitle };

export type KindFilter = "all" | "music" | "amb" | "fx";
export type SortKey = "title" | "artist" | "short" | "long" | "new" | "old";

export const SORTS: readonly [SortKey, string][] = [
  ["title", "Title A to Z"],
  ["artist", "Artist A to Z"],
  ["short", "Shortest first"],
  ["long", "Longest first"],
  ["new", "Newest first"],
  ["old", "Oldest first"],
];

export const KIND_NAMES: Record<"music" | "amb" | "fx", string> = { music: "Music", amb: "Ambience", fx: "FX" };

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
}

export const DEFAULT_FILTER: LibraryFilter = { kind: "all", newOnly: false, tags: {}, emin: 1, emax: 5, folder: "", shapes: [], missing: false };

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

/** "1:35" from milliseconds. */
export function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
/** A playlist's length: "19:26", or "1:02:05" from an hour. */
export function fmtLong(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600) return fmt(s * 1000);
  const h = Math.floor(s / 3600);
  return `${h}:${fmt((s - h * 3600) * 1000).padStart(5, "0")}`;
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
  if (isFx(t)) return { lane: "fx", text: "FX · Sting", title: "FX: a sting (short music cue)" };
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
  if (words.length) {
    const h = haystack(t);
    if (!words.every((w) => h.includes(w))) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const byTitle = (a: LibraryTrack, b: LibraryTrack) => collator.compare(shownTitle(a), shownTitle(b));
const SORTERS: Record<SortKey, (a: LibraryTrack, b: LibraryTrack) => number> = {
  title: byTitle,
  artist: (a, b) => collator.compare(a.artist, b.artist) || byTitle(a, b),
  short: (a, b) => a.durationMs - b.durationMs,
  long: (a, b) => b.durationMs - a.durationMs,
  new: (a, b) => b.addedAt - a.addedAt || byTitle(a, b),
  old: (a, b) => a.addedAt - b.addedAt || byTitle(a, b),
};

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
    Object.values(f.tags).reduce((n, v) => n + v.length, 0)
  );
}
export const filtersOn = (f: LibraryFilter): boolean => filterCount(f) > 0;

export function filterSummary(f: LibraryFilter, groups: readonly TagGroup[]): string {
  const parts: string[] = [];
  if (f.kind !== "all") parts.push(KIND_NAMES[f.kind]);
  if (f.newOnly) parts.push("New, not tagged yet");
  if (f.missing) parts.push("Missing files");
  if (f.shapes.length) parts.push(f.shapes.map((x) => SHAPE_WORDS[x]).join(", "));
  for (const g of groups) if (f.tags[g.id]?.length) parts.push(f.tags[g.id].join(", "));
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
}

/**
 * The Folders filter: "All folders", each library folder (and the folder of any track outside them), and, under the
 * chosen folder, its subfolders. Counts follow the kind filter.
 */
export function folderRows(tracks: readonly LibraryTrack[], roots: readonly FolderRoot[], chosen: string, kind: KindFilter): FolderRow[] {
  const base = tracks.filter((t) => kindOk(t, kind));
  const all = roots.map((r) => ({ path: r.path, watched: r.watched }));
  for (const t of tracks) {
    if (!all.some((r) => inFolder(t, r.path))) all.push({ path: t.folder.split("\\").slice(0, 3).join("\\"), watched: false });
  }
  const count = (f: string) => base.filter((t) => inFolder(t, f)).length;
  const rows: FolderRow[] = [{ path: "", label: "All folders", count: base.length, watched: false, sub: false }];
  for (const r of all) {
    rows.push({ path: r.path, label: r.path, count: count(r.path), watched: r.watched, sub: false });
    if (chosen && inFolder({ folder: chosen }, r.path)) {
      const subs = new Set<string>();
      for (const t of base) if (t.folder.startsWith(`${r.path}\\`)) subs.add(`${r.path}\\${t.folder.slice(r.path.length + 1).split("\\")[0]}`);
      for (const s of [...subs].sort()) rows.push({ path: s, label: shortPath(s), count: count(s), watched: false, sub: true });
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
  return `${parts.join(" · ")}.${places ? ` Has its own settings in ${plural(places, "place")}.` : ""}`;
}

/** A dynamic playlist's rule in the prototype's words (L.ruleText), leaving out conditions that have no values yet. */
export function ruleWords(rule: PlaylistRule, groupNames: Record<string, string>): string {
  const how = { any: "any of", all: "all of", none: "none of" } as const;
  const parts = rule.conds.filter((c) => c.values.length).map((c) => `${groupNames[c.group] ?? c.group} ${how[c.match]} ${c.values.join(", ")}`);
  if (rule.energy) parts.push(`energy ${rule.energy[0]} to ${rule.energy[1]}`);
  if (rule.leaveOutStings) parts.push("not stings");
  if (rule.shapes?.length) parts.push(`shape ${rule.shapes.map((x) => SHAPE_WORDS[x].toLowerCase()).join(" or ")}`);
  return parts.join("; ");
}
