/**
 * FND-16 (0.5.1): what the old main window kept in its own storage (`persist:root` in the Lyre page's localStorage,
 * written by redux-persist until 0.5.0) is taken over once, on the first start of 0.5.1, because nothing runs the old
 * window any more:
 * - Sound to Discord (`settings.streamingMode`) becomes this computer's setting (this-computer.json), unless this
 *   computer already has one.
 *
 * The old storage is only read, never changed, so a portable 0.4.1 copy still finds it as it was. The move is
 * recorded in `old-window.json` beside the library; with the record there it never runs again. When the page cannot
 * be read or a setting cannot be saved, nothing is recorded and the move is tried again at the next start.
 */
import fs from "fs";
import path from "path";

import { checkStreamingMode, type StreamingMode } from "../../common/domain";

/** The record's name, in the library's folder. */
export const OLD_WINDOW_RECORD = "old-window.json";

/** What Lyre takes from the old main window's storage. */
export interface OldWindowData {
  streamingMode: StreamingMode | null;
}

/** What the move recorded. */
export interface OldWindowRecord {
  /** When the move ran (ms since 1970). */
  movedAt: number;
}

export interface OldWindowMoveDeps {
  /** Where the record is kept (oldWindowRecordFile). */
  recordFile: string;
  /** The raw value of `persist:root`, or null when there is none; may reject when the page cannot be read. */
  read(): Promise<unknown>;
  /** Whether this computer's settings already hold a Sound to Discord choice. */
  hasStreamingMode(): boolean;
  /** Saves Sound to Discord as this computer's setting; false when it could not be saved. */
  setStreamingMode(mode: StreamingMode): Promise<boolean>;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}

/** Where the record is kept for the library in `libraryFolder`. */
export function oldWindowRecordFile(libraryFolder: string): string {
  return path.join(libraryFolder, OLD_WINDOW_RECORD);
}

/** redux-persist stores each part as a JSON string inside the JSON string; null for anything unreadable. */
function parsed(value: unknown): Record<string, unknown> | null {
  let out: unknown = value;
  try {
    if (typeof out === "string") out = JSON.parse(out);
  } catch {
    return null;
  }
  return out && typeof out === "object" && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
}

/** What the old window kept, from the stored value of `persist:root` (nothing for an empty or damaged value). */
export function parseOldWindowData(raw: unknown): OldWindowData {
  const root = parsed(raw);
  const settings = parsed(root?.settings) ?? {};
  return {
    streamingMode: checkStreamingMode(settings.streamingMode) ? null : (settings.streamingMode as StreamingMode),
  };
}

/** The record, or null when the move has not run (or the record is damaged, which counts as done: see below). */
export function readOldWindowRecord(file: string): OldWindowRecord | null {
  try {
    const record = parsed(fs.readFileSync(file, "utf8"));
    return { movedAt: typeof record?.movedAt === "number" ? record.movedAt : 0 };
  } catch {
    return null;
  }
}

/** Runs the move unless it is recorded as done; answers the record, or null when it must be tried again. */
export async function moveOldWindowDataOnce(deps: OldWindowMoveDeps): Promise<OldWindowRecord | null> {
  if (fs.existsSync(deps.recordFile)) return readOldWindowRecord(deps.recordFile);
  const log = deps.log ?? ((message, error) => console.error(message, error ?? ""));
  let data: OldWindowData;
  try {
    data = parseOldWindowData(await deps.read());
  } catch (error) {
    log("Could not read the old main window's settings; Lyre tries again next time it starts", error);
    return null;
  }
  if (data.streamingMode && !deps.hasStreamingMode() && !(await deps.setStreamingMode(data.streamingMode))) {
    log("Could not keep the old Sound to Discord setting; Lyre tries again next time it starts");
    return null;
  }
  const record: OldWindowRecord = { movedAt: (deps.now ?? Date.now)() };
  try {
    await fs.promises.mkdir(path.dirname(deps.recordFile), { recursive: true });
    const part = `${deps.recordFile}.part`;
    await fs.promises.writeFile(part, JSON.stringify(record, null, 2), "utf8");
    await fs.promises.rename(part, deps.recordFile);
  } catch (error) {
    log("Could not record that the old main window's settings were taken over", error);
    return null;
  }
  return record;
}
