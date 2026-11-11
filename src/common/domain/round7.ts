/**
 * Design round 7's shared rules (design/prototype/ROUND7.md; views/r7tags.js, r7org.js, r7play.js, r7shell.js),
 * used by the database, the in-memory fake, the audio host and the screens. Pure functions only.
 *
 * - DAT-10: a tag can hold other tags (Mood › Melancholy › Grief); filters and dynamic rules find the tags inside too
 *   (trackHasTag; matchesRule takes the TagTree); a track lists its tags in the Tags screen's order (inScreenOrder).
 *   Another word for a tag offers the tag (offerTags).
 * - ORG-4, ORG-5: folder paths; the places a drag can go (DropPlace and its prototype keys).
 * - PLY-8: steps (CueStep) for a scene's start and a pad; the usual ones are never stored (stepsToKeep).
 * - PLY-4, SHW-3: what a track's role means when it plays (roleProfile) and which choices it shows (roleChoices).
 * - PLY-1: what played in a room this evening (addPlayed).
 * - UX-12: keyboard shortcuts (SHORTCUT_ACTIONS, keyName, normaliseKey, shortcutUsing, guardAllows).
 * - UX-11, PRV-2, PLY-8: display options, sound devices and the crossfade, with their checks.
 */
import type { UsePlace } from "./round5";
import type { AudioProfile, DomainTrack, SoundRef } from "./types";

/* ---------- DAT-10 tags inside tags ---------- */

/** Per tag group id, each tag that sits inside another, with that tag (its parent) of the same group. */
export type TagTree = Record<string, Record<string, string>>;

/** The tags inside `tag` at every depth, in the order the tree lists them (a loop in the tree is cut). */
export function tagsInside(tree: TagTree | undefined, group: string, tag: string): string[] {
  const parents = tree?.[group];
  if (!parents) return [];
  const out: string[] = [];
  const seen = new Set([tag]);
  const walk = (of: string) => {
    for (const [child, parent] of Object.entries(parents)) {
      if (parent !== of || seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      walk(child);
    }
  };
  walk(tag);
  return out;
}

/**
 * DAT-10: tags in the Tags screen's order (r7tags.js ordered), the order a track lists its tags in: each tag of its own
 * (no parent, or a parent not in the list) in saved order, followed depth first by the tags inside it, also in saved
 * order. `tags` are in saved order; a parent is always in the same group, so a list of several groups keeps their
 * order. A loop in the tree is cut: its tags follow, in saved order.
 */
export function inScreenOrder<T>(tags: readonly T[], key: (tag: T) => string, parent: (tag: T) => string | null): T[] {
  const keys = new Set(tags.map(key));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const tag of tags) {
    const p = parent(tag);
    if (p !== null && keys.has(p) && p !== key(tag)) {
      const list = children.get(p);
      if (list) list.push(tag);
      else children.set(p, [tag]);
    } else roots.push(tag);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const add = (tag: T) => {
    if (seen.has(key(tag))) return;
    seen.add(key(tag));
    out.push(tag);
    for (const child of children.get(key(tag)) ?? []) add(child);
  };
  roots.forEach(add);
  tags.forEach(add);
  return out;
}

/** The track has the tag, or a tag inside it (the Library's filters and dynamic playlist rules). r7tags.js L.trackHasTag. */
export function trackHasTag(track: Pick<DomainTrack, "tags">, group: string, tag: string, tree?: TagTree): boolean {
  const have = track.tags[group] ?? [];
  if (have.includes(tag)) return true;
  return tagsInside(tree, group, tag).some((inside) => have.includes(inside));
}

/** One tag offered while typing: the tag, and the other word of it that matched (null: its name did). */
export interface TagOffer {
  tag: string;
  word: string | null;
}

/**
 * The tags of one group offered for what was typed ("sad" offers Melancholy, shown "Melancholy (sad)"): names that
 * start with it first, then tags one of whose other words starts with it; case is ignored. Never a new tag.
 */
export function offerTags(tags: readonly { name: string; also: readonly string[] }[], typed: string): TagOffer[] {
  const text = typed.trim().toLowerCase();
  if (!text) return [];
  const byName = tags.filter((t) => t.name.toLowerCase().startsWith(text)).map((t): TagOffer => ({ tag: t.name, word: null }));
  const byWord = tags
    .filter((t) => !t.name.toLowerCase().startsWith(text))
    .flatMap((t) => {
      const word = t.also.find((w) => w.toLowerCase().startsWith(text));
      return word ? [{ tag: t.name, word }] : [];
    });
  return [...byWord.filter((o) => o.word.toLowerCase() === text), ...byName, ...byWord.filter((o) => o.word.toLowerCase() !== text)];
}

/* ---------- ORG-4 folders, ORG-5 drops ---------- */

/** A nested folder's name with the folders it is in: "Sunken Crown › Villains" (empty when it is gone). */
export function folderPath(folders: readonly { id: string; name: string; parentId: string | null }[], id: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let at = folders.find((f) => f.id === id);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    names.unshift(at.name);
    const parent: string | null = at.parentId;
    at = parent ? folders.find((f) => f.id === parent) : undefined;
  }
  return names.join(" › ");
}

/**
 * ORG-5: where dragged tracks, playlists or boards can go: a manual playlist, a pad board (as new pads), a room's Up
 * next (the audio host's Add to queue), or a scene of a session.
 */
export type DropPlace =
  | { kind: "playlist"; playlistId: string }
  | { kind: "board"; boardId: string }
  | { kind: "queue"; roomId: string }
  | { kind: "scene"; campaignId: string; sessionId: string; sceneId: string };

/** The prototype's key of a place: pl:<id>, pb:<board>, q:<room>, sc:<campaign>:<session>:<scene>. */
export function dropPlaceKey(place: DropPlace): string {
  switch (place.kind) {
    case "playlist":
      return `pl:${place.playlistId}`;
    case "board":
      return `pb:${place.boardId}`;
    case "queue":
      return `q:${place.roomId}`;
    case "scene":
      return `sc:${place.campaignId}:${place.sessionId}:${place.sceneId}`;
  }
}

export function parseDropPlace(key: string): DropPlace | null {
  const [kind, ...rest] = key.split(":");
  const one = rest.length === 1 && rest[0] !== "" ? rest[0] : null;
  if (kind === "pl" && one) return { kind: "playlist", playlistId: one };
  if (kind === "pb" && one) return { kind: "board", boardId: one };
  if (kind === "q" && one) return { kind: "queue", roomId: one };
  if (kind === "sc" && rest.length === 3 && rest.every(Boolean)) return { kind: "scene", campaignId: rest[0], sessionId: rest[1], sceneId: rest[2] };
  return null;
}

/* ---------- PLY-8 steps ---------- */

/**
 * How a play step comes in: crossfading (over Settings › Between tracks), cutting, when the current track ends, at
 * its mix-out marker, or after its current loop.
 */
export const STEP_HOWS = ["crossfade", "cut", "trackEnds", "mixOut", "loopEnds"] as const;
export type StepHow = (typeof STEP_HOWS)[number];
/** What a play step does to Up next: replaces what plays, plays next, or goes to the bottom (Add to queue). */
export const STEP_UP_NEXTS = ["replace", "playNext", "addToQueue"] as const;
export type StepUpNext = (typeof STEP_UP_NEXTS)[number];
export const STEP_STOPS = ["music", "ambience", "all"] as const;
export type StepStop = (typeof STEP_STOPS)[number];

export interface StepSceneAddress {
  campaignId: string;
  sessionId: string;
  sceneId: string;
}

/**
 * One step of a scene's start or a pad (r7play.js). The first three are a scene's usual ones and `sound` a pad's;
 * the others are what the game master adds. Times are milliseconds; `level` is 0 to 1.
 */
export type CueStep =
  /** The scene's music from this item of its list on (then the rest of its music). */
  | { do: "music"; what: SoundRef; how: StepHow; upNext: StepUpNext; fromMs: number | null }
  /** The scene's ambience. */
  | { do: "ambience"; what: SoundRef }
  /** Show this pad board in Live. */
  | { do: "board"; boardId: string }
  /** The pad's own sound, in its play mode. */
  | { do: "sound" }
  /** Play a track or a playlist. */
  | { do: "play"; what: SoundRef; how: StepHow; upNext: StepUpNext; fromMs: number | null }
  | { do: "stop"; what: StepStop }
  /** Fade the music to `level` over `ms`. */
  | { do: "fade"; level: number; ms: number }
  | { do: "wait"; ms: number }
  | { do: "pad"; boardId: string; padId: string }
  | { do: "scene"; scene: StepSceneAddress };
export type CueStepKind = CueStep["do"];
export const CUE_STEP_KINDS = ["music", "ambience", "board", "sound", "play", "stop", "fade", "wait", "pad", "scene"] as const satisfies readonly CueStepKind[];

/** A scene that moves on by itself (r7play.js Then): stays until Next, starts the next when its music ends, or after a time. */
export type MovesOn = { when: "stay" } | { when: "musicEnds" } | { when: "after"; ms: number };
export const STAYS: MovesOn = Object.freeze({ when: "stay" }) as MovesOn;
/** The prototype's "after 5 minutes". */
export const MOVES_ON_AFTER_MS = 5 * 60_000;

export const MAX_STEPS = 50;
export const MAX_WAIT_MS = 10 * 60_000;
export const MAX_STEP_FADE_MS = 60_000;

/** A scene's usual start: its music from the first item, its ambience, its first pad board (r7play.js usual()). */
export function usualSceneSteps(scene: { music: readonly SoundRef[]; ambience: SoundRef | null; boardIds: readonly string[] }): CueStep[] {
  const out: CueStep[] = [];
  if (scene.music[0]) out.push({ do: "music", what: { ...scene.music[0] }, how: "crossfade", upNext: "replace", fromMs: null });
  if (scene.ambience) out.push({ do: "ambience", what: { ...scene.ambience } });
  if (scene.boardIds[0]) out.push({ do: "board", boardId: scene.boardIds[0] });
  return out;
}

/** A pad's usual steps: play its sound. */
export function usualPadSteps(): CueStep[] {
  return [{ do: "sound" }];
}

/** The steps that run: the own ones, or the usual ones when none are kept. */
export function stepsOf(own: readonly CueStep[] | null | undefined, usual: readonly CueStep[]): CueStep[] {
  return [...(own ?? usual)];
}

/** What to keep: null when the steps are the usual ones (the prototype's stpdone: "same" deletes them). */
export function stepsToKeep(steps: readonly CueStep[], usual: readonly CueStep[]): CueStep[] | null {
  return JSON.stringify(steps) === JSON.stringify(usual) ? null : [...steps];
}

/** Why these steps cannot be kept on a scene or a pad, in plain words; null when they can. */
export function checkSteps(steps: readonly CueStep[], owner: "scene" | "pad"): string | null {
  if (steps.length > MAX_STEPS) return `A start can have at most ${MAX_STEPS} steps.`;
  for (const step of steps) {
    if ((step.do === "music" || step.do === "ambience" || step.do === "board") && owner !== "scene") return "Only a scene's start plays its music, its ambience or shows its pads.";
    if (step.do === "sound" && owner !== "pad") return "Only a pad plays its own sound.";
    if ((step.do === "music" || step.do === "play") && step.fromMs !== null && !(Number.isInteger(step.fromMs) && step.fromMs >= 0)) return "Play it from the start or from one of its markers.";
    if (step.do === "fade" && !(step.level >= 0 && step.level <= 1)) return "The level of a fade is 0 to 100 %.";
    if (step.do === "fade" && !(Number.isInteger(step.ms) && step.ms >= 0 && step.ms <= MAX_STEP_FADE_MS)) return "A fade lasts at most a minute.";
    if (step.do === "wait" && !(Number.isInteger(step.ms) && step.ms >= 0 && step.ms <= MAX_WAIT_MS)) return "A wait lasts at most 10 minutes.";
  }
  return null;
}

/* ---------- PLY-4, SHW-3 roles ---------- */

/** PLY-4: Ending "Fades out" fades over this long unless the Audio profile has a fade out of its own. */
export const DEFAULT_ENDING_FADE_MS = 4000;
export type RoleChoice = "ending" | "resume" | "follow";
const CHOICES_BY_ROLE: Partial<Record<NonNullable<DomainTrack["role"]>, RoleChoice[]>> = {
  underscore: ["ending", "resume", "follow"],
  loop_bed: ["resume"],
  sting: ["follow"],
  transition: ["ending", "follow"],
};

/** The How it plays choices a track's role shows (r7play.js ROWS): none for a track with no role, or an effect. */
export function roleChoices(track: Pick<DomainTrack, "role" | "kind">): RoleChoice[] {
  if (!track.role || (track.kind === "fx" && track.role !== "sting")) return [];
  return [...(CHOICES_BY_ROLE[track.role] ?? [])];
}

/**
 * The profile a track plays with once its role is applied: a sting never loops (it hands over instead); an ending
 * that fades out fades over DEFAULT_ENDING_FADE_MS unless a profile chose its own fade out. (A loop bed looping when
 * no profile chose what happens at its end is the engine's AFTER_BY_ROLE.)
 */
export function roleProfile(track: Pick<DomainTrack, "role" | "fadesOut">, profile: AudioProfile, chosen: { fadeOutChosen: boolean }): AudioProfile {
  let out = profile;
  if (track.role === "sting" && out.after === "loop") out = { ...out, after: "next" };
  if (track.fadesOut && !chosen.fadeOutChosen && out.fadeOut.ms === 0) out = { ...out, fadeOut: { ms: DEFAULT_ENDING_FADE_MS, shape: 50 } };
  return out;
}

/* ---------- PLY-1 what played ---------- */

/** Where a played track came from, so Play again plays it the same way (the engine's TrackFrom). */
export type PlayedFrom = { scene: StepSceneAddress; at: number } | { playlistId: string; place?: UsePlace };

export interface PlayedEntry {
  trackId: string;
  /** When it started (ms since 1970). */
  at: number;
  from: PlayedFrom | null;
}

/** A room keeps this many (an evening's music, and more). */
export const PLAYED_KEEP = 100;

/** The list with a track that just started on top (newest first). */
export function addPlayed(list: readonly PlayedEntry[], entry: PlayedEntry): PlayedEntry[] {
  return [entry, ...list].slice(0, PLAYED_KEEP);
}

/* ---------- UX-12 keyboard shortcuts ---------- */

/** Every key Lyre listens to, with Lyre's own key and where it works (r7shell.js L.SHORTCUTS). */
export const SHORTCUT_ACTIONS = [
  { id: "palette", name: "Find and play", key: "Ctrl+K", where: "Everywhere" },
  { id: "nextScene", name: "Next scene", key: "Space", where: "Live" },
  { id: "fadeAll", name: "Fade all", key: "Shift+Esc", where: "Live" },
  { id: "undo", name: "Undo", key: "Ctrl+Z", where: "Everywhere" },
  { id: "find", name: "Find a track or playlist", key: "/", where: "Live" },
  { id: "boxes", name: "Next box", key: "F6", where: "Everywhere" },
  { id: "back", name: "Back", key: "Alt+Left", where: "Everywhere" },
  { id: "help", name: "Help", key: "F1", where: "Everywhere" },
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["id"];
export const SHORTCUT_IDS = SHORTCUT_ACTIONS.map((a) => a.id) as readonly ShortcutAction[];
/** Only the keys the game master changed, by action. */
export type ShortcutMap = Partial<Record<ShortcutAction, string>>;

/** The key an action has now. */
export function shortcutKey(map: ShortcutMap, action: ShortcutAction): string {
  return map[action] ?? SHORTCUT_ACTIONS.find((a) => a.id === action)?.key ?? "";
}

/** The action that has this key now (other than `except`), or null. */
export function shortcutUsing(map: ShortcutMap, key: string, except?: ShortcutAction): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((a) => a.id !== except && shortcutKey(map, a.id) === key)?.id ?? null;
}

const KEY_NAMES: Record<string, string> = { " ": "Space", Escape: "Esc", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down" };

/** The name of a pressed key ("Ctrl+K", "Shift+Esc", "Space"); "" for a modifier on its own (r7shell.js L.keyName). */
export function keyName(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string {
  if (/^(Control|Shift|Alt|Meta)$/.test(e.key)) return "";
  const k = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const shift = e.shiftKey && (e.key.length !== 1 || /[a-z]/i.test(e.key));
  return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (shift ? "Shift+" : "") + k;
}

const NAMED_KEYS = ["Space", "Esc", "Left", "Right", "Up", "Down", "Enter", "Tab", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "Insert"];

/** A key written in any case ("ctrl+shift+k") as keyName writes it, or null when it is not a key Lyre can listen to. */
export function normaliseKey(text: string): string | null {
  if (typeof text !== "string" || text.length > 40) return null;
  const parts = text.split("+");
  const main = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (parts.length !== mods.size || [...mods].some((m) => !["ctrl", "alt", "shift"].includes(m))) return null;
  let k: string | undefined;
  if (main.length === 1 && main !== " ") k = main.toUpperCase();
  else if (/^f([1-9]|1[0-2])$/i.test(main)) k = main.toUpperCase();
  else k = NAMED_KEYS.find((n) => n.toLowerCase() === main.toLowerCase());
  if (!k) return null;
  return (mods.has("ctrl") ? "Ctrl+" : "") + (mods.has("alt") ? "Alt+" : "") + (mods.has("shift") ? "Shift+" : "") + k;
}

/** Next scene's guard: a second press within this long is ignored. */
export const NEXT_SCENE_GUARD_MS = 1000;

/** Whether a Next scene pressed `now` counts (the last counted press was at `lastAt`). */
export function guardAllows(lastAt: number | null, now: number, guardOn: boolean): boolean {
  return !guardOn || lastAt === null || now - lastAt >= NEXT_SCENE_GUARD_MS;
}

/* ---------- UX-11 display, PRV-2 devices, PLY-8 crossfade ---------- */

export const DENSITIES = ["compact", "comfortable"] as const;
export type Density = (typeof DENSITIES)[number];
export const TEXT_SIZES = [100, 125, 150, 175, 200] as const;

/** Look and feel › Display, kept per computer (the app zooms the page: webFrame.setZoomFactor(textSize / 100)). */
export interface DisplaySettings {
  density: Density;
  /** Per cent, 100 to 200 in steps of 25. */
  textSize: number;
  highContrast: boolean;
}
export const DEFAULT_DISPLAY: DisplaySettings = Object.freeze({ density: "compact", textSize: 100, highContrast: false }) as DisplaySettings;

export function checkDisplay(patch: Partial<DisplaySettings>): string | null {
  if (patch.density !== undefined && !DENSITIES.includes(patch.density)) return "Choose Compact or Comfortable.";
  if (patch.textSize !== undefined && !(TEXT_SIZES as readonly number[]).includes(patch.textSize)) return "Text size is 100, 125, 150, 175 or 200 %.";
  if (patch.highContrast !== undefined && typeof patch.highContrast !== "boolean") return "High contrast is on or off.";
  return null;
}

/**
 * Settings › Headphones and speakers, kept per computer: the device for what you hear of On air on this computer, the
 * preview's, and one headset split between them (the preview in one ear, On air in the other). "" is the computer's
 * default; a device that is not there plays on the default until it is back.
 */
export interface AudioDevices {
  airDevice: string;
  previewDevice: string;
  split: boolean;
  previewEar: "left" | "right";
}
export const DEFAULT_DEVICES: AudioDevices = Object.freeze({ airDevice: "", previewDevice: "", split: false, previewEar: "left" }) as AudioDevices;

export function checkDevices(patch: Partial<AudioDevices>): string | null {
  for (const key of ["airDevice", "previewDevice"] as const) {
    const id = patch[key];
    if (id !== undefined && (typeof id !== "string" || id.length > 512)) return "That sound device is not one Lyre can use.";
  }
  if (patch.split !== undefined && typeof patch.split !== "boolean") return "Split one headset is on or off.";
  if (patch.previewEar !== undefined && patch.previewEar !== "left" && patch.previewEar !== "right") return "Choose the left ear or the right ear for the preview.";
  return null;
}

/** Settings › Sound to Discord › Between tracks: the crossfade Next, a playlist moving on and play steps use. 0 cuts. */
export interface Crossfade {
  ms: number;
  curve: "even" | "power";
}
export const CROSSFADE_CHOICES_MS = [0, 1000, 2000, 3000, 5000, 8000] as const;
export const DEFAULT_CROSSFADE: Crossfade = Object.freeze({ ms: 3000, curve: "even" }) as Crossfade;

export function checkCrossfade(value: Crossfade): string | null {
  if (!(Number.isInteger(value.ms) && value.ms >= 0 && value.ms <= 20_000)) return "A crossfade lasts 0 to 20 seconds.";
  if (value.curve !== "even" && value.curve !== "power") return "Choose Even or Equal power.";
  return null;
}
