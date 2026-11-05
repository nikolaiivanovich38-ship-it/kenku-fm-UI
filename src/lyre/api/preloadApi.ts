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
  return {
    call: (area, method, args) => ipc.invoke(LYRE_API_CALL_CHANNEL, area, method, args),
    onEvent: (listener) => {
      const handler = (_event: unknown, event: unknown) => {
        if (event && typeof event === "object" && typeof (event as { type?: unknown }).type === "string") listener(event as LyreEvent);
      };
      ipc.on(LYRE_API_EVENT_CHANNEL, handler);
      return () => {
        ipc.off(LYRE_API_EVENT_CHANNEL, handler);
      };
    },
  };
}
