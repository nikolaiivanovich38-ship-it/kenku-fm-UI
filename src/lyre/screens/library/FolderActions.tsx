/**
 * A library folder's ⋯ in the Filters box (0.5.2): what kind its new tracks are (item 40: guessed from the folder
 * name, as before, or always Music, Ambience or FX) and Remove folder… (item 20: Lyre stops watching it and forgets
 * it; its tracks stay unless the game master ticks to remove them too; the files are never touched). Both with Undo.
 */
import React, { useRef, useState } from "react";
import type { TrackKind } from "../../../common/domain";
import type { FolderRoot, LibraryTrack } from "../../../common/lyre/api";
import { useBoards, useCampaigns, useLyreApi, usePlaylists } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { getLibraryState, setLibraryState } from "./libraryState";
import { inFolder, KIND_NAMES, plural, shortPath } from "./model";
import { focusSoon, useWriteResult } from "./shared";
import { isUsed, usesLines, usesOfTracks } from "./trackUses";

const NONE: never[] = [];
const KINDS: TrackKind[] = ["music", "amb", "fx"];

export function FolderActions({ root, tracks }: { root: FolderRoot; tracks: readonly LibraryTrack[] }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const [removing, setRemoving] = useState(false);
  const name = shortPath(root.path);

  const setKind = async (kind: TrackKind | null) => {
    const result = await api.import.setFolderKind(root.path, kind);
    if (!accept(result)) return;
    const text = kind ? `New tracks in ${name} are ${KIND_NAMES[kind]}.` : `New tracks in ${name} are guessed from their folder names.`;
    say(text);
    if (result.ok) offer(text, result.undoLabel);
  };
  const items = (): PopMenuEntry[] => [
    { group: "New tracks here are" },
    { role: "menuitemradio", checked: root.newKind === null, content: "Guessed from the folder name", onSelect: () => void setKind(null) },
    ...KINDS.map((k): PopMenuEntry => ({ role: "menuitemradio", checked: root.newKind === k, content: `Always ${KIND_NAMES[k]}`, onSelect: () => void setKind(k) })),
    { separator: true },
    {
      content: (
        <>
          <Icon name="close" size="s" />
          Remove folder…
        </>
      ),
      onSelect: () => setRemoving(true),
    },
  ];
  return (
    <>
      <PopMenuButton label={`More for ${name}`} ariaLabel={`More for the folder ${root.path}`} title="More" className="btn s icon ghost lb-fmore" items={items}>
        <Icon name="more" size="s" />
      </PopMenuButton>
      {removing && <RemoveFolderDialog root={root} under={tracks.filter((t) => inFolder(t, root.path))} onClose={() => setRemoving(false)} />}
    </>
  );
}

function RemoveFolderDialog({ root, under, onClose }: { root: FolderRoot; under: LibraryTrack[]; onClose: () => void }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const playlists = usePlaylists().data ?? NONE;
  const campaigns = useCampaigns().data ?? NONE;
  const boards = useBoards().data ?? NONE;
  const [withTracks, setWithTracks] = useState(false);
  const n = under.length;
  const uses = usesOfTracks(
    under.map((t) => t.id),
    { playlists, campaigns, boards },
  );
  // Review of r052: one press only, as Delete file.
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const remove = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const result = await api.import.removeFolder(root.path, { removeTracks: withTracks }).finally(() => {
      running.current = false;
      setBusy(false);
    });
    const done = accept(result);
    if (!done) return;
    onClose();
    if (getLibraryState().filter.folder && inFolder({ folder: getLibraryState().filter.folder }, root.path)) setLibraryState((s) => ({ filter: { ...s.filter, folder: "" } }));
    const text = withTracks ? `Removed ${root.path} and its ${plural(done.removedTracks.length, "track")} from the library. The files are still on your computer.` : `Removed ${root.path} from Lyre's folders. Its tracks stay in your library.`;
    say(text);
    if (result.ok) offer(text, result.undoLabel);
    focusSoon("lb-q");
  };
  return (
    <Dialog
      open
      title={`Remove ${shortPath(root.path)}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void remove()}>
            Remove folder
          </Button>
        </>
      }
    >
      <p>
        Lyre {root.watched ? "stops watching" : "forgets"} <b>{root.path}</b>. Nothing is deleted from your computer.
      </p>
      {n > 0 ? (
        <>
          <label className="lb-check">
            <input type="checkbox" checked={withTracks} onChange={(e) => setWithTracks(e.target.checked)} />
            <span>Also remove its {plural(n, "track")} from the library</span>
          </label>
          <p className="hint">{withTracks ? "Their files stay on your computer. Undo puts them back." : `The ${plural(n, "track")} stay in your library, where they are.`}</p>
          {withTracks && isUsed(uses) && (
            <div className="lb-uses" role="note">
              <p>They are used in:</p>
              <ul>
                {usesLines(uses).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="hint">No track in your library is in it.</p>
      )}
    </Dialog>
  );
}
