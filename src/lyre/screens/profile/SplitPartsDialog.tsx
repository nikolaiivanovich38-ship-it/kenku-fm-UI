/**
 * Round 9 (ROUND9.md §10, item 8) and Nik's answer of 18 Nov (Q11 a: "play part of same file"): Markers › Split into
 * parts…. The split points (each marker inside the track, each can be unticked), the parts with their names, from–to,
 * length and Preview, and two choices: copy its tags, Type and Use it for to each part (on), add the parts beside it in
 * its manual playlists (off). Make n tracks makes tracks that play their part of the same file; the file is never
 * changed and the whole track stays. Undo at the bottom of the screen removes the parts again. r9track.js §10.
 */
import React, { useState } from "react";
import { resolveProfile } from "../../../common/domain";
import type { LibraryTrack } from "../../../common/lyre/api";
import { lengthText, plural, shownTitle } from "../../../common/lyre/text";
import { useLyreApi } from "../../api";
import { useLyreAudio } from "../../audio";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { useSave } from "../../shell/useSave";
import { partsOf, splitPoints } from "./splitParts";

export function SplitPartsDialog({ track, markers, onClose }: { track: LibraryTrack; markers: readonly { atMs: number; label: string }[]; onClose: () => void }) {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const save = useSave();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const dur = track.durationMs;
  const title = shownTitle(track);
  const [points, setPoints] = useState(() => splitPoints(markers, dur));
  const [names, setNames] = useState<Record<number, string>>({});
  const [copyTags, setCopyTags] = useState(true);
  const [addToPlaylists, setAddToPlaylists] = useState(false);
  const parts = partsOf(points, dur, track.metaTitle || title, names);

  const preview = (startMs: number, endMs: number) => {
    const whole = resolveProfile(track, [], {}).profile;
    audio.previewTrack(track.id, {
      profile: { ...whole, startMs, endMs, loopStartMs: startMs, after: "stop", fadeIn: { ms: 0, shape: 50 }, fadeOut: { ms: 0, shape: 50 }, markers: [] },
      from: "Split into parts",
    });
  };
  const make = async () => {
    const done = await save(`${parts.length} parts of ${title} in the Track library`, () => api.library.splitIntoParts(track.id, { parts, copyTags, addToPlaylists }), { key: `split-${track.id}` });
    if (!done) return;
    onClose();
    const text = `Made ${parts.length} parts of ${title}. Each plays its part of the same file, which is not changed.`;
    say(`${text} To undo this, press Undo, at the bottom of the screen, or Ctrl+Z.`);
    if (done.ok) offer(text, done.undoLabel);
  };

  return (
    <Dialog
      open
      wide
      title="Split into parts"
      description={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {/* Review M5: one part is the whole track again, so there is nothing to make. */}
          <Button variant="primary" disabled={parts.length < 2} aria-describedby={parts.length < 2 ? "r9-sp-none" : undefined} onClick={() => void make()}>
            Make {plural(parts.length, "track")}
          </Button>
        </>
      }
    >
      <p>Each part becomes a track that plays its part of the same file. Your file is not changed, and the whole track stays in your library.</p>
      <fieldset className="r9-sp-cuts">
        <legend>Split at</legend>
        {points.map((p, i) => (
          <label key={i} className="r9-sp-cut">
            <input
              type="checkbox"
              checked={p.on}
              onChange={(e) => {
                setPoints(points.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)));
                // The parts change, so names typed for them no longer fit.
                setNames({});
              }}
            />
            {p.label} <span className="num faint">{lengthText(p.atMs)}</span>
          </label>
        ))}
      </fieldset>
      {parts.length < 2 && (
        <p className="hint" id="r9-sp-none">
          Tick at least one marker under Split at.
        </p>
      )}
      <table className="r9-sp-table">
        <caption className="sr-only">The parts</caption>
        <thead>
          <tr>
            <th scope="col">Part name</th>
            <th scope="col">From – to</th>
            <th scope="col">Length</th>
            <th scope="col">
              <span className="sr-only">Preview</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((x, i) => (
            <tr key={i}>
              <td>
                <input className="input" aria-label={`Name of part ${i + 1}`} value={x.name} onChange={(e) => setNames({ ...names, [i]: e.target.value })} />
              </td>
              <td className="num">
                {lengthText(x.startMs)} – {lengthText(x.endMs)}
              </td>
              <td className="num">{lengthText(x.endMs - x.startMs)}</td>
              <td>
                <button type="button" className="btn s icon" title={`Preview from ${lengthText(x.startMs)}`} aria-label={`Preview part ${i + 1}`} onClick={() => preview(x.startMs, x.endMs)}>
                  <Icon name="headphones" size="s" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="r9-sp-opt">
        <input type="checkbox" checked={copyTags} onChange={(e) => setCopyTags(e.target.checked)} />
        Copy its tags, Type and Use it for to each part
      </label>
      <label className="r9-sp-opt">
        <input type="checkbox" checked={addToPlaylists} onChange={(e) => setAddToPlaylists(e.target.checked)} />
        Add the parts beside it in its manual playlists
      </label>
    </Dialog>
  );
}
