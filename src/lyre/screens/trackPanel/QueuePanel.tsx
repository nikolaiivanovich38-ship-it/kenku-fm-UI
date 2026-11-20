/**
 * Round 9 and 10 (row 20; Nik's list of 18 Nov: "When previewing a playlist, or any queue of music, I need to be able
 * to see the now playing queue, select any track in it to play"): the queue of the preview in a side panel at the
 * right (kit/SidePanel kind "queue"): Played, Now playing and Up next, with Play on each track to come and the
 * playlist's dividers as headings; × or Esc closes it and focus goes back to the Queue button. r9live.js queueHTML.
 */
import React, { useEffect, useRef } from "react";
import type { PreviewQueue } from "../../audio";
import { useLyreAudio, useNowPlaying } from "../../audio";
import { usePlaylists } from "../../api";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { DividedTrackList, dividersBefore } from "../library/PlaylistTrackList";
import "./trackPanel.css";

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const audio = useLyreAudio();
  // Drawn again as the preview moves on.
  const now = useNowPlaying();
  const { say } = useAnnounce();
  const playlists = usePlaylists().data ?? [];
  const head = useRef<HTMLHeadingElement>(null);
  const queue: PreviewQueue | null = now.preview ? audio.previewQueue() : null;
  const playlist = queue?.playlistId ? playlists.find((p) => p.id === queue.playlistId) : undefined;
  useEffect(() => head.current?.focus({ preventScroll: true }), []);
  // Nothing previews any more: the queue has nothing to show.
  useEffect(() => {
    if (!now.preview) onClose();
  }, [now.preview, onClose]);

  return (
    <section
      className="r9-queue"
      aria-labelledby="r9-q-title"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".menu, [role=dialog]")) return;
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
          <span className="faint ellipsis">{playlist ? `${playlist.name} · only you` : "Only you"}</span>
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
                items={queue.upNext.map((t) => ({ ...t, id: t.trackId }))}
                dividers={playlist ? dividersBefore(playlist) : new Map()}
                renderItem={(t) => (
                  <li key={`${t.trackId}:${t.index}`}>
                    <span className="ellipsis grow" title={t.title}>
                      {t.title}
                    </span>
                    <button
                      type="button"
                      className="btn s icon"
                      aria-label={`Play ${t.title} now`}
                      title="Play it now. The queue continues from there."
                      onClick={() => {
                        if (audio.previewPlayAt(t.index).ok) say(`Playing now: ${t.title}`);
                      }}
                    >
                      <Icon name="play" size="s" />
                    </button>
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
