/**
 * SEC-14: what the Lyre page may know about automatic updates (src/main/updateStatus.ts keeps it), so Settings
 * (round 7) can show the last problem in plain words.
 */

/** Answers an UpdateState (invoke, no arguments). */
export const UPDATE_GET = "UPDATE_GET";
/** Main process to the Lyre page after every change: one UpdateState. */
export const UPDATE_STATE = "UPDATE_STATE";

export type UpdateState =
  /** No automatic updates in this copy; `message` says why. */
  | { kind: "off"; message: string }
  | { kind: "checking" }
  /** The last check found nothing newer; `checkedAt` in ms since 1970. */
  | { kind: "up-to-date"; checkedAt: number }
  /** A newer version is downloading. */
  | { kind: "downloading" }
  | { kind: "ready"; message: string }
  /** The last check or download failed; `message` in plain words. */
  | { kind: "error"; message: string; failedAt: number };

export function isUpdateState(value: unknown): value is UpdateState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const text = (item: unknown) => typeof item === "string" && item.length <= 500;
  switch (v.kind) {
    case "off":
    case "ready":
      return text(v.message);
    case "checking":
    case "downloading":
      return true;
    case "up-to-date":
      return typeof v.checkedAt === "number";
    case "error":
      return text(v.message) && typeof v.failedAt === "number";
    default:
      return false;
  }
}

/** What `window.lyre.updates` offers. */
export interface UpdatesBridge {
  get(): Promise<UpdateState>;
  /** Called with each new state; returns a function that stops listening. */
  onChange(listener: (state: UpdateState) => void): () => void;
}
