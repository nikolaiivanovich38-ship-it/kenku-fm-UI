/**
 * PLY-4 and SHW-3 (design round 7, r7play.js L.playRows): how a track behaves as its role says, in the Library's
 * How it plays. Only the choices that fit the role show (less to read): an Underscore has Ending (Fades out), Pick up
 * where it stopped and Then (Follow with…); a Loop bed has Pick up; a Sting has Then; a Transition has Ending and
 * Then; a track with no role yet has none (roleChoices). Each change is saved with the track, with the Saved pop-up.
 */
import React, { useEffect, useState } from "react";
import { roleChoices } from "../../../common/domain/round7";
import type { SoundRef } from "../../../common/domain";
import type { LibraryTrack, PlaylistInfo } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useLyreApi, useTracks } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { useSave } from "../../shell/useSave";
import type { TrackStore } from "./trackStore";

type Patch = Partial<Pick<LibraryTrack, "fadesOut" | "resume" | "follow">>;

/** A follow-with choice as the dialog's select keeps it: "playlist:p-crypt" or "track:t04". */
const refKey = (ref: SoundRef) => `${ref.kind}:${ref.id}`;
function refOf(key: string): SoundRef | null {
  const [kind, id] = key.split(":");
  return (kind === "playlist" || kind === "track") && id ? { kind, id } : null;
}

export function TrackBehaviour({ t, playlists, store }: { t: LibraryTrack; playlists: readonly PlaylistInfo[]; store: TrackStore }) {
  const api = useLyreApi();
  const save = useSave();
  const tracks = useTracks().data ?? [];
  const [choosing, setChoosing] = useState(false);
  // The switch and the chip show the choice at once; the library's answer then takes over (a refusal puts it back).
  const [resume, setResume] = useState<boolean | null>(null);
  const [fadesOut, setFadesOut] = useState<boolean | null>(null);
  useEffect(() => setResume(null), [t.resume]);
  useEffect(() => setFadesOut(null), [t.fadesOut]);
  const resumeOn = resume ?? t.resume;
  const fadesOn = fadesOut ?? t.fadesOut;
  const choices = roleChoices(t);
  const title = shownTitle(t);
  const write = async (patch: Patch, what: string) => {
    const done = await save(what, () => api.library.updateTrack(t.id, patch));
    if (done) store.put(done.value);
    else {
      setResume(null);
      setFadesOut(null);
    }
  };
  const followName = (ref: SoundRef | null): string => {
    if (!ref) return "nothing";
    if (ref.kind === "playlist") return playlists.find((p) => p.id === ref.id)?.name ?? "a playlist";
    const other = tracks.find((x) => x.id === ref.id);
    return other ? shownTitle(other) : "a track";
  };
  if (!choices.length) return null;

  return (
    <>
      {choices.includes("ending") && (
        <div className="lb-tg">
          <div className="lb-tgl">Ending</div>
          <div className="chips" role="group" aria-label="Ending">
            {/* One chip: pressed, it fades out before its end; not pressed (the usual), it plays to its last second. */}
            <button
              type="button"
              className="chip lb-pick"
              aria-pressed={fadesOn}
              title="Lyre fades it out before its end (the length is in the Audio profile); not pressed, it plays to its last second"
              onClick={() => {
                setFadesOut(!fadesOn);
                void write({ fadesOut: !fadesOn }, `${title} ending: ${fadesOn ? "hard end" : "fades out"}`);
              }}
            >
              {fadesOn && <Icon name="check" size="s" />}
              Fades out
            </button>
          </div>
        </div>
      )}
      {choices.includes("resume") && (
        <div className="lb-tg">
          <label className="lv-switch lb-resume" title="A long underscore or bed starts again where it was last stopped">
            <input
              type="checkbox"
              role="switch"
              checked={resumeOn}
              onChange={(e) => {
                setResume(e.target.checked);
                void write({ resume: e.target.checked }, `${title} ${e.target.checked ? "picks up where it stopped" : "starts from the top"}`);
              }}
            />
            <span className="lv-switch-t">
              <b>Pick up where it stopped</b>
            </span>
          </label>
        </div>
      )}
      {choices.includes("follow") && (
        <div className="lb-tg">
          <div className="lb-tgl" id="lb-then-l">
            Then
          </div>
          <div className="chips" role="group" aria-labelledby="lb-then-l">
            {t.follow ? (
              <>
                <span className="chip">
                  <span className="lane-dot music" aria-hidden="true" />
                  {followName(t.follow)}
                  <button
                    type="button"
                    className="x"
                    title="Remove"
                    aria-label={`Stop following with ${followName(t.follow)}`}
                    onClick={() => void write({ follow: null }, `${title} follows with nothing`)}
                  >
                    <Icon name="close" />
                  </button>
                </span>
                <Button size="s" className="ghost" onClick={() => setChoosing(true)}>
                  Change…
                </Button>
              </>
            ) : (
              <Button size="s" className="ghost" icon="next" title="When it ends, play a playlist or a track" onClick={() => setChoosing(true)}>
                Follow with…
              </Button>
            )}
          </div>
        </div>
      )}
      {choosing && (
        <FollowDialog
          t={t}
          playlists={playlists}
          tracks={tracks}
          onClose={() => setChoosing(false)}
          onDone={(ref) => {
            setChoosing(false);
            void write({ follow: ref }, `${title} follows with ${followName(ref)}`);
          }}
        />
      )}
    </>
  );
}

/** Follow with…: a music playlist or another music track that plays when this one ends (unless something waits). */
function FollowDialog({
  t,
  playlists,
  tracks,
  onClose,
  onDone,
}: {
  t: LibraryTrack;
  playlists: readonly PlaylistInfo[];
  tracks: readonly LibraryTrack[];
  onClose: () => void;
  onDone: (ref: SoundRef) => void;
}) {
  const options: [string, string][] = [
    ...playlists.filter((p) => p.lane === "music").map((p): [string, string] => [refKey({ kind: "playlist", id: p.id }), `${p.name} (playlist)`]),
    ...tracks.filter((x) => x.kind === "music" && x.id !== t.id).map((x): [string, string] => [refKey({ kind: "track", id: x.id }), shownTitle(x)]),
  ];
  const [value, setValue] = useState(t.follow ? refKey(t.follow) : (options[0]?.[0] ?? ""));
  return (
    <Dialog
      open
      title={`Follow ${shownTitle(t)} with`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const ref = refOf(value);
              if (ref) onDone(ref);
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="lb-follow">When it ends, play</label>
        <select className="input" id="lb-follow" value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">Unless something is waiting in Play next.</p>
    </Dialog>
  );
}
