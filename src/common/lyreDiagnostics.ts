/**
 * FND-9: Help › Save diagnostics, between the Lyre page and the main process (src/main/diagnostics). The page asks;
 * the main process asks for a folder, writes the zip there and answers with names only, never a full path.
 */

/** Save diagnostics (invoke, no arguments): answers a DiagnosticsResult. */
export const LYRE_DIAGNOSTICS_SAVE = "LYRE_DIAGNOSTICS_SAVE";
/** Show the last saved diagnostics file in its folder (send, no arguments). */
export const LYRE_DIAGNOSTICS_SHOW = "LYRE_DIAGNOSTICS_SHOW";

export type DiagnosticsResult =
  /** `folder`: the chosen folder's own name ("Documents"); `file`: the zip's name. */
  | { ok: true; folder: string; file: string }
  /** The folder chooser was closed: nothing saved, nothing said. */
  | { ok: false; cancelled: true }
  /** Plain words for the game master. */
  | { ok: false; cancelled: false; message: string };

const short = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500;

export function isDiagnosticsResult(value: unknown): value is DiagnosticsResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) return short(v.folder) && short(v.file);
  if (v.ok !== false) return false;
  return v.cancelled === true || (v.cancelled === false && short(v.message));
}

/** What the Lyre page's `window.lyre.diagnostics` offers. */
export interface DiagnosticsBridge {
  save(): Promise<DiagnosticsResult>;
  show(): void;
}

/** The one line Help shows after saving; null when there is nothing to say (cancelled). */
export function diagnosticsResultWords(result: DiagnosticsResult): string | null {
  if (result.ok) return `Saved in ${result.folder}: ${result.file}`;
  return result.cancelled ? null : `Could not save diagnostics: ${result.message}`;
}
