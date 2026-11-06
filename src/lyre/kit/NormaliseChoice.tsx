/**
 * PLY-15, DAT-15 volume normalisation on screen (design/prototype/ROUND5.md "Volume normalisation"; core.js
 * L.normChoice and L.acts.normopen):
 *
 * - NormaliseChoice: "Normalise volume" with Library setting / On / Off and the measured line under it (what Lyre
 *   measured and the gain it gets there, from normaliseLine or playlistNormaliseLine in src/common/domain); where
 *   the choice comes from is on hover over the line. The line describes the group, so a screen reader hears it.
 * - NormaliseDialog: the library's setting (Library › ⋯ › Normalise volume…): on or off and the target level, with
 *   what they do on hover, and how many tracks are measured.
 *
 * Nik (6 Nov): as few words as the design allows; details on hover, no explanatory lines. Lyre never changes the
 * files: the level is evened out as Lyre plays them.
 *
 * Placed by the prep screens (see the w4-normalise report): a track's details (How it plays), a playlist's Details,
 * the Audio profile's header, and the dialog from the Library's ⋯ menu.
 */
import React, { useEffect, useId, useState } from "react";

import {
  libraryNormaliseWords,
  NORMALISE_TARGET_LUFS,
  NORMALISE_TARGET_WORDS,
  NORMALISE_TARGETS,
  normaliseDecision,
  type LibraryNormalise,
  type NormaliseChoice as Choice,
  type NormaliseTarget,
  type NormalisedTrack,
} from "../../common/domain";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { cx } from "./cx";

const CHOICES: { value: Choice | null; label: string }[] = [
  { value: null, label: "Library setting" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export interface NormaliseChoiceProps {
  /** The track's or playlist's own choice; null is "Library setting". */
  value: Choice | null;
  onChange: (value: Choice | null) => void;
  /** The library's setting, for the Library setting button's hover. */
  library: LibraryNormalise;
  /** What Lyre measured and the gain there: normaliseLine (a track) or playlistNormaliseLine (a playlist). */
  line: string;
  /** Where the choice comes from, on hover over the line: trackNormaliseHint, playlistNormaliseHint or profileNormaliseHint. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function NormaliseChoice({ value, onChange, library, line, hint, disabled, className }: NormaliseChoiceProps) {
  const labelId = useId();
  const lineId = useId();
  const hintId = useId();
  return (
    <div className={cx("norm", className)}>
      <span className="norm-l" id={labelId}>
        Normalise volume
      </span>
      <div className="norm-box">
        <div className="seg s" role="group" aria-labelledby={labelId} aria-describedby={lineId}>
          {CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              aria-pressed={value === choice.value}
              title={choice.value === null ? `The library's setting: ${libraryNormaliseWords(library)}` : undefined}
              // The hover text, also for keyboard and screen-reader users (round 6: nothing on hover only).
              aria-describedby={hint ? hintId : undefined}
              disabled={disabled}
              onClick={() => onChange(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {/* Nik, 6 Nov: as few words as the design allows; where the choice comes from is on hover. */}
        <p className="norm-line num" id={lineId} title={hint}>
          {line}
        </p>
        {hint && (
          <span className="sr-only" id={hintId}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

/** A track's details (Library › How it plays): its true peak, and whose choice applies. */
export function trackNormaliseHint(track: NormalisedTrack, library: LibraryNormalise): string {
  const peak = track.loudness ? `True peak ${track.loudness.truePeakDb.toFixed(1)} dBTP. ` : "";
  return (
    peak +
    (track.normalise ? "This track's own choice, wherever it plays." : `Follows the library (${libraryNormaliseWords(library)}), or the playlist it plays from when that has its own choice.`)
  );
}

/** A playlist's Details. */
export function playlistNormaliseHint(playlist: { normalise?: Choice | null }, library: LibraryNormalise): string {
  return playlist.normalise ? "A track's own choice still comes first." : `Follows the library (${libraryNormaliseWords(library)}). A track's own choice comes first.`;
}

/** The Audio profile's header: where these settings apply (a playlist, or the track on its own) and whose choice counts. */
export function profileNormaliseHint(track: { normalise?: Choice | null }, playlist: { name: string; normalise?: Choice | null } | null, library: LibraryNormalise): string {
  const decision = normaliseDecision(track.normalise, playlist?.normalise, library);
  const from =
    decision.from === "track" ? "this track's own choice" : decision.from === "playlist" ? `the playlist's choice (${decision.on ? "On" : "Off"})` : `the library's setting (${libraryNormaliseWords(library)})`;
  return `${playlist ? `In the playlist ${playlist.name}: ` : "On its own: "}${from}.`;
}

/** On hover over the switch: what normalising does, and which choice wins (no explanatory lines on screen). */
const WHAT_IT_DOES =
  "Lyre measures how loud each track is and turns it up or down to one level. It adds at most 12 dB and keeps peaks under -1 dBTP. A track's own choice comes first, then its playlist's, then this one.";

const TARGET_HINTS: Record<NormaliseTarget, string> = {
  quiet: "The broadcast level. The most room for loud moments.",
  standard: "Lyre's default. Music sits well under voices.",
  loud: "The level of music streaming services.",
};

export interface NormaliseDialogProps {
  open: boolean;
  /** The library's setting now (LyreApi library.normaliseSettings). */
  setting: LibraryNormalise;
  /** Tracks measured so far, of all tracks (LibraryTrack.loudness). */
  measured: number;
  total: number;
  /** Save: library.setNormaliseSettings; the screen closes the dialog when it is saved. */
  onSave: (setting: LibraryNormalise) => void;
  onClose: () => void;
}

export function NormaliseDialog({ open, setting, measured, total, onSave, onClose }: NormaliseDialogProps) {
  const [on, setOn] = useState(setting.on);
  const [target, setTarget] = useState<NormaliseTarget>(setting.target);
  const name = useId();
  const whatId = useId();
  const statusId = useId();
  // Each time it opens it starts from the library's setting as it is.
  useEffect(() => {
    if (open) {
      setOn(setting.on);
      setTarget(setting.target);
    }
  }, [open, setting.on, setting.target]);

  return (
    <Dialog
      open={open}
      title="Normalise volume"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({ on, target })}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack norm-sheet">
        <label className="norm-on" title={WHAT_IT_DOES}>
          <input type="checkbox" checked={on} aria-describedby={whatId} onChange={(event) => setOn(event.target.checked)} />
          Normalise volume for the whole library
        </label>
        <span className="sr-only" id={whatId}>
          {WHAT_IT_DOES}
        </span>
        <fieldset className="norm-targets">
          <legend>Target level</legend>
          {NORMALISE_TARGETS.map((value) => (
            <label key={value} className="norm-opt" title={TARGET_HINTS[value]}>
              <input type="radio" name={name} value={value} checked={target === value} aria-describedby={`${statusId}-${value}`} onChange={() => setTarget(value)} />
              <span>
                {NORMALISE_TARGET_WORDS[value]} ({NORMALISE_TARGET_LUFS[value]} LUFS)
              </span>
            </label>
          ))}
        </fieldset>
        {NORMALISE_TARGETS.map((value) => (
          <span key={value} className="sr-only" id={`${statusId}-${value}`}>
            {TARGET_HINTS[value]}
          </span>
        ))}
        <p className="hint" role="status" title={measured < total ? "The rest are measured in the background; until then they play as they are." : undefined}>
          {measured} of {total} tracks measured
          {measured < total && <span className="sr-only">. The rest are measured in the background; until then they play as they are.</span>}
        </p>
      </div>
    </Dialog>
  );
}
