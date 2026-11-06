/**
 * The Lyre page's preload half of LyreApi (src/lyre/preload.ts exposes it as `window.lyre.api`): each call goes to
 * the main process on LYRE_API_CALL, which relays it to the library's own process; events come back on
 * LYRE_API_EVENT. Only plain data crosses into the page. Kept free of Electron imports (the preload passes
 * `ipcRenderer`), so it is unit-tested.
 */
import type { LyreEvent } from "../../common/lyre/api";

/** Must match src/main/lyreApi/lyreIpc.ts. */
export const LYRE_API_CALL_CHANNEL = "LYRE_API_CALL";
export const LYRE_API_EVENT_CHANNEL = "LYRE_API_EVENT";

/** What the page's `window.lyre.api` offers. */
export interface LyreApiBridge {
  call(area: string, method: string, args: unknown[]): Promise<unknown>;
  /** Every LyreApi event; returns a function that stops them. */
  onEvent(listener: (event: LyreEvent) => void): () => void;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export function createLyreApiBridge(ipc: IpcRendererLike): LyreApiBridge {
  // One listener on the channel for the whole page, handing each event to every part that subscribed (security
  // review w4): one per subscriber made Electron warn "MaxListenersExceededWarning" on every start, which would hide
  // a real leak.
  const listeners = new Set<(event: LyreEvent) => void>();
  const handler = (_event: unknown, event: unknown) => {
    if (!event || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string") return;
    for (const listener of [...listeners]) {
      try {
        listener(event as LyreEvent);
      } catch (error) {
        // As with listeners of their own: one that fails is reported and the others still hear the event.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  };
  return {
    call: (area, method, args) => ipc.invoke(LYRE_API_CALL_CHANNEL, area, method, args),
    onEvent: (listener) => {
      // A function of its own, so the same listener subscribed twice is two subscriptions.
      const one = (event: LyreEvent) => listener(event);
      if (listeners.size === 0) ipc.on(LYRE_API_EVENT_CHANNEL, handler);
      listeners.add(one);
      return () => {
        if (!listeners.delete(one)) return;
        if (listeners.size === 0) ipc.off(LYRE_API_EVENT_CHANNEL, handler);
      };
    },
  };
}
