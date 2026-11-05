/**
 * "Use in…" for a playlist (_shared.js L.assignSheet): tick a campaign to have it all campaign long, a session for
 * that evening, or a scene to play it there. Save makes exactly the ticked places use it. Every campaign is listed,
 * folded, except the campaign in hand and those where it is used already.
 */
import React from "react";
import type { SoundRef } from "../../../common/domain";
import type { CampaignInfo, PlaylistInfo, UsePlace } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { PickerDialog, type PickerItem } from "../../kit/Picker";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { useWriteOk } from "./shared";

export interface UseInDialogProps {
  playlist: PlaylistInfo | undefined;
  campaigns: CampaignInfo[];
  /** The name of a scene's ambience now (a track's title or a playlist's name), for "(replaces …)". */
  nameOf: (ref: SoundRef) => string;
  onClose: () => void;
}

export function UseInDialog({ playlist, campaigns, nameOf, onClose }: UseInDialogProps) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const ok = useWriteOk();
  const inHand = useCampaignInHand();
  if (!playlist) return null;
  const id = playlist.id;
  const isAmb = playlist.lane === "amb";
  const items: PickerItem[] = [];
  const selected: string[] = [];
  const places = new Map<string, UsePlace>();
  for (const c of campaigns) {
    const cKey = `c:${c.id}`;
    items.push({ id: cKey, label: `${c.name}: whole campaign`, sub: "Available in every session", group: c.name, groupId: c.id });
    places.set(cKey, { campaignId: c.id });
    if (c.playlistIds.includes(id)) selected.push(cKey);
    for (const s of c.sessions) {
      const sKey = `s:${c.id}:${s.id}`;
      items.push({ id: sKey, label: `Session ${s.number}: ${s.name}`, sub: "Available in every scene of this session", group: c.name, groupId: c.id });
      places.set(sKey, { campaignId: c.id, sessionId: s.id });
      if (s.playlistIds.includes(id)) selected.push(sKey);
      for (const sc of s.scenes) {
        const xKey = `x:${c.id}:${s.id}:${sc.id}`;
        const current = isAmb && sc.ambience && sc.ambience.id !== id ? sc.ambience : null;
        const replaces = current ? ` (replaces ${nameOf(current)})` : "";
        items.push({
          id: xKey,
          label: `Scene: ${sc.name}`,
          indent: true,
          group: c.name, groupId: c.id,
          sub: `Session ${s.number} · ${isAmb ? "ambience for this scene" : "music for this scene"}${replaces}`,
        });
        places.set(xKey, { campaignId: c.id, sessionId: s.id, sceneId: sc.id });
        const uses = sc.music.some((r) => r.kind === "playlist" && r.id === id) || (sc.ambience?.kind === "playlist" && sc.ambience.id === id);
        if (uses) selected.push(xKey);
      }
    }
  }
  return (
    <PickerDialog
      open
      title={`Use "${playlist.name}" in…`}
      intro="Tick a campaign to make it available all campaign long, a session for that evening, or a scene to play it in that scene."
      items={items}
      selected={selected}
      okLabel="Save"
      fold
      openGroups={inHand ? [inHand] : []}
      onClose={onClose}
      onDone={async (ids) => {
        onClose();
        const chosen = ids.map((k) => places.get(k)).filter((p): p is UsePlace => !!p);
        if (ok(await api.campaigns.setUses({ kind: "playlist", id }, chosen))) toast(`Saved where "${playlist.name}" is used`);
      }}
    />
  );
}
