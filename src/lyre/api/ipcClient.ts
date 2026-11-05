/**
 * LyreApi in the Lyre page, over the preload's bridge (`window.lyre.api`, preloadApi.ts). A fault (the library
 * stopped, a bug) rejects with the main process's plain words, without Electron's "Error invoking remote method"
 * wrapping.
 */
import type { LyreApi } from "../../common/lyre/api";
import { lyreApiFrom } from "../../common/lyre/rpc";
import type { LyreApiBridge } from "./preloadApi";

/** Electron's prefix on an error thrown by an invoke handler. */
const REMOTE_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

export function ipcLyreApi(bridge: LyreApiBridge): LyreApi {
  return lyreApiFrom(
    (area, method, args) =>
      bridge.call(area, method, args).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replace(REMOTE_PREFIX, ""));
      }),
    (listener) => bridge.onEvent(listener),
  );
}
