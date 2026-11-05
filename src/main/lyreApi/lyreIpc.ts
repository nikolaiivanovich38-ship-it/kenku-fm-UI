/**
 * LYRE_API_CALL (WP5, SEC-8): the Lyre page's LyreApi calls, relayed to the library's own process. Registered
 * through the IPC guard: only the "lyre-view" page, only LyreApi's methods, with checked arguments
 * (ipcChannels.ts). Events go the other way on LYRE_API_EVENT (main → page; nothing to check here).
 */
import type { LyreInvoke } from "../../common/lyre/rpc";
import type { GuardedIpc } from "../security/ipcGuard";

export { MAX_CALL_BYTES } from "../security/ipcChannels";

/** Main → the Lyre page: a LyreApi event (src/lyre/preload.ts listens). */
export const LYRE_API_EVENT = "LYRE_API_EVENT";

/** Answer LYRE_API_CALL with `call`. Returns a function that removes the handler. */
export function registerLyreApiIpc(ipc: GuardedIpc, call: LyreInvoke): () => void {
  return ipc.handle("LYRE_API_CALL", (_event, area, method, args) => call(area as string, method as string, args as unknown[]));
}
