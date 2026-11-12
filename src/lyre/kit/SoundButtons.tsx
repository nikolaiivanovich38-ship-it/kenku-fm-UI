/**
 * Preview and Play on air, the two small sound buttons every screen puts beside a track, a playlist, a pad or a pad
 * board (the prototype's L.previewButton and L.playOnAirButton in views/_shared.js).
 *
 * - Preview (headphones): only the game master hears it. Pressed, with a stop icon, while it plays; pressing it
 *   again stops it. A board previews its first pad.
 * - Play on air (the play triangle sounding out; UX-R8): the players hear it, in the first room. Tracks and playlists fade in over 3 s, as in the
 *   prototype; a pad is pressed (a hold pad is let go after 1.5 s); a board presses its first pad.
 *
 * Both stop the click there, so a button inside a clickable row does not also open the row.
 */
import React from "react";

import type { UsePlace } from "../../common/domain";
import type { PadBoard } from "../../common/lyre/api";
import { useLyreAudio, usePreviewKey } from "../audio";
import { useAnnounce } from "../shell/Announcer";
import { Icon } from "./Icon";
import { cx } from "./cx";
import { HOLD_MS, useHeldPads } from "./heldPads";

export type SoundTarget =
  /**
   * playlistId: the playlist it is shown in, so its normalising choice applies to the preview (PLY-15). place: the
   * scene it is shown in, so its own audio settings there apply to the preview. file: another file's address to
   * preview as this track (Find missing files: the file found, security review w4 Should 5).
   */
  | { kind: "track"; id: string; playlistId?: string; place?: UsePlace; file?: string }
  /**
   * empty: the playlist has no tracks, so Play on air says so instead. place: the session or campaign list it is shown
   * in, so that list's play order applies and the Now playing bar says where it comes from (PLY-13, UX-16); for a
   * preview, the scene or list whose audio settings apply.
   */
  | { kind: "playlist"; id: string; empty?: boolean; place?: UsePlace }
  /** hold: a "hold to play" pad, let go after HOLD_MS when played from a button. */
  | { kind: "pad"; boardId: string; padId: string; hold?: boolean }
  | { kind: "board"; board: PadBoard };

/** Tracks and playlists fade in this long when played on air from a button (the prototype's fade: 3). */
export const PLAY_ON_AIR_FADE_MS = 3000;
export { HOLD_MS };

/** The board's first pad on the grid, row by row, else its first spare pad (what its Preview plays). */
function firstPad(board: PadBoard) {
  return board.slots.find((pad) => pad !== null) ?? board.spare[0];
}

/** The audio host's preview key for a target: a track's id, "pl:<playlist>", "pad:<board>/<pad>". */
export function previewKeyOf(target: SoundTarget): string {
  switch (target.kind) {
    case "track":
      return target.id;
    case "playlist":
      return `pl:${target.id}`;
    case "pad":
      return `pad:${target.boardId}/${target.padId}`;
    case "board":
      return `pad:${target.board.id}/${firstPad(target.board)?.id ?? ""}`;
  }
}

export interface SoundButtonProps {
  target: SoundTarget;
  /** The track's, playlist's, pad's or board's name as the game master knows it, for the accessible name. */
  name: string;
  /** -1 keeps a row's button out of the Tab order (a list that is one Tab stop). */
  tabIndex?: number;
  className?: string;
}

export interface PreviewButtonProps extends SoundButtonProps {
  /** The icon while it is not playing: headphones, or ▶ where the button sits on the thing itself (a pad tile). */
  icon?: "headphones" | "play";
}

/** Preview in your headphones; Stop preview while it plays. */
export function PreviewButton({ target, name, tabIndex, className, icon = "headphones" }: PreviewButtonProps) {
  const audio = useLyreAudio();
  const on = usePreviewKey() === previewKeyOf(target);
  const board = target.kind === "board";
  const start = () => {
    switch (target.kind) {
      case "track":
        if (target.file) return audio.previewTrack(target.id, { file: target.file });
        if (!target.playlistId && !target.place) return audio.previewTrack(target.id);
        return audio.previewTrack(target.id, { ...(target.playlistId ? { playlistId: target.playlistId } : {}), ...(target.place ? { place: target.place } : {}) });
      case "playlist":
        return target.place ? audio.previewPlaylist(target.id, { place: target.place }) : audio.previewPlaylist(target.id);
      case "pad":
        return audio.previewPad(target.boardId, target.padId);
      case "board":
        return audio.previewPad(target.board.id, firstPad(target.board)?.id ?? "");
    }
  };
  return (
    <button
      type="button"
      className={cx("btn s icon pv", className)}
      tabIndex={tabIndex}
      aria-pressed={on}
      title={on ? "Stop preview" : board ? "Preview the first pad in your headphones" : "Preview in your headphones"}
      aria-label={on ? `Stop preview of ${name}` : board ? `Preview the first pad of ${name}` : `Preview ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        if (on) audio.stopPreview();
        else start();
      }}
    >
      <Icon name={on ? "stop" : icon} size="s" />
    </button>
  );
}

/** Play on air: the players hear it. */
export function PlayOnAirButton({ target, name, tabIndex, className }: SoundButtonProps) {
  const audio = useLyreAudio();
  const { toast } = useAnnounce();
  const pressHeld = useHeldPads(audio);
  const press = (boardId: string, padId: string, hold: boolean) => (hold ? pressHeld(boardId, padId) : audio.firePad(boardId, padId));
  const play = () => {
    switch (target.kind) {
      case "track":
        return audio.playTrack(target.id, { fadeMs: PLAY_ON_AIR_FADE_MS });
      case "playlist":
        if (target.empty) return toast("This playlist has no tracks yet");
        return audio.playPlaylist(target.id, target.place ? { fadeMs: PLAY_ON_AIR_FADE_MS, place: target.place } : { fadeMs: PLAY_ON_AIR_FADE_MS });
      case "pad":
        return press(target.boardId, target.padId, !!target.hold);
      case "board": {
        const pad = firstPad(target.board);
        return pad && press(target.board.id, pad.id, pad.mode === "hold");
      }
    }
  };
  return (
    <button
      type="button"
      className={cx("btn s icon", className)}
      tabIndex={tabIndex}
      title="Play on air (the players hear it)"
      aria-label={`Play on air: ${target.kind === "board" ? `the first pad of ${name}` : name}`}
      onClick={(event) => {
        event.stopPropagation();
        play();
      }}
    >
      <Icon name="playair" size="s" />
    </button>
  );
}
