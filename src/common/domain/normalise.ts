/**
 * PLY-15, DAT-15: volume normalisation (design/prototype/ROUND5.md "Volume normalisation (PLY-15, DAT-15)"; the
 * prototype's core.js L.normDecision, L.normaliseGain, L.normLine and L.normHover).
 *
 * Nik, 5 Nov 2026: "we'll also need volume baseline normalisation across the tracks, and an option we can turn on
 * either at the whole library level or per track or playlist."
 *
 * - Lyre measures each track's loudness (EBU R128 integrated loudness in LUFS, or the loudest moment of a sound
 *   under 3 s) and its true peak (dBTP). Not measured yet: it plays as it is.
 * - The library's setting is off at first, with a target level; a playlist and a track each follow it (null) or
 *   are on or off. The most specific choice wins: the track, then the playlist it plays from, then the library.
 * - Gain = target - loudness, at most +12 dB, and lowered so the true peak stays at or below -1 dBTP.
 */

/** A playlist's or a track's own choice; null (or missing) follows the library ("Library setting"). */
export type NormaliseChoice = "on" | "off";
export const NORMALISE_CHOICES = ["on", "off"] as const satisfies readonly NormaliseChoice[];

export const NORMALISE_TARGETS = ["quiet", "standard", "loud"] as const;
export type NormaliseTarget = (typeof NORMALISE_TARGETS)[number];
/** Quiet is the broadcast level (EBU R128), Loud that of music streaming services. */
export const NORMALISE_TARGET_LUFS: Record<NormaliseTarget, number> = { quiet: -23, standard: -18, loud: -14 };
export const NORMALISE_TARGET_WORDS: Record<NormaliseTarget, string> = { quiet: "Quiet", standard: "Standard", loud: "Loud" };

/** The most Lyre turns a track up. */
export const MAX_BOOST_DB = 12;
/** An evened-out track's true peak stays at or below this. */
export const PEAK_CEILING_DBTP = -1;
/** A sound shorter than this is measured by its loudest moment: integrated loudness is unreliable that short. */
export const SHORT_SOUND_MS = 3000;

/** What Lyre measured from a track's file. */
export interface TrackLoudness {
  /** Integrated loudness in LUFS (for a sound under 3 s, its loudest momentary loudness). */
  lufs: number;
  /** True peak in dBTP (dB relative to full scale, between samples too). */
  truePeakDb: number;
}

/** The library's setting (Library › ⋯ › Normalise volume…). */
export interface LibraryNormalise {
  on: boolean;
  target: NormaliseTarget;
}

export const DEFAULT_LIBRARY_NORMALISE: Readonly<LibraryNormalise> = Object.freeze({ on: false, target: "standard" });

/** Where the choice that applies comes from. */
export type NormaliseSource = "track" | "playlist" | "library";

/** The parts of a track the rules read. */
export interface NormalisedTrack {
  normalise?: NormaliseChoice | null;
  loudness?: TrackLoudness | null;
}
/** The part of a playlist the rules read: null when the track plays on its own (a scene's single track, a pad). */
export type NormalisedPlaylist = { normalise?: NormaliseChoice | null } | null | undefined;

/** Which choice applies: the track's own, then the playlist's it plays from, then the library's. */
export function normaliseDecision(
  track: NormaliseChoice | null | undefined,
  playlist: NormaliseChoice | null | undefined,
  library: LibraryNormalise,
): { on: boolean; from: NormaliseSource } {
  if (track) return { on: track === "on", from: "track" };
  if (playlist) return { on: playlist === "on", from: "playlist" };
  return { on: library.on, from: "library" };
}

/** To a tenth, halves away from zero, so -2.25 and 2.25 round alike. */
function tenth(x: number): number {
  return (Math.sign(x) * Math.round(Math.abs(x) * 10)) / 10 || 0;
}

/**
 * The gain that brings a measured track to `targetLufs`: what the target needs, at most +12 dB ("cap"), and lowered
 * so its true peak stays at or below -1 dBTP ("peak"; this can turn down a track whose peaks are already above it).
 * Null for a track not measured yet.
 */
export function normaliseGain(loudness: TrackLoudness | null | undefined, targetLufs: number): { gainDb: number; limit: "peak" | "cap" | null } | null {
  if (!loudness) return null;
  const wanted = targetLufs - loudness.lufs;
  const room = PEAK_CEILING_DBTP - loudness.truePeakDb;
  const gain = Math.min(wanted, MAX_BOOST_DB, room);
  return { gainDb: tenth(gain), limit: gain === wanted ? null : gain === room ? "peak" : "cap" };
}

/** Everything a screen says about one track where it plays. */
export function normaliseState(track: NormalisedTrack | undefined, playlist: NormalisedPlaylist, library: LibraryNormalise) {
  const decision = normaliseDecision(track?.normalise, playlist?.normalise, library);
  const loudness = track?.loudness ?? null;
  const gain = decision.on ? normaliseGain(loudness, NORMALISE_TARGET_LUFS[library.target]) : null;
  return { ...decision, loudness, gainDb: gain?.gainDb ?? 0, limit: gain?.limit ?? null };
}

/** The gain the engine applies, in dB: 0 when normalising is off there or the track is not measured yet. */
export function normalisedGainDb(track: NormalisedTrack | undefined, playlist: NormalisedPlaylist, library: LibraryNormalise): number {
  return normaliseState(track, playlist, library).gainDb;
}

/** Decibels as the factor a gain node takes. */
export function dbToGain(db: number): number {
  return db === 0 ? 1 : Math.pow(10, db / 20);
}

/** "+4.6 dB", "-2.2 dB", "0.0 dB". */
export function formatGainDb(db: number): string {
  const r = tenth(db);
  return `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(1)} dB`;
}

function formatLufs(lufs: number): string {
  return `${tenth(lufs).toFixed(1)} LUFS`;
}

/** The library's setting in words: "Off", "On, Standard (-18 LUFS)". */
export function libraryNormaliseWords(library: LibraryNormalise): string {
  return library.on ? `On, ${NORMALISE_TARGET_WORDS[library.target]} (${NORMALISE_TARGET_LUFS[library.target]} LUFS)` : "Off";
}

/** The measured line under Normalise volume: "-22.6 LUFS · +4.6 dB", "-22.6 LUFS · plays as it is", "Not measured yet: plays as it is". */
export function normaliseLine(track: NormalisedTrack | undefined, playlist: NormalisedPlaylist, library: LibraryNormalise): string {
  const s = normaliseState(track, playlist, library);
  if (!s.loudness) return "Not measured yet: plays as it is";
  if (!s.on) return `${formatLufs(s.loudness.lufs)} · plays as it is`;
  const why = s.limit === "peak" ? " (kept under -1 dBTP)" : s.limit === "cap" ? " (the most Lyre adds)" : "";
  return `${formatLufs(s.loudness.lufs)} · ${formatGainDb(s.gainDb)}${why}`;
}

/** What a hover says where a track plays (the Now playing bar, Live): "Volume evened out: +4.6 dB (-22.6 LUFS measured)". */
export function normaliseHover(track: NormalisedTrack | undefined, playlist: NormalisedPlaylist, library: LibraryNormalise): string {
  const s = normaliseState(track, playlist, library);
  if (!s.on) return "Volume not evened out";
  if (!s.loudness) return "Volume not evened out: not measured yet";
  return `Volume evened out: ${formatGainDb(s.gainDb)} (${tenth(s.loudness.lufs).toFixed(1)} LUFS measured)`;
}

/** A playlist's line: "Its tracks get -2.2 dB to +2.7 dB here; 1 plays as it is". */
export function playlistNormaliseLine(tracks: readonly NormalisedTrack[], playlist: NormalisedPlaylist, library: LibraryNormalise): string {
  const states = tracks.map((t) => normaliseState(t, playlist, library));
  const gains = states.filter((s) => s.on && s.loudness).map((s) => s.gainDb);
  const notMeasured = states.filter((s) => s.on && !s.loudness).length;
  const asIs = states.filter((s) => !s.on).length;
  if (!gains.length && !notMeasured) return "Its tracks play as they are";
  const parts: string[] = [];
  if (gains.length) {
    const lo = Math.min(...gains);
    const hi = Math.max(...gains);
    parts.push(`Its tracks get ${lo === hi ? formatGainDb(lo) : `${formatGainDb(lo)} to ${formatGainDb(hi)}`} here`);
  }
  if (asIs) parts.push(asIs === 1 ? "1 plays as it is" : `${asIs} play as they are`);
  if (notMeasured) parts.push(`${notMeasured} not measured yet`);
  return parts.join("; ");
}
