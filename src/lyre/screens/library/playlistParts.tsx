/** Small pieces both Playlists screens use: kind words, the kind-and-lane line, drop actions. */
import React, { useMemo } from "react";
import type { PlaylistInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import type { SoundRef } from "../../../common/domain";
import { KIND_NAMES, shownTitle } from "./model";
import type { PlaylistData } from "./playlistData";
import type { DropActions } from "./playlistDrops";

/** Playlists made from the New playlist menu: their page opens with the name ready to type. */
export const newlyMade = new Set<string>();

export const KIND_WORDS = { manual: { name: "Manual", icon: "hand" as const }, dynamic: { name: "Dynamic", icon: "tag" as const } };

/** Kind and lane as quiet text: an icon for Manual or Dynamic and a small lane dot (playlists.js kindLane). */
export function KindLane({ pl }: { pl: PlaylistInfo }) {
  const k = KIND_WORDS[pl.kind];
  return (
    <span className="pl-kl">
      <Icon name={k.icon} size="s" />
      {k.name}
      <span className="sep">·</span>
      <span className={`lane-dot ${pl.lane}`} />
      {KIND_NAMES[pl.lane]}
    </span>
  );
}

/** Every word must be in the text (lower case). */
export const matchesQuery = (text: string, q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));

export function useDropActions(data: PlaylistData): DropActions {
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  return useMemo(() => ({ api, store: data.store, say, toast }), [api, data.store, say, toast]);
}


/** A scene item's name: a track's title or a playlist's name. */
export function soundName(data: PlaylistData) {
  return (ref: SoundRef): string => {
    if (ref.kind === "playlist") return data.playlists.find((p) => p.id === ref.id)?.name ?? "a playlist";
    const t = data.byId.get(ref.id);
    return t ? shownTitle(t) : "a track";
  };
}
