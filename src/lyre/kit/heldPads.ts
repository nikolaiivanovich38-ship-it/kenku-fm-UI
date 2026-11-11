/**
 * Hold pads pressed with a click (Play on air buttons, the board screen's pad box): a click has no "key up", so the
 * pad is let go HOLD_MS after the last press. One pending let-go per pad across the page, so a second press within
 * HOLD_MS keeps the pad held from that press and the first press cannot let it go early (review w3-polish 10). A
 * component that goes away while one of its presses is held lets that pad go at once.
 */
import { useCallback, useEffect, useRef } from "react";

import type { LyreAudio } from "../audio/lyreAudio";

/** A hold pad played from a button is let go after this long. */
export const HOLD_MS = 1500;

type Held = { timer: ReturnType<typeof setTimeout>; release: () => void };

/** Each held pad's pending let-go, by "board/pad". */
const holds = new Map<string, Held>();

const keyOf = (boardId: string, padId: string) => `${boardId}/${padId}`;

/** Lets the pad go now if it is still held. */
function letGo(key: string) {
  const held = holds.get(key);
  if (!held) return;
  clearTimeout(held.timer);
  holds.delete(key);
  held.release();
}

/** Presses a hold pad and (re)starts its let-go; returns what `firePad(…, "down")` returned. */
export function pressHeldPad(audio: Pick<LyreAudio, "firePad">, boardId: string, padId: string) {
  const key = keyOf(boardId, padId);
  const before = holds.get(key);
  if (before) clearTimeout(before.timer);
  const outcome = audio.firePad(boardId, padId, "down");
  const release = () => audio.firePad(boardId, padId, "up");
  holds.set(key, {
    release,
    timer: setTimeout(() => {
      holds.delete(key);
      release();
    }, HOLD_MS),
  });
  return outcome;
}

/** `pressHeldPad` for a component: pads it pressed that are still held are let go when it unmounts. */
export function useHeldPads(audio: Pick<LyreAudio, "firePad">) {
  const mine = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const key of mine.current) letGo(key);
      mine.current.clear();
    },
    [],
  );
  return useCallback(
    (boardId: string, padId: string) => {
      mine.current.add(keyOf(boardId, padId));
      return pressHeldPad(audio, boardId, padId);
    },
    [audio],
  );
}
