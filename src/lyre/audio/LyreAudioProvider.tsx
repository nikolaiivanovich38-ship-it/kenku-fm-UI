/**
 * React access to LyreAudio for the new interface's screens.
 *
 * - `<LyreAudioProvider audio={audio}>` once, in the page root.
 * - `useLyreAudio()`: the LyreAudio to call (play, pads, preview…);
 *   `useOptionalLyreAudio()` for the shell, which also works without sound.
 * - `useNowPlaying()`: what plays in each room, redrawn on every change and
 *   about once a second while anything plays (positions); `usePreviewKey()`
 *   only what previews.
 * - `useLyreAudioEvent("announce" | "error", handler)`: sentences for the
 *   screen reader's live region, and plain messages for toasts.
 *
 * Screen tests pass a FakeLyreAudio (testing/fakeLyreAudio.ts).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";

import type { LyreAudio, LyreAudioEvents, NowPlaying } from "./lyreAudio";

const LyreAudioContext = createContext<LyreAudio | null>(null);

export function LyreAudioProvider({ audio, children }: { audio: LyreAudio; children?: React.ReactNode }) {
  return <LyreAudioContext.Provider value={audio}>{children}</LyreAudioContext.Provider>;
}

export function useLyreAudio(): LyreAudio {
  const audio = useContext(LyreAudioContext);
  if (!audio) {
    throw new Error("useLyreAudio needs a LyreAudioProvider around the page (see src/lyre/audio/LyreAudioProvider.tsx).");
  }
  return audio;
}

/** The LyreAudio, or null outside a LyreAudioProvider (the shell works without sound, e.g. when it could not start). */
export function useOptionalLyreAudio(): LyreAudio | null {
  return useContext(LyreAudioContext);
}

export function useNowPlaying(): NowPlaying {
  const audio = useLyreAudio();
  // Stable per LyreAudio, so React subscribes once, not on every render.
  const subscribe = useCallback((listener: () => void) => audio.subscribe(listener), [audio]);
  const snapshot = useCallback(() => audio.getNowPlaying(), [audio]);
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * The key of what previews now (a track's id, "pl:…", "pad:…"), or null. Redraws only when that changes, not on every
 * now-playing tick, so a list of many Preview buttons stays cheap while music plays.
 */
export function usePreviewKey(): string | null {
  const audio = useLyreAudio();
  const subscribe = useCallback((listener: () => void) => audio.subscribe(listener), [audio]);
  const snapshot = useCallback(() => audio.getNowPlaying().preview?.key ?? null, [audio]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Listen to LyreAudio's announcements or errors while the component is shown. */
export function useLyreAudioEvent<E extends keyof LyreAudioEvents>(event: E, handler: LyreAudioEvents[E]): void {
  const audio = useLyreAudio();
  // The latest handler, so a new function each render does not re-subscribe.
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = ((text: string) => (latest.current as (text: string) => void)(text)) as LyreAudioEvents[E];
    audio.on(event, listener);
    return () => {
      audio.off(event, listener);
    };
  }, [audio, event]);
}
