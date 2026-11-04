/**
 * UX finding 4: what an error message is about, sent by the main process as
 * the second argument of the main window's "ERROR" message (or passed to
 * `showAppError` in the main window). A message with a cause closes by itself
 * once that cause is fixed; one without stays until the user closes it.
 */
export type ErrorCause =
  /** A Discord bot output (its id): closes once the bot has no problem left. */
  | { kind: "output"; id: string }
  /** An address or file that could not be opened: closes once something opens. */
  | { kind: "address" };

/** Checks a cause received over IPC, which is untrusted shape-wise. */
export function isErrorCause(value: unknown): value is ErrorCause {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const cause = value as { kind?: unknown; id?: unknown };
  return (cause.kind === "output" && typeof cause.id === "string") || cause.kind === "address";
}
