/**
 * Round 9 (ROUND9.md §3, r9track.js L.r9UseFor and L.r9AtEnd): Use it for and At its end in a track's details, in
 * place of round 7's Role, Looping, Ending and Then (item 18: "Need to be have more intuitive roles than we currently
 * do"). Choosing a use picks its usual end until the game master picks one himself (trackEnd.ts endIsUsual); At its
 * end › Play… opens the picker (PlayAfterPicker). Under them: Next time, start where it stopped (music but a short
 * cue) and one summary line. Each change is one write, with the Saved pop-up.
 */
import React, { useState } from "react";
import { roleChoices } from "../../../common/domain/round7";
import type { SoundRef } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo, TrackPatch } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useLyreApi, useTracks } from "../../api";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { PickUpSwitch, pickUpWords } from "./PickUpSwitch";
import { useSave } from "../../shell/useSave";
import type { TrackStore } from "./trackStore";
import { ENDS, endIsUsual, endOf, endWords, endWrite, usesFor, usualEnd, useEndSummary, USE_WORDS, type TrackEnd } from "./trackEnd";
import { PlayAfterPicker } from "./PlayAfterPicker";

/** The name of what a track plays after it: a playlist's name or a track's title. */
export function followNameOf(ref: SoundRef | null | undefined, playlists: readonly PlaylistInfo[], tracks: readonly LibraryTrack[]): string {
  if (!ref) return "nothing";
  if (ref.kind === "playlist") return playlists.find((p) => p.id === ref.id)?.name ?? "a playlist";
  const other = tracks.find((x) => x.id === ref.id);
  return other ? shownTitle(other) : "a track";
}

/** The patch an end writes at the track's own place, with the profile in the same undo step. */
export function endPatch(t: LibraryTrack, end: TrackEnd, follow: SoundRef | null = null): TrackPatch {
  const w = endWrite(end, t.profile, follow);
  return { ...w.track, profile: w.profile };
}

export function TrackBehaviour({ t, playlists, store }: { t: LibraryTrack; playlists: readonly PlaylistInfo[]; store: TrackStore }) {
  const api = useLyreApi();
  const save = useSave();
  const tracks = useTracks().data ?? [];
  const [choosing, setChoosing] = useState(false);
  // The switch shows the choice at once; the library's answer then takes over (a refusal puts it back).
  const [resume, setResume] = useState<boolean | null>(null);
  const resumeOn = resume ?? t.resume;
  const title = shownTitle(t);
  const resumeShown = roleChoices(t).includes("resume");
  const name = (ref: SoundRef | null | undefined) => followNameOf(ref, playlists, tracks);
  const write = async (patch: TrackPatch, what: (after: LibraryTrack) => string) => {
    // The words name the track as it is after the write ("… at its end: fades out").
    const after = { ...t, ...patch } as LibraryTrack;
    const done = await save(what(after), () => api.library.updateTrack(t.id, patch));
    if (done) store.put(done.value);
    setResume(null);
    return done;
  };

  const end = endOf(t);
  const shortCue = t.role === "sting";
  const ends = ENDS.filter(([e]) => !(shortCue && (e === "loop" || e === "xloop")));

  return (
    <>
      <div className="lb-tg">
        <div className="lb-tgl" id={`lb-use-l-${t.id}`}>
          Use it for
        </div>
        <div className="chips r9-use" role="group" aria-labelledby={`lb-use-l-${t.id}`}>
          {usesFor(t).map((u) => {
            const on = t.role === u.role;
            return (
              <button
                key={u.role}
                type="button"
                className="chip lb-pick r9-usechip"
                aria-pressed={on}
                aria-describedby={`lb-use-d-${u.role}`}
                title={u.line}
                onClick={() => {
                  const role = on ? null : u.role;
                  const patch: TrackPatch = { role };
                  // Until the game master picks an end, a use brings its usual end (Background: Loop with a crossfade…).
                  if (role && endIsUsual(t)) Object.assign(patch, endPatch(t, usualEnd({ role, kind: t.kind })));
                  void write(patch, () => `${title}: ${role ? USE_WORDS[role] : "no use chosen"}`);
                }}
              >
                <Icon name={on ? "check" : u.icon} size="s" />
                {u.word}
                <span className="sr-only" id={`lb-use-d-${u.role}`}>
                  {u.line}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="lb-tg">
        <div className="lb-tgl" id={`lb-end-l-${t.id}`}>
          At its end
        </div>
        <div className="chips r9-end" role="group" aria-labelledby={`lb-end-l-${t.id}`}>
          {ends.map(([e, word]) => {
            if (e === "follow" && t.follow) {
              return (
                <React.Fragment key={e}>
                  <span className="chip r9-follow-on">
                    <Icon name="check" size="s" />
                    <span>Play: {name(t.follow)}</span>
                    <button
                      type="button"
                      className="x"
                      title="Remove"
                      aria-label={`Stop playing ${name(t.follow)} after it`}
                      onClick={() => void write(endPatch(t, "next"), () => `${title} plays nothing after it`)}
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                  <Button size="s" className="ghost" onClick={() => setChoosing(true)}>
                    Change…
                  </Button>
                </React.Fragment>
              );
            }
            const on = end === e;
            return (
              <button
                key={e}
                type="button"
                className="chip lb-pick"
                aria-pressed={on}
                title={e === "follow" ? "When it ends, play a playlist or a track" : undefined}
                onClick={() => {
                  if (e === "follow") return setChoosing(true);
                  void write(endPatch(t, e), (after) => `${title} at its end: ${endWords(after, "")}`);
                }}
              >
                {on && <Icon name="check" size="s" />}
                {word}
              </button>
            );
          })}
        </div>
      </div>
      {resumeShown && (
        <PickUpSwitch
          checked={resumeOn}
          onChange={(next) => {
            setResume(next);
            void write({ resume: next }, () => pickUpWords(t, next));
          }}
        />
      )}
      <p className="r9-sum">
        <Icon name="fade" size="s" />
        <span>{useEndSummary(t, name(t.follow), resumeShown)}</span>
      </p>
      {choosing && (
        <PlayAfterPicker
          track={t}
          tracks={tracks}
          playlists={playlists}
          onClose={() => setChoosing(false)}
          onDone={(ref) => {
            setChoosing(false);
            if (ref) void write(endPatch(t, "follow", ref), () => `${title} then plays ${name(ref)}`);
            else if (t.follow) void write(endPatch(t, "next"), () => `${title} plays nothing after it`);
          }}
        />
      )}
    </>
  );
}
