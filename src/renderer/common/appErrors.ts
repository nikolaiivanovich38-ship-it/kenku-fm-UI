/**
 * Plain-language error messages raised inside the main window's renderer,
 * shown by App in the same error message box as errors sent by the main
 * process on the ERROR channel. Lets a component report a problem (such as
 * a refused bookmark address, SEC-6) without prop drilling or Redux.
 */

type AppErrorListener = (message: string) => void;

const listeners = new Set<AppErrorListener>();

/** Show `message` to the user in the main window's error message box. */
export function showAppError(message: string): void {
  listeners.forEach((listener) => listener(message));
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
