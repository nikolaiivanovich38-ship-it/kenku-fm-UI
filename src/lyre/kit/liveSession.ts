/**
 * The session loaded in Live (the prototype's L.state.live and L.liveStandby): Run, Run next session and the Live
 * side of the Prep or Live switch load a session here and open #/live, where it waits, ready to start, with nothing
 * playing. Campaigns sets it; the Live screen reads it (and the shell can show it: ShellData.liveCampaign and
 * liveLabel). Kept for the page's lifetime, like the prototype's state.
 */
import { useSyncExternalStore } from "react";

export interface LiveSession {
  campaignId: string;
  sessionId: string;
}

let loaded: LiveSession | null = null;
const listeners = new Set<() => void>();

/** Load a session in Live, ready to start (null: none loaded). Listeners hear of it. */
export function loadInLive(session: LiveSession | null): void {
  loaded = session ? { campaignId: session.campaignId, sessionId: session.sessionId } : null;
  listeners.forEach((listener) => listener());
}

export function getLiveSession(): LiveSession | null {
  return loaded;
}

/** Returns a function that stops listening. */
export function subscribeLiveSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session loaded in Live, redrawn when it changes. */
export function useLiveSession(): LiveSession | null {
  return useSyncExternalStore(subscribeLiveSession, getLiveSession);
}

/** Load a session in Live and open the Live screen (Run, Run next session, Prep or Live). */
export function runInLive(session: LiveSession): void {
  loadInLive(session);
  window.location.hash = "#/live";
}

/** How long a Next scene pressed on another screen waits for Live to open and take it. */
const NEXT_SCENE_WAITS_MS = 10_000;
let nextSceneAsked: number | null = null;

/**
 * w51-fix2 (Nik, 0.5.0: "F9 does nothing"): Next scene pressed in another program while Lyre shows another screen.
 * Only Live listens for it, so the press opens Live, which starts the next scene once it is drawn (takeNextScene).
 */
export function nextSceneInLive(now: number = Date.now()): void {
  nextSceneAsked = now;
  window.location.hash = "#/live";
}

/** True once for a Next scene asked for on another screen within the last few seconds. */
export function takeNextScene(now: number = Date.now()): boolean {
  const asked = nextSceneAsked;
  nextSceneAsked = null;
  return asked !== null && now - asked <= NEXT_SCENE_WAITS_MS;
}
