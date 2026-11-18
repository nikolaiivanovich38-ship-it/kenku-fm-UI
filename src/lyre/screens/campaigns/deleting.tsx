/**
 * 0.5.2 (Nik's list, items 15 and 48): Delete a campaign or a session from its ⋯ menu. The question names what goes
 * with it (sessions, scenes, notes, the playlists and pads kept on hand) and what stays (tracks, playlists and pad
 * boards in the library); once deleted, the message offers Undo (and Ctrl+Z), as Delete scene does.
 */
import React from "react";

import type { CampaignInfo, SessionInfo } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { useUndoNote } from "../../shell/UndoNote";
import { plural, sessionLabel } from "./model";
import { useWrite } from "./parts";

const STAYS = "Tracks, playlists and pad boards stay in your library.";

const sceneCount = (sessions: readonly SessionInfo[]) => sessions.reduce((n, s) => n + s.scenes.length, 0);

/** Asks, then deletes the campaign; `onDeleted` runs once it is gone (to leave its page). */
export function DeleteCampaignDialog({ campaign: c, onClose, onDeleted }: { campaign: CampaignInfo | null; onClose: () => void; onDeleted?: () => void }) {
  const api = useLyreApi();
  const write = useWrite();
  const { offer } = useUndoNote();
  const remove = async (campaign: CampaignInfo) => {
    onClose();
    const done = await write(api.campaigns.delete(campaign.id));
    if (done === undefined) return;
    onDeleted?.();
    offer(`Deleted the campaign "${campaign.name}".`, done.undoLabel);
  };
  return (
    <Dialog
      open={!!c}
      title="Delete this campaign?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" icon="trash" onClick={() => c && void remove(c)}>
            Delete campaign
          </Button>
        </>
      }
    >
      {c && (
        <p>
          Delete <b>{c.name}</b> with its {plural(c.sessions.length, "session")}, {plural(sceneCount(c.sessions), "scene")} and notes, and the campaign&apos;s playlists
          and pads? {STAYS}
        </p>
      )}
    </Dialog>
  );
}

/** Asks, then deletes the session; `onDeleted` runs once it is gone (to leave its page). */
export function DeleteSessionDialog({ session: s, onClose, onDeleted }: { session: SessionInfo | null; onClose: () => void; onDeleted?: () => void }) {
  const api = useLyreApi();
  const write = useWrite();
  const { offer } = useUndoNote();
  const remove = async (session: SessionInfo) => {
    onClose();
    const done = await write(api.sessions.delete(session.campaignId, session.id));
    if (done === undefined) return;
    onDeleted?.();
    offer(`Deleted ${sessionWords(session)}.`, done.undoLabel);
  };
  return (
    <Dialog
      open={!!s}
      title="Delete this session?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button variant="danger" icon="trash" onClick={() => s && void remove(s)}>
            Delete session
          </Button>
        </>
      }
    >
      {s && (
        <p>
          Delete {s.name ? <>Session {s.number}, <b>{s.name}</b>,</> : <b>Session {s.number}</b>} with its {plural(s.scenes.length, "scene")} and notes, and the
          session&apos;s playlists and pads? {STAYS}
        </p>
      )}
    </Dialog>
  );
}

/** "Session 13, The coast road" (or "Session 13" with no name). */
function sessionWords(s: SessionInfo): string {
  return s.name ? `Session ${s.number}, ${s.name}` : sessionLabel(s);
}
