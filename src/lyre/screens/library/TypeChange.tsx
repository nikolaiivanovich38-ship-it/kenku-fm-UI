/**
 * 0.5.2 items 4, 12 and 39: a track's Type (Music, Ambience, FX), for one track in its Details or for the selection
 * (the selection's ⋯ › Type). FX tracks are what a pad's sound chooser offers, ambience tracks what a scene's Ambience
 * chooser offers. When the change affects something (a manual playlist of another type lists one; a scene's ambience
 * is one that stops being ambience), a confirmation says what first; otherwise it is done at once. One undo step.
 */
import React, { useCallback, useState } from "react";
import type { TrackKind } from "../../../common/domain";
import type { LibraryTrack } from "../../../common/lyre/api";
import { useCampaigns, useLyreApi, usePlaylists } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { KIND_NAMES, plural, shownTitle } from "./model";
import { useWriteResult } from "./shared";
import type { TrackStore } from "./trackStore";
import { typeChangeEffects } from "./trackUses";

const NONE: never[] = [];
export const TYPES: readonly [TrackKind, string][] = [
  ["music", KIND_NAMES.music],
  ["amb", KIND_NAMES.amb],
  ["fx", KIND_NAMES.fx],
];

type Asking = { tracks: LibraryTrack[]; kind: TrackKind; effects: string[] };

/**
 * `change(tracks, kind)`: changes the type, asking first when it affects something; `dialog` is the confirmation to
 * draw. `offerUndo`: show the Undo note after (the selection; a single track's Details has Ctrl+Z and its chips).
 */
export function useTypeChange(store: TrackStore, { offerUndo }: { offerUndo: boolean }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const playlists = usePlaylists().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;
  const [asking, setAsking] = useState<Asking | null>(null);

  const apply = useCallback(
    async (tracks: LibraryTrack[], kind: TrackKind) => {
      const result = await api.library.setKind(
        tracks.map((t) => t.id),
        kind,
      );
      const done = accept(result);
      if (!done) return;
      for (const t of done) store.put(t);
      const text = `Type: ${KIND_NAMES[kind]}, for ${tracks.length === 1 ? shownTitle(tracks[0]) : plural(tracks.length, "track")}.`;
      say(text);
      if (offerUndo && result.ok) offer(text, result.undoLabel);
    },
    [accept, api, offer, offerUndo, say, store],
  );
  const change = useCallback(
    (tracks: LibraryTrack[], kind: TrackKind) => {
      if (!tracks.some((t) => t.kind !== kind)) return;
      const effects = typeChangeEffects(tracks, kind, { playlists, campaigns });
      if (effects.length) setAsking({ tracks, kind, effects });
      else void apply(tracks, kind);
    },
    [apply, campaigns, playlists],
  );
  const dialog = asking && (
    <Dialog
      open
      title={`Make ${asking.tracks.length === 1 ? `“${shownTitle(asking.tracks[0])}”` : plural(asking.tracks.length, "track")} ${KIND_NAMES[asking.kind]}?`}
      onClose={() => setAsking(null)}
      footer={
        <>
          <Button onClick={() => setAsking(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const a = asking;
              setAsking(null);
              void apply(a.tracks, a.kind);
            }}
          >
            Make {KIND_NAMES[asking.kind]}
          </Button>
        </>
      }
    >
      <p>This changes where {asking.tracks.length === 1 ? "it is" : "they are"} offered:</p>
      <ul className="lb-effects">
        {asking.effects.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="hint">
        {asking.kind === "fx" ? "FX tracks are offered for pads." : asking.kind === "amb" ? "Ambience tracks are offered as a scene's ambience." : "Music tracks are offered for a scene's music."}
      </p>
    </Dialog>
  );
  return { change, dialog };
}
