/**
 * The Tags screen's rules (DAT-10, design/prototype/src/views/r7tags.js): a group's tags in the order shown (each tag
 * followed by the tags inside it), how many tracks each finds (a tag finds the tracks of the tags inside it too), the
 * words read out and shown on hover for a tag, and which tags a Move up, Move down or Merge into… may use.
 */
import type { LibraryTrack, PadColor, TagGroup, TagInfo } from "../../../common/lyre/api";
import { tagTreeOf } from "../../../common/lyre/lookup";
import { tagsInside, trackHasTag, type TagTree } from "../../../common/domain/round7";
import { PAD_COLOUR } from "../boards/boardModel";

/** A tag as the screen lists it: indented by how deep it sits inside other tags. */
export interface ShownTag {
  info: TagInfo;
  depth: number;
}

/** The colours by name, in the pad palette's order (steel, ember, …): Colour… offers these. */
export const COLOUR_CHOICES = Object.keys(PAD_COLOUR) as PadColor[];

export function colourName(color: PadColor | null): string {
  return color ? PAD_COLOUR[color].name : "";
}

function infoOf(group: TagGroup, name: string): TagInfo {
  return group.tags?.find((t) => t.name === name) ?? { name, parent: null, also: [], color: null };
}

/** The group's tags in the order shown: each tag of its own, followed by the tags inside it (r7tags.js ordered). */
export function orderedTags(group: TagGroup): ShownTag[] {
  const names = group.values;
  const out: ShownTag[] = [];
  const seen = new Set<string>();
  const add = (name: string, depth: number) => {
    if (seen.has(name)) return; // a loop in the tree is cut
    seen.add(name);
    out.push({ info: infoOf(group, name), depth });
    for (const child of names) if (infoOf(group, child).parent === name) add(child, depth + 1);
  };
  for (const name of names) {
    const parent = infoOf(group, name).parent;
    if (!parent || !names.includes(parent)) add(name, 0);
  }
  return out;
}

export const tracksText = (n: number): string => `${n} track${n === 1 ? "" : "s"}`;

/** How many tracks the tag finds: those with it or with a tag inside it (the Library's filter finds the same). */
export function tagCount(tracks: readonly LibraryTrack[], groupId: string, tag: string, tree: TagTree): number {
  return tracks.filter((t) => trackHasTag(t, groupId, tag, tree)).length;
}

/** How many tracks carry the tag itself (Delete… takes it off these). */
export function ownCount(tracks: readonly LibraryTrack[], groupId: string, tag: string): number {
  return tracks.filter((t) => (t.tags[groupId] ?? []).includes(tag)).length;
}

/** What a tag's row says on hover and to a screen reader: "Inside Melancholy. Also found by: sad, sorrowful. 4 tracks." */
export function tagWords(info: TagInfo, count: number): string {
  return `${info.parent ? `Inside ${info.parent}. ` : ""}${info.also.length ? `Also found by: ${info.also.join(", ")}. ` : ""}${tracksText(count)}.`;
}

/** The tags at the same level (the same parent), in order: Move up and Move down swap among these. */
export function sameLevel(group: TagGroup, tag: string): string[] {
  const parent = infoOf(group, tag).parent;
  return group.values.filter((v) => infoOf(group, v).parent === parent);
}

/** The tags a tag can be merged into or put inside: every other tag of the group but those inside it. */
export function otherTags(group: TagGroup, tag: string): ShownTag[] {
  const inside = new Set(tagsInside(tagTreeOf([group]), group.id, tag));
  return orderedTags(group).filter((t) => t.info.name !== tag && !inside.has(t.info.name));
}

/** The tags directly inside this one (they move up a level when it is deleted). */
export function childrenOf(group: TagGroup, tag: string): string[] {
  return group.values.filter((v) => infoOf(group, v).parent === tag);
}
