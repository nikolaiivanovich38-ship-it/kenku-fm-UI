/**
 * SEC-14: what automatic updates are doing, in words a game master understands. src/autoUpdate.ts reports each
 * step of Electron's updater here; the main window shows the first failure of a run (and nothing more until a check
 * works again, since checks repeat every 15 minutes), and the Lyre page can ask for the state (UPDATE_GET) and
 * hears each change (UPDATE_STATE), for Settings.
 */
import type { UpdateState } from "../common/appUpdates";

const AGAIN = "It tries again every 15 minutes; this version keeps working.";
const PREFIX = "Lyre could not check for updates";

/**
 * True when the update feed has nothing published: update.electronjs.org answers 404 for a repository whose releases
 * are all drafts (it skips drafts and pre-releases), and Squirrel's Update.exe then exits with "(404) Not Found".
 * That is "no update", not a fault (w51-fix2).
 */
export function isNoPublishedUpdate(error: unknown): boolean {
  return /\(404\) Not Found|HTTP Status 404/i.test(messageOf(error));
}

/**
 * One plain sentence for an updater error, without the user's folder names. On Windows Electron runs Squirrel's
 * Update.exe: "spawn … <code>" means Windows could not start it; "Command failed: <exit code>" means it ran and
 * stopped, followed by its own (.NET) error, which is read for the network cases.
 */
export function plainUpdateError(error: unknown): string {
  const raw = messageOf(error);
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN|ERR_NETWORK_CHANGED|remote name could not be resolved/i.test(raw)) {
    return `${PREFIX}: this computer seems to be offline.`;
  }
  if (/TIMED_OUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|HTTP Status 5\d\d|ERR_CONNECTION|Unable to connect to the remote server|operation has timed out|\(5\d\d\)/i.test(raw)) {
    return `${PREFIX}: the update service did not answer.`;
  }
  if (/Update\.exe/i.test(raw) && /not found|ENOENT|cannot find/i.test(raw)) {
    return `${PREFIX}: the installer's updater is missing. Install Lyre again from the latest installer to get updates.`;
  }
  if (/^spawn\b/i.test(raw)) {
    return `${PREFIX}: Windows could not run Lyre's updater. Restart the computer; if it keeps happening, install Lyre again from the latest installer.`;
  }
  const failed = /^Command failed: (\S+)/i.exec(raw);
  if (failed) {
    return `${PREFIX}: Lyre's updater stopped with an error (code ${failed[1]}).`;
  }
  const detail = (raw.split(/\r?\n/)[0] ?? "")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "…")
    .replace(/\/(home|Users)\/[^/\s]+/g, "…")
    .trim()
    .slice(0, 160);
  return detail ? `${PREFIX} (${detail}).` : `${PREFIX}.`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UpdateStatus {
  private current: UpdateState = { kind: "off", message: "Automatic updates are off in this build." };
  private listeners = new Set<(state: UpdateState) => void>();
  /** True from a failure until a check works again: the game master has been told already. */
  private told = false;

  constructor(private readonly now: () => number = Date.now) {}

  state(): UpdateState {
    return { ...this.current };
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  off(message: string) {
    this.set({ kind: "off", message });
  }

  checking() {
    this.set({ kind: "checking" });
  }

  downloading() {
    this.told = false;
    this.set({ kind: "downloading" });
  }

  upToDate() {
    this.told = false;
    this.set({ kind: "up-to-date", checkedAt: this.now() });
  }

  downloaded() {
    this.told = false;
    this.set({ kind: "ready", message: "A new version of Lyre is ready. Restart Lyre to use it." });
  }

  /** Record a failure. True when the game master should be told now (the first failure since a check worked). */
  failed(error: unknown): boolean {
    this.set({ kind: "error", message: `${plainUpdateError(error)} ${AGAIN}`, failedAt: this.now() });
    const tell = !this.told;
    this.told = true;
    return tell;
  }

  private set(state: UpdateState) {
    this.current = state;
    for (const listener of [...this.listeners]) listener(this.state());
  }
}

/** The app's one record of update progress. */
export const updateStatus = new UpdateStatus();
