/**
 * "Pick up where it stopped" (PLY-4): the track starts again where it was last stopped. One switch, shown in the
 * Library's How it plays (TrackBehaviour) and, since 0.5.1, in the Audio profile's At the end (Nik, 11 Nov: "I don't
 * see pickup where it stops in details or audio profile views"). It belongs to the track wherever it plays.
 */
import React, { useEffect, useState } from "react";

import { roleChoices } from "../../../common/domain/round7";
import type { LibraryTrack } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useLyreApi } from "../../api";
import { useSave } from "../../shell/useSave";

/** The switch itself; the caller keeps the choice. */
export function PickUpSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="lb-tg">
      <label className="lv-switch lb-resume" title="A long underscore or bed starts again where it was last stopped">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="lv-switch-t">
          <b>Pick up where it stopped</b>
        </span>
      </label>
    </div>
  );
}

/** The Saved pop-up's words for a change of the switch. */
export const pickUpWords = (t: LibraryTrack, on: boolean) => `${shownTitle(t)} ${on ? "picks up where it stopped" : "starts from the top"}`;

/** The switch for a track, saving each change with the Saved pop-up; nothing for a track it does not fit (roleChoices). */
export function TrackPickUp({ track }: { track: LibraryTrack }) {
  const api = useLyreApi();
  const save = useSave();
  // The switch shows the choice at once; the library's answer then takes over (a refusal puts it back).
  const [chosen, setChosen] = useState<boolean | null>(null);
  useEffect(() => setChosen(null), [track.resume]);
  if (!roleChoices(track).includes("resume")) return null;
  return (
    <PickUpSwitch
      checked={chosen ?? track.resume}
      onChange={(next) => {
        setChosen(next);
        void save(pickUpWords(track, next), () => api.library.updateTrack(track.id, { resume: next })).then((done) => {
          if (!done) setChosen(null);
        });
      }}
    />
  );
}
