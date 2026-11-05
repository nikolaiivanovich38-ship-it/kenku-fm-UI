/**
 * Pieces the Library and Playlists screens share: a playlist's contents behind an expander, what plays on air, the
 * plumbing for writes, and focus after a redraw. Preview and Play on air, the two-line menu and the Audio profile
 * link are in src/lyre/kit; the shell says the sound's own messages (shell/SoundMessages.tsx).
 */
import React, { useCallback } from "react";
import { isRefused, type WriteResult } from "../../../common/lyre/api";
import { ProfileLink } from "../../kit/ProfileLink";
import { PreviewButton } from "../../kit/SoundButtons";
import type { NowPlaying } from "../../audio";
import { useAnnounce } from "../../shell/Announcer";
import { fmt } from "./model";

/* ---------- writes ---------- */

/** Checks a write's answer: a refusal is shown as a toast in the API's own words. Returns the value, or null. */
export function useWriteResult() {
  const { toast } = useAnnounce();
  return useCallback(
    <T,>(result: WriteResult<T>): T | null => {
      if (isRefused(result)) {
        toast(result.refusal.message);
        return null;
      }
      return result.value as T;
    },
    [toast],
  );
}

/** Checks a write that answers nothing: true when done; a refusal is shown as a toast. */
export function useWriteOk() {
  const { toast } = useAnnounce();
  return useCallback(
    (result: WriteResult<unknown>): boolean => {
      if (isRefused(result)) {
        toast(result.refusal.message);
        return false;
      }
      return true;
    },
    [toast],
  );
}

/* ---------- what plays ---------- */

/** Track ids the players hear now (music, ambience, effects still sounding), in any room. */
export function onAirTrackIds(now: NowPlaying): Set<string> {
  const ids = new Set<string>();
  for (const room of now.rooms) {
    if (room.music) ids.add(room.music.trackId);
    if (room.ambience) ids.add(room.ambience.trackId);
    for (const fx of room.effects) ids.add(fx.trackId);
  }
  return ids;
}
/** Playlists the music or ambience plays through now, in any room. */
export function onAirPlaylistIds(now: NowPlaying): Set<string> {
  const ids = new Set<string>();
  for (const room of now.rooms) {
    if (room.music?.playlistId) ids.add(room.music.playlistId);
    if (room.ambience?.playlistId) ids.add(room.ambience.playlistId);
  }
  return ids;
}
/* ---------- a playlist's contents ---------- */

export interface ContentsTrack {
  id: string;
  title: string;
  durationMs: number;
}

/** The inside of a playlist's expander: its tracks in order, each with its Audio profile here and Preview. */
export function PlaylistContents({ playlistId, name, dynamic, tracks }: { playlistId: string; name: string; dynamic: boolean; tracks: ContentsTrack[] }) {
  if (!tracks.length) return <p className="hint">No tracks yet{dynamic ? ": no track matches its tags." : "."}</p>;
  return (
    <ol className="list" aria-label={`Tracks in ${name}`}>
      {tracks.map((t, i) => (
        <li key={t.id} className="xp-row">
          <span className="faint num">{i + 1}</span>
          <span className="grow" title={t.title}>
            {t.title}
          </span>
          <span className="num faint">{fmt(t.durationMs)}</span>
          <ProfileLink trackId={t.id} title={t.title} place={`pl:${playlistId}`} placeName={`the playlist ${name}`} iconOnly />
          <PreviewButton target={{ kind: "track", id: t.id }} name={t.title} />
        </li>
      ))}
    </ol>
  );
}

/* ---------- focus after a redraw ---------- */

/** Focus the element with this data-focus key once it is on the page (after the next paint). */
export function focusSoon(key: string, select = false): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-focus="${key.replace(/["\\]/g, "\\$&")}"]`);
    if (!el) return;
    el.focus();
    if (select && el instanceof HTMLInputElement) el.select();
  }, 30);
}
