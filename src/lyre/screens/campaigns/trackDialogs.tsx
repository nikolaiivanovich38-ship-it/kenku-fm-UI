/**
 * The session planner's sheets for one track (views/campaigns.js cpname; _shared.js L.assignSheet with kind "track"):
 * Name in this scene… (DAT-14) and Use in… (ORG-12).
 */
import React, { useState } from "react";

import { isRefused, type LibraryTrack, type SceneAddress, type SceneInfo, type UsePlace } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useCampaigns, useLyreApi } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { PickerDialog, type PickerItem } from "../../kit/Picker";
import { useAnnounce } from "../../shell/Announcer";
import { useCampaignInHand } from "../../shell/CampaignInHand";
import { soundInfo, type LibraryIndex } from "./model";

/**
 * DAT-14: a name for a track in one scene only ("Strahd's entrance"); empty uses its own name. `onClose` gets the
 * name saved ("" for its own name), or null when nothing was saved.
 */
export function NameInSceneDialog({ scene, address, track, onClose }: { scene: SceneInfo; address: SceneAddress; track: LibraryTrack; onClose: (saved: string | null) => void }) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const [name, setName] = useState(scene.trackNames[track.id] ?? "");
  const own = shownTitle(track);
  const save = async () => {
    const value = name.trim();
    const result = await api.sessions.setTrackName(address, track.id, value);
    if (isRefused(result)) {
      toast(result.refusal.message);
      return;
    }
    onClose(value);
  };
  return (
    <Dialog
      open
      title="Name in this scene"
      onClose={() => onClose(null)}
      footer={
        <>
          <Button onClick={() => onClose(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cp-nmin">Name in &quot;{scene.name}&quot;</label>
        <input
          className="input"
          id="cp-nmin"
          value={name}
          placeholder={own}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void save();
          }}
        />
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Shown in this scene, in Live and in the Now playing bar. Everywhere else it keeps its own name: <b>{own}</b>. Leave it empty to use its own name here too.
      </p>
    </Dialog>
  );
}

/**
 * ORG-12 "Use in…" for a track: a campaign keeps it on hand all campaign long, a session for that evening, and a scene
 * plays it in its music (an ambience track becomes the scene's ambience). Save makes exactly the ticked places use it.
 */
export function TrackUseInDialog({ track, index, onClose }: { track: LibraryTrack; index: LibraryIndex; onClose: () => void }) {
  const api = useLyreApi();
  const { toast } = useAnnounce();
  const inHand = useCampaignInHand();
  const campaigns = useCampaigns().data;
  const name = shownTitle(track);
  // The ticks are worked out once, when the sheet opens, so it waits for the campaigns.
  if (!campaigns) return null;
  const isAmb = track.kind === "amb";
  const items: PickerItem[] = [];
  const selected: string[] = [];
  const places = new Map<string, UsePlace>();
  for (const c of campaigns) {
    const cKey = `c:${c.id}`;
    items.push({ id: cKey, label: `${c.name}: whole campaign`, sub: "Available in every session", group: c.name, groupId: c.id });
    places.set(cKey, { campaignId: c.id });
    if (c.trackIds.includes(track.id)) selected.push(cKey);
    for (const s of c.sessions) {
      const sKey = `s:${c.id}:${s.id}`;
      items.push({ id: sKey, label: `Session ${s.number}: ${s.name}`, sub: "Available in every scene of this session", group: c.name, groupId: c.id });
      places.set(sKey, { campaignId: c.id, sessionId: s.id });
      if (s.trackIds.includes(track.id)) selected.push(sKey);
      for (const sc of s.scenes) {
        const xKey = `x:${c.id}:${s.id}:${sc.id}`;
        const current = isAmb && sc.ambience && sc.ambience.id !== track.id ? soundInfo(sc.ambience, index)?.name : undefined;
        items.push({
          id: xKey,
          label: `Scene: ${sc.name}`,
          indent: true,
          group: c.name,
          groupId: c.id,
          sub: `Session ${s.number} · ${isAmb ? "ambience for this scene" : "music for this scene"}${current ? ` (replaces ${current})` : ""}`,
        });
        places.set(xKey, { campaignId: c.id, sessionId: s.id, sceneId: sc.id });
        if (sc.music.some((r) => r.kind === "track" && r.id === track.id) || (sc.ambience?.kind === "track" && sc.ambience.id === track.id)) selected.push(xKey);
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
      openGroups={inHand ? [inHand] : []}
      onClose={onClose}
      onDone={async (ids) => {
        onClose();
        const chosen = ids.map((k) => places.get(k)).filter((p): p is UsePlace => !!p);
        const result = await api.campaigns.setUses({ kind: "track", id: track.id }, chosen);
        toast(isRefused(result) ? result.refusal.message : `Saved where "${name}" is used`);
      }}
    />
  );
}
