/**
 * BUG-10, PLY-11: the player asks the main process to prepare a file before
 * it plays (MEDIA_PREPARE, invoke). Registered through the IPC guard (SEC-8):
 * only the player page may ask, with an address and the keepLocal choice
 * (checked in ipcChannels.ts); the address is then checked against the
 * library folders by MediaAccess before anything is read.
 *
 * The answer is `{ url }` or `{ error }` with a plain-language message. An
 * unexpected failure is logged and answered with a general message, so no
 * path or system error text reaches the page.
 */
import type { GuardedIpc } from "../security/ipcGuard";
import type { PrepareAnswer } from "./mediaCache";

export interface MediaPreparer {
  prepare(address: string, options: { keepLocal: boolean }): Promise<PrepareAnswer>;
}

const GENERAL_FAILURE = "This file could not be prepared for playing.";

/** Answer MEDIA_PREPARE from `media`. Returns a function that removes the handler. */
export function registerMediaIpc(
  ipc: GuardedIpc,
  media: MediaPreparer,
  log: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
): () => void {
  return ipc.handle("MEDIA_PREPARE", async (_event, address, options) => {
    try {
      return await media.prepare(address as string, { keepLocal: (options as { keepLocal?: boolean }).keepLocal === true });
    } catch (error) {
      log("Could not prepare a file for the player", error);
      return { error: GENERAL_FAILURE } satisfies PrepareAnswer;
    }
  });
}
