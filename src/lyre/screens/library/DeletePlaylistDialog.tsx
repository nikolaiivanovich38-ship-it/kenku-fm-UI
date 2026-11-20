/**
 * Delete "<playlist>"?: the same question from the playlist's page and, since round 10 fixes (R10-FIX §2: "a way to
 * delete playlists in line"), from a row's ⋯ on the Playlists page or Delete on a focused row there. It names where the
 * playlist is used; after it, Undo at the bottom of the screen brings the playlist back where it was used.
 */
import React from "react";
import type { PlaylistInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { useAnnounce } from "../../shell/Announcer";
import { useUndoNote } from "../../shell/UndoNote";
import { nameUses, usedText, type PlaylistData } from "./playlistData";
import { useWriteResult } from "./shared";

export function DeletePlaylistDialog({ pl, data, onClose, onDeleted }: { pl: PlaylistInfo; data: PlaylistData; onClose: () => void; onDeleted?: () => void }) {
  const api = useLyreApi();
  const accept = useWriteResult();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const uses = data.usesOf(pl.id);
  const name = pl.name || "Untitled playlist";
  return (
    <Dialog
      open
      title={`Delete "${name}"?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              onClose();
              const result = await api.playlists.delete(pl.id);
              if (accept(result) === null) return;
              onDeleted?.();
              const text = uses.length
                ? `Deleted the playlist "${name}" and took it out of the scenes, sessions and campaigns that used it. Its tracks are still in the Track library.`
                : `Deleted the playlist "${name}". Its tracks are still in the Track library.`;
              say(`Deleted "${name}". To undo this, press Undo, at the bottom of the screen, or Ctrl+Z.`);
              if (result.ok) offer(text, result.undoLabel);
            }}
          >
            Delete playlist
          </Button>
        </>
      }
    >
      {uses.length ? (
        <>
          <p>It is used in {usedText(uses)}. Deleting it takes it out of these:</p>
          <ul className="pl-dellist">
            {nameUses(uses, data.campaigns).map((u) => (
              <li key={u.label}>{u.label}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>It is not used in any campaign, session or scene.</p>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        The tracks stay in your library.
      </p>
    </Dialog>
  );
}
