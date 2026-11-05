/**
 * Preview and Play on air, the two small sound buttons every screen puts beside a track, a playlist, a pad or a pad
 * board (the prototype's L.previewButton and L.playOnAirButton in views/_shared.js).
 *
 * - Preview (headphones): only the game master hears it. Pressed, with a stop icon, while it plays; pressing it
 *   again stops it. A board previews its first pad.
 * - Play on air (broadcast): the players hear it, in the first room. Tracks and playlists fade in over 3 s, as in the
 *   prototype; a pad is pressed (a hold pad is let go after 1.5 s); a board presses its first pad.
 *
 * Both stop the click there, so a button inside a clickable row does not also open the row.
 */
import React, { useEffect, useRef } from "react";

import type { PadBoard } from "../../common/lyre/api";
import { useLyreAudio, usePreviewKey } from "../audio";
import { useAnnounce } from "../shell/Announcer";
import { Icon } from "./Icon";
import { cx } from "./cx";

export type SoundTarget =
  | { kind: "track"; id: string }
  /** empty: the playlist has no tracks, so Play on air says so instead. */
  | { kind: "playlist"; id: string; empty?: boolean }
  /** hold: a "hold to play" pad, let go after HOLD_MS when played from a button. */
  | { kind: "pad"; boardId: string; padId: string; hold?: boolean }
  | { kind: "board"; board: PadBoard };

/** Tracks and playlists fade in this long when played on air from a button (the prototype's fade: 3). */
export const PLAY_ON_AIR_FADE_MS = 3000;
/** A hold pad played from a button is let go after this long. */
export const HOLD_MS = 1500;

/** Each held pad's pending let-go, by "board/pad": a new press restarts it, so the first press cannot let go early. */
const holds = new Map<string, { timer: ReturnType<typeof setTimeout>; release: () => void }>();

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

/** Preview in your headphones; Stop preview while it plays. */
export function PreviewButton({ target, name, tabIndex, className }: SoundButtonProps) {
  const audio = useLyreAudio();
  const on = usePreviewKey() === previewKeyOf(target);
  const board = target.kind === "board";
  const start = () => {
    switch (target.kind) {
      case "track":
        return audio.previewTrack(target.id);
      case "playlist":
        return audio.previewPlaylist(target.id);
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
      <Icon name={on ? "stop" : "headphones"} size="s" />
    </button>
  );
}

/** Play on air: the players hear it. */
export function PlayOnAirButton({ target, name, tabIndex, className }: SoundButtonProps) {
  const audio = useLyreAudio();
  const { toast } = useAnnounce();
  // The hold this button started last; let go at once if the button goes away while it is held.
  const myHold = useRef<string | null>(null);
  useEffect(
    () => () => {
      const held = myHold.current ? holds.get(myHold.current) : undefined;
      if (!held) return;
      clearTimeout(held.timer);
      holds.delete(myHold.current!);
      held.release();
    },
    [],
  );
  const press = (boardId: string, padId: string, hold: boolean) => {
    if (!hold) return audio.firePad(boardId, padId);
    const key = `${boardId}/${padId}`;
    const before = holds.get(key);
    if (before) clearTimeout(before.timer);
    audio.firePad(boardId, padId, "down");
    const release = () => audio.firePad(boardId, padId, "up");
    holds.set(key, {
      release,
      timer: setTimeout(() => {
        holds.delete(key);
        release();
      }, HOLD_MS),
    });
    myHold.current = key;
  };
  const play = () => {
    switch (target.kind) {
      case "track":
        return audio.playTrack(target.id, { fadeMs: PLAY_ON_AIR_FADE_MS });
      case "playlist":
        if (target.empty) return toast("This playlist has no tracks yet");
        return audio.playPlaylist(target.id, { fadeMs: PLAY_ON_AIR_FADE_MS });
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
      <Icon name="broadcast" size="s" />
    </button>
  );
}
