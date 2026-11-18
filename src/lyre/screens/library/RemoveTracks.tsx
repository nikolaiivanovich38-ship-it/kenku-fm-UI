/**
 * 0.5.2 items 1 and 50: taking tracks out of the Track library.
 *
 * - Remove from library (a row's ⋯, the selection's ⋯, Remove all shown… in the ⋯ beside Add tracks): the tracks leave
 *   Lyre and every playlist, pad and scene; their files stay. One step, with Undo.
 * - Delete file from disk… (a row's ⋯ and the selection's ⋯, last and apart): the files go to the Recycle Bin (never
 *   deleted outright) and their tracks leave Lyre. The confirmation names the files and says it cannot be undone in
 *   Lyre (Undo brings the tracks back, not the files).
 *
 * Both confirmations name where the tracks are used (manual playlists, scenes, pads: trackUses.ts).
 */
import React, { useRef, useState } from "react";
import type { LibraryTrack } from "../../../common/lyre/api";
import { useBoards, useCampaigns, useLyreApi, usePlaylists } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { setLibraryState } from "./libraryState";
import { plural, shownTitle } from "./model";
import { focusSoon, useWriteResult } from "./shared";
import { isUsed, usesLines, usesOfTracks } from "./trackUses";

const NONE: never[] = [];
/** File names listed in Delete file from disk…, at most; the rest are counted. */
const NAMED_FILES = 10;

export type Removal = { how: "remove" | "delete"; ids: string[]; shown?: boolean };

export function RemoveTracksDialog({ removal, tracks, onClose, onRemoved }: { removal: Removal; tracks: ReadonlyMap<string, LibraryTrack>; onClose: () => void; onRemoved: (ids: string[]) => void }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say, toast } = useAnnounce();
  const { offer } = useUndoNote();
  const playlists = usePlaylists().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;
  const boards = useBoards().data ?? NONE;
  const list = removal.ids.map((id) => tracks.get(id)).filter((t): t is LibraryTrack => !!t);
  const n = list.length;
  const one = n === 1 ? list[0] : null;
  const uses = usesOfTracks(
    list.map((t) => t.id),
    { playlists, campaigns, boards },
  );
  const deleting = removal.how === "delete";
  const what = one ? `“${shownTitle(one)}”` : removal.shown ? `all ${n} shown tracks` : plural(n, "track");

  // Review of r052: one press only; a second one while the library works sent the files again.
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const go = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const run = async () => {
    const ids = list.map((t) => t.id);
    if (deleting) {
      const result = await api.library.deleteFiles(ids);
      const done = accept(result);
      if (!done) return;
      onClose();
      onRemoved(done.removed);
      const sent = done.removed.length ? `${plural(done.removed.length, "file")} sent to the Recycle Bin, and ${done.removed.length === 1 ? "its track" : "their tracks"} removed from the library.` : "No file was sent to the Recycle Bin.";
      const kept = done.problems.length ? ` ${plural(done.problems.length, "track")} kept: ${done.problems.map((p) => `${shownTitle(tracks.get(p.trackId) ?? { title: "", metaTitle: "", fileName: p.trackId })}: ${p.reason}`).join(" ")}` : "";
      say(sent + kept);
      if (done.problems.length) toast(sent + kept);
      else if (result.ok && done.removed.length) offer(`${sent} Undo brings the tracks back; the files stay in the Recycle Bin.`, result.undoLabel);
    } else {
      const result = await api.library.removeTracks(ids);
      const done = accept(result);
      if (!done) return;
      onClose();
      onRemoved(done.removed);
      const text = `Removed ${one ? `“${shownTitle(one)}”` : plural(done.removed.length, "track")} from the library. ${done.removed.length === 1 ? "Its file is" : "Their files are"} still on your computer.`;
      say(text);
      if (result.ok) offer(text, result.undoLabel);
    }
    focusSoon("lb-q");
  };

  const files = list.map((t) => t.fileName);
  return (
    <Dialog
      open
      title={deleting ? `Delete ${one ? "its file" : plural(n, "file")} from disk?` : `Remove ${what} from the library?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={deleting ? "danger" : "primary"} disabled={busy} aria-busy={busy || undefined} onClick={() => void go()}>
            {deleting ? (one ? "Delete file" : `Delete ${plural(n, "file")}`) : one ? "Remove" : `Remove ${plural(n, "track")}`}
          </Button>
        </>
      }
    >
      {deleting ? (
        <>
          <p>
            {one ? "This file goes" : "These files go"} to the Recycle Bin, and {one ? "its track leaves" : "their tracks leave"} the library. <b>This can't be undone in Lyre</b>: to get{" "}
            {one ? "it" : "them"} back, restore {one ? "it" : "them"} from the Recycle Bin.
          </p>
          <ul className="lb-files">
            {files.slice(0, NAMED_FILES).map((f, i) => (
              <li key={`${i}:${f}`}>{f}</li>
            ))}
            {files.length > NAMED_FILES && <li className="hint">and {plural(files.length - NAMED_FILES, "more file")}</li>}
          </ul>
        </>
      ) : (
        <p>
          {one ? "It leaves" : "They leave"} Lyre, and every playlist, pad and scene. {one ? "Its file stays" : "Their files stay"} on your computer, and Undo puts {one ? "it" : "them"} back.
        </p>
      )}
      {isUsed(uses) && (
        <div className="lb-uses" role="note">
          <p>{one ? "It is" : "They are"} used in:</p>
          <ul>
            {usesLines(uses).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** After a removal: the removed tracks leave the selection, and an open one closes. */
export function forgetRemoved(ids: string[], openId: string | undefined): void {
  const gone = new Set(ids);
  setLibraryState((s) => ({ sel: s.sel.filter((id) => !gone.has(id)), cursor: s.cursor && gone.has(s.cursor) ? null : s.cursor, anchor: s.anchor && gone.has(s.anchor) ? null : s.anchor }));
  if (openId && gone.has(openId)) window.location.hash = "#/library";
}
