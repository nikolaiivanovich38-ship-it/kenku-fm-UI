/**
 * FND-16 (0.5.1): what the old main window kept in its own storage (`persist:root` in the Lyre page's localStorage,
 * written by redux-persist until 0.5.0) is taken over once, on the first start of 0.5.1, because nothing runs the old
 * window any more:
 * - Sound to Discord (`settings.streamingMode`) becomes this computer's setting (this-computer.json), unless this
 *   computer already has one.
 * - A bot token Kenku FM (or Cue Desk 0.1) kept in plain text (`settings.discordToken`, which the old window's
 *   migration 6 moved for anyone who ran it) goes to the main process, which keeps it encrypted (SEC-5); Settings ›
 *   Discord bots says so once (`tokenMoved`, until `tokenNoteSeen`). The token itself is never written here. Only a
 *   value shaped like a bot token is handed over (CR51-6), as the old window's channel required.
 * - Once the token is saved encrypted on disk, the plain copy is taken out of `persist:root` (CR51-1), with the old
 *   Multiple Outputs switch, as the old window's migration 6 did in 0.5.0. Nothing else there changes. The plain copy
 *   stays only where this computer cannot keep tokens encrypted (the token lasts until Lyre closes; Settings says
 *   so). The fallback, a portable 0.4.1 copy, keeps its own data folder, so nothing needs the plain copy.
 * - The bookmarks (website tabs are gone from Lyre; the code stays for OUT-12) are listed, titles and addresses only,
 *   for What came across, where each can be copied.
 *
 * The move is recorded in `old-window.json` beside the library; with the record there it never runs again. When the
 * page cannot be read, a setting or the encrypted token cannot be saved, or the plain token cannot be taken out,
 * nothing is recorded and the move is tried again at the next start.
 */
import fs from "fs";
import path from "path";

import { checkStreamingMode, type StreamingMode } from "../../common/domain";
import { isBotToken } from "../../common/lyreOutputs";
import type { LegacyTokenOutcome } from "../broadcast/OutputManager";

/** The record's name, in the library's folder. */
export const OLD_WINDOW_RECORD = "old-window.json";

/** One of the old window's bookmarks: its title (the address when it had none), address, and folder if any. */
export interface OldBookmark {
  title: string;
  url: string;
  folder?: string;
}

/** What Lyre takes from the old main window's storage. */
export interface OldWindowData {
  streamingMode: StreamingMode | null;
  token: string | null;
  bookmarks: OldBookmark[];
}

/** What the move recorded. */
export interface OldWindowRecord {
  /** When the move ran (ms since 1970). */
  movedAt: number;
  bookmarks: OldBookmark[];
  /** A plain token was found and handed over. */
  tokenMoved: boolean;
  /** The game master closed the note that says so. */
  tokenNoteSeen: boolean;
}

/** Bounds on what is listed, so a damaged store cannot flood the record. */
const MAX_BOOKMARKS = 1000;
const MAX_ADDRESS = 4096;
const MAX_TITLE = 300;

export interface OldWindowMoveDeps {
  /** Where the record is kept (oldWindowRecordFile). */
  recordFile: string;
  /** The raw value of `persist:root`, or null when there is none; may reject when the page cannot be read. */
  read(): Promise<unknown>;
  /** Whether this computer's settings already hold a Sound to Discord choice. */
  hasStreamingMode(): boolean;
  /** Saves Sound to Discord as this computer's setting; false when it could not be saved. */
  setStreamingMode(mode: StreamingMode): Promise<boolean>;
  /** Hands a plain token to the bots (OutputManager.importLegacyToken), which keep it encrypted; answers what became of it. */
  importToken(token: string): LegacyTokenOutcome;
  /**
   * Replaces the stored `persist:root` with `after` (withoutPlainToken), only while it still holds `before`; false
   * when it did not. CR51-1.
   */
  forgetPlainToken(before: string, after: string): Promise<boolean>;
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

/** One line of plain text: control characters (a damaged store) become spaces. */
const oneLine = (text: string) =>
  [...text]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** The bookmarks in the order the old window showed them (Kenku FM's list, or folders since version 5). */
function bookmarksOf(value: unknown): OldBookmark[] {
  const state = parsed(value);
  const list = parsed(state?.bookmarks);
  const byId = parsed(list?.byId) ?? {};
  const folders = parsed(parsed(state?.folders)?.byId) ?? {};
  const order = Array.isArray(list?.allIds) ? (list.allIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
  const out: OldBookmark[] = [];
  for (const id of [...new Set([...order, ...Object.keys(byId)])]) {
    const mark = parsed(byId[id]);
    if (!mark || typeof mark.url !== "string") continue;
    const url = mark.url.trim();
    if (url === "" || url.length > MAX_ADDRESS) continue;
    const title = typeof mark.title === "string" ? oneLine(mark.title).slice(0, MAX_TITLE) : "";
    const folder = typeof mark.folderId === "string" ? parsed(folders[mark.folderId]) : null;
    const folderTitle = folder && typeof folder.title === "string" ? oneLine(folder.title).slice(0, MAX_TITLE) : "";
    out.push({ title: title || url, url, ...(folderTitle ? { folder: folderTitle } : {}) });
    if (out.length >= MAX_BOOKMARKS) break;
  }
  return out;
}

/** What the old window kept, from the stored value of `persist:root` (nothing for an empty or damaged value). */
export function parseOldWindowData(raw: unknown): OldWindowData {
  const root = parsed(raw);
  const settings = parsed(root?.settings) ?? {};
  const token = typeof settings.discordToken === "string" ? settings.discordToken.trim() : "";
  return {
    streamingMode: checkStreamingMode(settings.streamingMode) ? null : (settings.streamingMode as StreamingMode),
    token: isBotToken(token) ? token : null,
    bookmarks: bookmarksOf(root?.bookmarks),
  };
}

/**
 * The stored `persist:root` without the plain token and the old Multiple Outputs switch (CR51-1, as the old window's
 * migration 6 did), everything else as it was; null when there is nothing to take out.
 */
export function withoutPlainToken(raw: unknown): string | null {
  const root = parsed(raw);
  const settings = parsed(root?.settings);
  if (!root || !settings || !("discordToken" in settings || "multipleOutputsEnabled" in settings)) return null;
  const kept = { ...settings };
  delete kept.discordToken;
  delete kept.multipleOutputsEnabled;
  return JSON.stringify({ ...root, settings: JSON.stringify(kept) });
}

/** The record, or null when the move has not run. A damaged record counts as done, with nothing listed. */
export function readOldWindowRecord(file: string): OldWindowRecord | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const record = parsed(text);
  return {
    movedAt: typeof record?.movedAt === "number" ? record.movedAt : 0,
    bookmarks: Array.isArray(record?.bookmarks)
      ? (record.bookmarks as unknown[])
          .map(parsed)
          .filter((b): b is Record<string, unknown> => !!b && typeof b.url === "string" && typeof b.title === "string")
          .map((b) => ({ title: b.title as string, url: b.url as string, ...(typeof b.folder === "string" ? { folder: b.folder } : {}) }))
      : [],
    tokenMoved: record?.tokenMoved === true,
    tokenNoteSeen: record?.tokenNoteSeen === true,
  };
}

/** Writes the record beside its place and moves it in, so a crash never leaves half a file. */
async function writeRecord(file: string, record: OldWindowRecord): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  await fs.promises.writeFile(part, JSON.stringify(record, null, 2), "utf8");
  await fs.promises.rename(part, file);
}

/** The game master closed the note about the moved token: it does not show again. */
export async function markTokenNoteSeen(file: string): Promise<void> {
  const record = readOldWindowRecord(file);
  if (!record || record.tokenNoteSeen) return;
  await writeRecord(file, { ...record, tokenNoteSeen: true });
}

/** Runs the move unless it is recorded as done; answers the record, or null when it must be tried again. */
export async function moveOldWindowDataOnce(deps: OldWindowMoveDeps): Promise<OldWindowRecord | null> {
  if (fs.existsSync(deps.recordFile)) return readOldWindowRecord(deps.recordFile);
  const log = deps.log ?? ((message, error) => console.error(message, error ?? ""));
  let raw: unknown;
  let data: OldWindowData;
  try {
    raw = await deps.read();
    data = parseOldWindowData(raw);
  } catch (error) {
    log("Could not read the old main window's settings; Lyre tries again next time it starts", error);
    return null;
  }
  if (data.streamingMode && !deps.hasStreamingMode() && !(await deps.setStreamingMode(data.streamingMode))) {
    log("Could not keep the old Sound to Discord setting; Lyre tries again next time it starts");
    return null;
  }
  const outcome = data.token ? deps.importToken(data.token) : null;
  if (outcome === "not-saved") {
    log("Could not save the bot token from Kenku FM encrypted; its plain copy stays and Lyre tries again next time it starts");
    return null;
  }
  // CR51-1: the plain copy goes once Lyre's encrypted copy (or the bot's own) is on disk.
  if (outcome === "saved" || outcome === "kept-own") {
    const after = withoutPlainToken(raw);
    const forgotten = after === null || (await deps.forgetPlainToken(raw as string, after).catch((error: unknown) => (log("Could not remove Kenku FM's plain bot token", error), false)));
    if (!forgotten) {
      log("Kenku FM's plain bot token is still in Lyre's storage; Lyre tries again next time it starts");
      return null;
    }
  }
  // CR51-6: moved only when Lyre now uses it; a first bot with its own token kept that one.
  const tokenMoved = outcome === "saved" || outcome === "session-only";
  const record: OldWindowRecord = { movedAt: (deps.now ?? Date.now)(), bookmarks: data.bookmarks, tokenMoved, tokenNoteSeen: false };
  try {
    await writeRecord(deps.recordFile, record);
  } catch (error) {
    log("Could not record that the old main window's settings were taken over", error);
    return null;
  }
  return record;
}
