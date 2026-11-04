import { useEffect } from "react";

/**
 * PERF-6: tells the user when the player library could not be saved (Kenku
 * FM only wrote to the log). The storage reports the first failure of a run
 * (throttledStorage.ts); the message goes to the player's usual error message,
 * set up by the app with `useSaveErrorMessages`. A failure before the app has
 * mounted is kept and shown once it has.
 */
type Handler = (message: string) => void;

let handler: Handler | null = null;
let pending: string | null = null;

/** The text shown to the user for a failed save. */
export function saveErrorMessage(error: unknown): string {
  let reason: string;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    reason = "there is not enough storage space";
  } else {
    reason = (error instanceof Error ? error.message : String(error)).trim().replace(/\.$/, "");
  }
  return `Your changes could not be saved: ${reason}. They will be retried.`;
}

/** Called by the storage when a save fails. */
export function reportSaveError(error: unknown): void {
  const message = saveErrorMessage(error);
  if (handler) {
    handler(message);
  } else {
    pending = message;
  }
}

/** Where messages go; null stops them (they are kept until a handler is set). */
export function setSaveErrorHandler(next: Handler | null): void {
  handler = next;
  if (handler && pending !== null) {
    const message = pending;
    pending = null;
    handler(message);
  }
}

/** Shows failed saves with `onError` while the calling component is mounted. */
export function useSaveErrorMessages(onError: Handler): void {
  useEffect(() => {
    setSaveErrorHandler(onError);
    return () => {
      if (handler === onError) {
        setSaveErrorHandler(null);
      }
    };
  }, [onError]);
}
