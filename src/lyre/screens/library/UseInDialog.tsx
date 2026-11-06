/**
 * "Use in…" for a playlist or a track (_shared.js L.assignSheet; ORG-12 for tracks): tick a campaign to have it all
 * campaign long, a session for that evening, or a scene to play it there (an ambience track or playlist becomes the
 * scene's ambience). Save makes exactly the ticked places use it. Every campaign is listed, folded, except the
 * campaign in hand (else the first, as the prototype starts with one in hand) and those where it is used already.
 */
import React from "react";
import type { SoundRef } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PlaylistInfo, UsePlace } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { PickerDialog, type PickerItem } from "../../kit/Picker";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { shownTitle } from "./model";
import { useWriteOk } from "./shared";

export interface UseInDialogProps {
  /** The playlist to place; or `track`. */
  playlist?: PlaylistInfo;
  /** ORG-12: the track to place (kept on hand in a campaign or session, or in a scene's music or ambience). */
  track?: LibraryTrack;
  campaigns: CampaignInfo[];
  /** The name of a scene's ambience now (a track's title or a playlist's name), for "(replaces …)". */
  nameOf: (ref: SoundRef) => string;
  onClose: () => void;
}

export function UseInDialog({ playlist, track, campaigns, nameOf, onClose }: UseInDialogProps) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const ok = useWriteOk();
  const inHand = useCampaignInHand();
  const target = track ? ({ kind: "track", id: track.id } as const) : playlist ? ({ kind: "playlist", id: playlist.id } as const) : null;
  if (!target) return null;
  const id = target.id;
  const name = track ? shownTitle(track) : (playlist?.name ?? "");
  const isAmb = track ? track.kind === "amb" : playlist?.lane === "amb";
  const onHand = (list: { playlistIds: string[]; trackIds: string[] }) => (target.kind === "track" ? list.trackIds : list.playlistIds).includes(id);
  const items: PickerItem[] = [];
  const selected: string[] = [];
  const places = new Map<string, UsePlace>();
  for (const c of campaigns) {
    const cKey = `c:${c.id}`;
    items.push({ id: cKey, label: `${c.name}: whole campaign`, sub: "Available in every session", group: c.name, groupId: c.id });
    places.set(cKey, { campaignId: c.id });
    if (onHand(c)) selected.push(cKey);
    for (const s of c.sessions) {
      const sKey = `s:${c.id}:${s.id}`;
      items.push({ id: sKey, label: `Session ${s.number}: ${s.name}`, sub: "Available in every scene of this session", group: c.name, groupId: c.id });
      places.set(sKey, { campaignId: c.id, sessionId: s.id });
      if (onHand(s)) selected.push(sKey);
      for (const sc of s.scenes) {
        const xKey = `x:${c.id}:${s.id}:${sc.id}`;
        const current = isAmb && sc.ambience && sc.ambience.id !== id ? sc.ambience : null;
        const replaces = current ? ` (replaces ${nameOf(current)})` : "";
        items.push({
          id: xKey,
          label: `Scene: ${sc.name}`,
          indent: true,
          group: c.name,
          groupId: c.id,
          sub: `Session ${s.number} · ${isAmb ? "ambience for this scene" : "music for this scene"}${replaces}`,
        });
        places.set(xKey, { campaignId: c.id, sessionId: s.id, sceneId: sc.id });
        const uses = sc.music.some((r) => r.kind === target.kind && r.id === id) || (sc.ambience?.kind === target.kind && sc.ambience.id === id);
        if (uses) selected.push(xKey);
      }
    }
  }
  return (
    <PickerDialog
      open
      title={`Use "${name}" in…`}
      intro="Tick a campaign to make it available all campaign long, a session for that evening, or a scene to play it in that scene."
      items={items}
      selected={selected}
      okLabel="Save"
      fold
      openGroups={[inHand ?? campaigns[0]?.id].filter((x): x is string => !!x)}
      onClose={onClose}
      onDone={async (ids) => {
        onClose();
        const chosen = ids.map((k) => places.get(k)).filter((p): p is UsePlace => !!p);
        if (ok(await api.campaigns.setUses(target, chosen))) toast(`Saved where "${name}" is used`);
      }}
    />
  );
}
