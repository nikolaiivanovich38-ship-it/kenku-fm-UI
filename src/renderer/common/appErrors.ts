/**
 * Plain-language error messages raised inside the main window's renderer,
 * shown by App in the same place as errors sent by the main process on the
 * ERROR channel. Lets a component report a problem (such as a refused
 * bookmark address, SEC-6) without prop drilling or Redux.
 */
import type { ErrorCause } from "../../common/errorCause";

type AppErrorListener = (message: string, cause?: ErrorCause) => void;

const listeners = new Set<AppErrorListener>();

/**
 * Show `message` to the user in the main window's error messages.
 * @param cause what it is about, so it closes by itself once fixed (UX finding 4)
 */
export function showAppError(message: string, cause?: ErrorCause): void {
  listeners.forEach((listener) => listener(message, cause));
}

/**
 * Receive every message passed to `showAppError`.
 * @returns a function that stops delivery
 */
export function onAppError(listener: AppErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
