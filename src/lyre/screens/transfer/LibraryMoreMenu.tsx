/**
 * The ⋯ beside Add tracks in the Library (round 5, transfer.js): Back up, move or share; Find missing files (with how
 * many there are); What came across from Kenku FM; and (round 7) Tags and groups…. Kept here so the Library screen only places it.
 */
import React from "react";

import { useMissingTracks } from "../../api";
import { MenuButton } from "../../kit/Menu";
import { hashOf } from "../../shell/routes";

const go = (route: string) => () => {
  window.location.hash = hashOf(route);
};

/**
 * `onNormalise`: the Library's own "Normalise volume…" (PLY-15), after a separator. `onRemoveShown` (0.5.2 item 50):
 * Remove all shown…, offered while a filter or search narrows the list, with how many it shows.
 */
export function LibraryMoreMenu({ onNormalise, onRemoveShown }: { onNormalise?: () => void; onRemoveShown?: { count: number; remove: () => void } } = {}) {
  const missing = useMissingTracks().data;
  const count = missing?.length ?? 0;
  return (
    <MenuButton
      label="More for the library"
      icon="more"
      items={[
        { label: "Back up, move or share…", icon: "download", onSelect: go("backup") },
        { label: count ? `Find missing files (${count})…` : "Find missing files…", icon: "folder", onSelect: go("relink") },
        { label: "What came across from Kenku FM", icon: "check", onSelect: go("moved") },
        ...(onNormalise ? [{ separator: true as const }, { label: "Normalise volume…", icon: "volume" as const, onSelect: onNormalise }] : []),
        // Round 7 (DAT-10): the tag vocabulary has its own screen.
        { label: "Tags and groups…", icon: "tag", onSelect: go("tags") },
        ...(onRemoveShown ? [{ separator: true as const }, { label: `Remove all shown (${onRemoveShown.count})…`, icon: "close" as const, disabled: onRemoveShown.count === 0, onSelect: onRemoveShown.remove }] : []),
      ]}
    />
  );
}
