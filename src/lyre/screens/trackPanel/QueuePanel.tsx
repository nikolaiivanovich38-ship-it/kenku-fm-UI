/**
 * Round 9 and 10 (row 20; Nik's list of 18 Nov: "When previewing a playlist, or any queue of music, I need to be able
 * to see the now playing queue, select any track in it to play"): the queue of the preview in a side panel at the
 * right (kit/SidePanel kind "queue"): Played, Now playing and Up next, with Play on each track to come and the
 * playlist's dividers as headings; × or Esc closes it and focus goes back to the Queue button. r9live.js queueHTML.
 *
 * 0.6.0 (f-live 3): the same panel for a room on air (`room`): what the room's plan played, what plays now, and its
 * Up next (the plan still to come and what was added), with Play now on each planned track (as Live's Up next); its
 * edge is the on-air colour, the preview's the preview colour.
 */
import React, { useEffect, useRef } from "react";
import type { LyreAudio, PreviewQueue, RoomNowPlaying } from "../../audio";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { usePlaylists } from "../../api";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { DividedTrackList, dividersBefore } from "../library/PlaylistTrackList";
import "./trackPanel.css";

/** The queue as shown: a row to come may have Play now (every row of a preview, a planned track of a room). */
type QueueShown = Omit<PreviewQueue, "upNext"> & { upNext: (PreviewQueue["upNext"][number] & { play?: () => boolean })[] };

export function QueuePanel({ onClose, room }: { onClose: () => void; room?: string }) {
  const audio = useLyreAudio();
  // Drawn again as the preview or the room moves on.
  const now = useNowPlaying();
  const { say } = useAnnounce();
  const playlists = usePlaylists().data ?? [];
  const head = useRef<HTMLHeadingElement>(null);
  const onAir = room !== undefined ? now.rooms.find((r) => r.roomId === room) : undefined;
  const queue: QueueShown | null = room !== undefined ? roomQueueOf(audio, onAir) : now.preview ? audio.previewQueue() : null;
  const playlist = queue?.playlistId ? playlists.find((p) => p.id === queue.playlistId) : undefined;
  const live = !!queue && room !== undefined;
  useEffect(() => head.current?.focus({ preventScroll: true }), []);
  // Nothing previews (or plays in the room) any more: the queue has nothing to show.
  const gone = room !== undefined ? !onAir?.music : !now.preview;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  // 0.6.0 language review C15: a room's queue says it is on air (and in which room, with two or more).
  const inRoom = now.rooms.length > 1 && onAir ? ` in ${onAir.name}` : "";

  return (
    <section
      className={live ? "r9-queue air" : "r9-queue"}
      aria-labelledby="r9-q-title"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="r9-tp-head">
        <div className="r9-tp-bar">
          <button type="button" className="closer" title="Close (Esc)" aria-label="Close the queue" onClick={onClose}>
            <Icon name="close" />
          </button>
          <h2 id="r9-q-title" ref={head} tabIndex={-1}>
            Queue
          </h2>
          <span className="faint ellipsis">{room !== undefined ? `${playlist ? `${playlist.name} · on air` : "On air"}${inRoom}` : playlist ? `${playlist.name} · only you` : "Only you"}</span>
        </div>
      </header>
      <div className="r9-tp-body">
        {queue && (
          <>
            {queue.played.length > 0 && (
              <>
                <h3 className="r9-q-h">Played</h3>
                <ol className="r9-q-list" aria-label="Played">
                  {queue.played.map((t, i) => (
                    <li key={`${t.trackId}:${i}`} className="r9-q-played">
                      <span className="ellipsis grow" title={t.title}>
                        {t.title}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <h3 className="r9-q-h">Now playing</h3>
            <ol className="r9-q-list" aria-label="Now playing">
              <li className="r9-q-now" aria-current="true">
                <span className="ellipsis grow" title={queue.now.title}>
                  {queue.now.title}
                </span>
                <span className="badge">Now</span>
              </li>
            </ol>
            <h3 className="r9-q-h">Up next</h3>
            {queue.upNext.length ? (
              <DividedTrackList
                label="Up next"
                className="r9-q-list"
                items={queue.upNext.map((t) => ({ ...t, id: t.trackId, play: t.play ?? (room === undefined ? () => audio.previewPlayAt(t.index).ok : undefined) }))}
                dividers={playlist ? dividersBefore(playlist) : new Map()}
                renderItem={(t) => (
                  <li key={`${t.trackId}:${t.index}`}>
                    <span className="ellipsis grow" title={t.title}>
                      {t.title}
                    </span>
                    {t.play && (
                      <button
                        type="button"
                        className="btn s icon"
                        aria-label={`Play now: ${t.title}`}
                        title={room !== undefined ? "Play it now on air. Up next continues from there." : "Play it now. The queue continues from there."}
                        onClick={() => {
                          if (t.play?.()) say(`Playing now: ${t.title}`);
                        }}
                      >
                        <Icon name="play" size="s" />
                      </button>
                    )}
                  </li>
                )}
              />
            ) : (
              <p className="hint r9-q-empty">Nothing comes after this track.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * f-live: a room's queue in the preview queue's shape: Played and Now playing from the audio host, Up next from the
 * room's Up next (one row per track still to come; a planned one can be played now, and the plan goes on from there).
 */
function roomQueueOf(audio: LyreAudio, room: RoomNowPlaying | undefined): QueueShown | null {
  if (!room?.music) return null;
  const base = audio.roomQueue({ room: room.roomId });
  if (!base) return null;
  let index = 0;
  const upNext = room.upNextList.flatMap((entry) =>
    entry.trackIds.map((trackId, k) => ({
      trackId,
      title: entry.kind === "planned" || entry.trackIds.length === 1 ? entry.title : `${entry.title} (${k + 1} of ${entry.trackIds.length})`,
      index: index++,
      ...(entry.kind === "planned" && k === 0 ? { play: () => audio.playUpNext(entry.ref, { room: room.roomId }).ok } : {}),
    })),
  );
  return { ...base, upNext };
}
