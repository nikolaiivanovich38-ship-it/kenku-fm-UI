/**
 * The words and small rules of the three round 5 screens (design/prototype/src/views/transfer.js): what can be saved,
 * the choices for each scope, sizes in words, and how sure a found file is.
 */
import type { CampaignInfo, IncomingItem, MissingTrack, PadBoard, PlaylistInfo, RelinkMatch, TransferScope } from "../../../common/lyre/api";

export type WhatKind = "library" | "campaign" | "session" | "scene" | "playlist" | "board" | "tags";

/** What to save, in the prototype's order and words (transfer.js WHAT). */
export const WHAT: readonly { kind: WhatKind; title: string; sub: string; which?: string }[] = [
  { kind: "library", title: "The whole library", sub: "Tracks with their names, tags and shapes; playlists; pad boards; campaigns, sessions and scenes; audio settings" },
  { kind: "campaign", title: "One campaign", sub: "Its sessions and scenes, and the playlists, boards and tracks they use", which: "Which campaign" },
  { kind: "session", title: "One session", sub: "Its scenes and cue list, and what they use", which: "Which session" },
  { kind: "scene", title: "One scene", sub: "Its music, ambience and pad boards", which: "Which scene" },
  { kind: "playlist", title: "One playlist", sub: "Its tracks, in order (a dynamic one: its rules and the tracks they match now)", which: "Which playlist" },
  { kind: "board", title: "One pad board", sub: "Its pads, keys and sounds", which: "Which pad board" },
  { kind: "tags", title: "The tags only", sub: "Your tag groups and their values, to tag the same way on another PC" },
];

export interface ScopeOption {
  value: string;
  label: string;
  scope: TransferScope;
}

const sessionWords = (s: { number: number; name: string }) => `Session ${s.number}${s.name ? `: ${s.name}` : ""}`;

/** The choices under one kind of scope (transfer.js options). */
export function scopeOptions(kind: WhatKind, data: { campaigns: readonly CampaignInfo[]; playlists: readonly PlaylistInfo[]; boards: readonly PadBoard[] }): ScopeOption[] {
  switch (kind) {
    case "library":
      return [{ value: "library", label: "The whole library", scope: { kind: "library" } }];
    case "tags":
      return [{ value: "tags", label: "The tags only", scope: { kind: "tags" } }];
    case "campaign":
      return data.campaigns.map((c) => ({ value: c.id, label: c.name, scope: { kind: "campaign", campaignId: c.id } }));
    case "session":
      return data.campaigns.flatMap((c) => c.sessions.map((s) => ({ value: `${c.id}/${s.id}`, label: `${c.name} › ${sessionWords(s)}`, scope: { kind: "session" as const, campaignId: c.id, sessionId: s.id } })));
    case "scene":
      return data.campaigns.flatMap((c) =>
        c.sessions.flatMap((s) => s.scenes.map((sc) => ({ value: `${c.id}/${s.id}/${sc.id}`, label: `${c.name} › Session ${s.number} › ${sc.name || "Untitled scene"}`, scope: { kind: "scene" as const, campaignId: c.id, sessionId: s.id, sceneId: sc.id } }))),
      );
    case "playlist":
      return data.playlists.map((p) => ({ value: p.id, label: p.name, scope: { kind: "playlist", playlistId: p.id } }));
    case "board":
      return data.boards.map((b) => ({ value: b.id, label: b.name, scope: { kind: "board", boardId: b.id } }));
  }
}

/** "45 MB", "40 KB": the size a file manager shows. */
export function sizeWords(bytes: number): string {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The word a kind of incoming item is listed with ("Playlist", "Pad board"). */
export const KIND_WORDS: Record<IncomingItem["kind"], string> = { campaign: "Campaign", playlist: "Playlist", board: "Pad board", tracks: "Tracks", tags: "Tags" };

/** For a duplicate: Skip, Merge or Keep both, with what each does (transfer.js CHOICES). */
export const CHOICES = [
  { value: "skip", label: "Skip", hint: "Keep yours as it is" },
  { value: "merge", label: "Merge", hint: "Add what is new in theirs to yours" },
  { value: "keepBoth", label: "Keep both", hint: "Add theirs as a copy" },
] as const;

/** How sure Lyre is of a found file, in words, and whether it is ticked to relink (transfer.js HOW). */
export function howSure(match: Pick<RelinkMatch, "confidence" | "from" | "to">, missing: Pick<MissingTrack, "sizeBytes"> | undefined): { words: string; warn: boolean; ticked: boolean } {
  const name = (p: string) => p.split(/[\\/]/).pop()?.toLowerCase();
  if (match.confidence === "name") return { words: missing?.sizeBytes != null ? "Same name, different size: check it" : "Same name: check it", warn: true, ticked: false };
  if (match.confidence === "sure" && name(match.from) !== name(match.to)) return { words: "Same file under another name", warn: false, ticked: true };
  return { words: "Same name and size", warn: false, ticked: true };
}
