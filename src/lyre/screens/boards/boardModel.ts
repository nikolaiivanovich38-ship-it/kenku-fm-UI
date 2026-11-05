/**
 * Pad boards: the words, names and small rules the board screens share (design/prototype/src/views/boards.js,
 * "helpers"). Pure functions over LyreApi shapes, so they are tested on their own and the components stay about
 * drawing and events.
 */
import type { CampaignInfo, Pad, PadBoard, PadColor } from "../../../common/lyre/api";
import type { PadMode } from "../../../common/domain";
import type { IconName } from "../../kit/Icon";

/** A board has 1 to 8 columns and 1 to 8 rows. */
export const MAX_SIZE = 8;
/** The quick sizes, columns × rows, in the prototype's order. */
export const QUICK_SIZES: readonly [number, number][] = [
  [2, 2],
  [3, 2],
  [4, 2],
  [4, 3],
  [4, 4],
  [6, 4],
];

export const MODES: readonly PadMode[] = ["oneshot", "toggle", "hold", "retrigger"];
export const MODE_NAME: Record<PadMode, string> = { oneshot: "One-shot", toggle: "Toggle loop", hold: "Hold to play", retrigger: "Restart on press" };
export const MODE_ICON: Record<PadMode, IconName> = { oneshot: "one", toggle: "loop", hold: "hand", retrigger: "restart" };
export const MODE_HELP: Record<PadMode, string> = {
  oneshot: "Plays once from the start on each press. Quick presses overlap.",
  toggle: "First press starts a loop; the next press fades it out.",
  hold: "Plays while you hold the key or button, and fades when you let go.",
  retrigger: "Each press stops the last one and starts again, so it never overlaps.",
};

/** Pad colours are identities (a stripe and a swatch); the text keeps the theme's ink. */
export const PAD_COLOUR: Record<PadColor, { name: string; hex: string }> = {
  steel: { name: "Steel", hex: "#8fb3d9" },
  ember: { name: "Ember", hex: "#f08a52" },
  gold: { name: "Gold", hex: "#e8bd62" },
  moss: { name: "Moss", hex: "#7fcf8f" },
  violet: { name: "Violet", hex: "#b69cff" },
  plum: { name: "Plum", hex: "#d394e0" },
  sea: { name: "Sea", hex: "#5fd4c0" },
  bone: { name: "Bone", hex: "#d9cfb8" },
};

/** The icons a pad can have, with their names: the icon set without the icons that mean app controls. */
export const PAD_ICONS: readonly [IconName, string][] = [
  ["swords", "Crossed swords"],
  ["arrow", "Arrow"],
  ["shield", "Shield"],
  ["flame", "Flame"],
  ["bolt", "Lightning"],
  ["skull", "Skull"],
  ["heart", "Heart"],
  ["bell", "Bell"],
  ["drop", "Drop"],
  ["wind", "Wind"],
  ["rain", "Rain"],
  ["tree", "Tree"],
  ["door", "Door"],
  ["note", "Music note"],
  ["horn", "Horn"],
  ["ghost", "Ghost"],
  ["chain", "Chain"],
  ["wave", "Waves"],
  ["mug", "Mug"],
  ["eye", "Eye"],
  ["star", "Star"],
  ["drum", "Drum"],
  ["moon", "Moon"],
  ["claw", "Claw marks"],
  ["organ", "Organ pipes"],
  ["book", "Book"],
  ["users", "People"],
  ["map", "Map"],
  ["scroll", "Scroll"],
  ["crown", "Crown"],
];

export function iconName(icon: string): string {
  return PAD_ICONS.find(([id]) => id === icon)?.[1] ?? icon;
}

/** "1 pad", "3 pads". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where a slot is, in words: "row 2, column 3". */
export function place(cols: number, index: number): string {
  return `row ${Math.floor(index / cols) + 1}, column ${(index % cols) + 1}`;
}

export const padCount = (b: PadBoard) => b.slots.filter(Boolean).length;
export const emptyCount = (b: PadBoard) => b.slots.filter((p) => !p).length;

/** "4 × 3, 11 pads, 1 empty, 2 spare": the size line on a board's card. */
export function sizeText(b: PadBoard): string {
  const empty = emptyCount(b);
  return `${b.cols} × ${b.rows}, ${plural(padCount(b), "pad")}${empty ? `, ${empty} empty` : ""}${b.spare.length ? `, ${b.spare.length} spare` : ""}`;
}

export type PadAt = { where: "slot" | "spare"; index: number; pad: Pad };

export function findPad(b: PadBoard, padId: string | null | undefined): PadAt | null {
  if (!padId) return null;
  const slot = b.slots.findIndex((p) => p?.id === padId);
  if (slot > -1) return { where: "slot", index: slot, pad: b.slots[slot] as Pad };
  const spare = b.spare.findIndex((p) => p.id === padId);
  return spare > -1 ? { where: "spare", index: spare, pad: b.spare[spare] } : null;
}

/** Every pad on the board: the grid row by row, then the spare pads. */
export function allPads(b: PadBoard): Pad[] {
  return [...b.slots.filter((p): p is Pad => p !== null), ...b.spare];
}

/** The pad the board starts with selected: its first pad on the grid, else its first spare pad. */
export function firstPad(b: PadBoard): Pad | null {
  return allPads(b)[0] ?? null;
}

/** A key as the game master reads it: "Q", "1", "F5". */
export function keyLabel(key: string): string {
  return key.toUpperCase();
}

/** Another pad on this board with the same key, if any. */
export function keyOwner(b: PadBoard, key: string, notId: string): Pad | null {
  if (!key) return null;
  return allPads(b).find((p) => p.id !== notId && p.key.toLowerCase() === key.toLowerCase()) ?? null;
}

/**
 * The key a key press gives a pad: a letter, a digit or another printable character (lower case), or F1 to F12.
 * Null for anything else (Space, arrows, Enter...).
 */
export function padKeyFrom(key: string): string | null {
  if (key.length === 1 && key !== " ") return key.toLowerCase();
  return /^F([1-9]|1[0-2])$/.test(key) ? key : null;
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };

export function isArrow(key: string): boolean {
  return key in ARROWS;
}

/** The slot next to `index` in the arrow's direction, or -1 at the edge. */
export function neighbour(cols: number, rows: number, index: number, arrow: string): number {
  const [dr, dc] = ARROWS[arrow] ?? [0, 0];
  const r = Math.floor(index / cols) + dr;
  const c = (index % cols) + dc;
  return r < 0 || c < 0 || r >= rows || c >= cols ? -1 : r * cols + c;
}

/** One place a board is used, as Used in and Delete board… list it. */
export interface BoardUse {
  level: "campaign" | "session" | "scene";
  campaignId: string;
  label: string;
  /** Where the link goes: the campaign, or the session planner. */
  href: string;
}

/** Where a board is used: each campaign, then its sessions and their scenes (the prototype's L.usesOfBoard). */
export function usesOfBoard(campaigns: readonly CampaignInfo[], boardId: string): BoardUse[] {
  const out: BoardUse[] = [];
  for (const c of campaigns) {
    if (c.boardIds.includes(boardId)) out.push({ level: "campaign", campaignId: c.id, label: `${c.name} (whole campaign)`, href: `#/campaign/${c.id}` });
    for (const s of c.sessions) {
      const href = `#/session/${c.id}/${s.id}`;
      if (s.boardIds.includes(boardId)) out.push({ level: "session", campaignId: c.id, label: `${c.name} › Session ${s.number}`, href });
      for (const sc of s.scenes) {
        if (sc.boardIds.includes(boardId)) out.push({ level: "scene", campaignId: c.id, label: `${c.name} › Session ${s.number} › ${sc.name}`, href });
      }
    }
  }
  return out;
}

/** What the message under the size controls says after a resize. */
export function resizeMessage(after: PadBoard, movedLabels: readonly string[], grew: boolean): string {
  if (movedLabels.length) {
    return `${plural(movedLabels.length, "pad")} moved to Spare pads: ${movedLabels.join(", ")}. Nothing was deleted.`;
  }
  const done = `Grid is now ${after.cols} × ${after.rows}`;
  if (grew) {
    return `${done}: ${plural(emptyCount(after), "empty slot")} to fill.${after.spare.length ? " Spare pads can go back into them." : ""}`;
  }
  return `${done}.`;
}

/** What is said after a pad moves (the prototype's moveTo). */
export function moveMessage(b: PadBoard, pad: Pad, to: number | "spare", other: Pad | null, fromSpare: boolean): string {
  if (to === "spare") return `${pad.label} moved to Spare pads`;
  const swap = other ? `, swapped with ${other.label}${fromSpare ? ", which went to Spare pads" : ""}` : "";
  return `${pad.label} moved to ${place(b.cols, to)}${swap}`;
}

/** The pad tile's accessible name: its visible label and key first (Label in Name), then mode, place and state. */
export function padTileName(pad: Pad, cols: number, index: number, state: "on air" | "previewing" | null): string {
  const key = pad.key ? ` ${keyLabel(pad.key)}` : "";
  return `${pad.label}${key}: ${MODE_NAME[pad.mode]}, ${place(cols, index)}${state ? `, ${state}` : ""}`;
}
