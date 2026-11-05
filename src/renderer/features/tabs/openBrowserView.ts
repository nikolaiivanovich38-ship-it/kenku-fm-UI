import type { BrowserViewKind } from "../../../preload/managers/BrowserViewManagerPreload";
import { getBounds } from "./getBounds";
import type { Tab } from "./tabsSlice";

/**
 * True for an id of a view the main process actually created. Electron's
 * webContents ids are positive integers; the main process answers a refused
 * request with -1 (`REFUSED_VIEW_ID`), which is also the player's "not
 * created yet" id, so it must never reach the tabs or player state.
 */
export function isCreatedViewId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

/**
 * Ask the main process for a new website view (or, with kind `"player"` or
 * `"lyre"`, the player view or the new interface) filling the content area.
 * @returns the new view's id, or undefined when the request was refused
 */
export async function openBrowserView(
  url: string,
  kind?: BrowserViewKind,
): Promise<number | undefined> {
  const bounds = getBounds();
  const id = await window.kenku.createBrowserView(
    url,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    kind,
  );
  if (!isCreatedViewId(id)) {
    console.error(`The view for ${url || "a new tab"} was not created`);
    return undefined;
  }
  return id;
}

/**
 * SEC-15: ask the main process to open a file from the user's computer in a
 * tab of its own. The main process asks the user first, so a refusal is
 * usually the user saying no and is not an error.
 * @returns the new view's id, or undefined when nothing was opened
 */
export async function openLocalFileView(url: string): Promise<number | undefined> {
  const bounds = getBounds();
  const id = await window.kenku.openLocalFile(
    url,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );
  return isCreatedViewId(id) ? id : undefined;
}

/** SEC-15: a first title for a file's tab, until the page names itself: the file name. */
export function fileTabTitle(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "File";
  } catch {
    return "File";
  }
}

/**
 * Open an address the user chose (address bar, bookmark) in a new view:
 * a website tab, or (SEC-15) a file's tab once the main process has asked.
 * @returns the new tab, not yet added to the tab bar, or undefined when nothing opened
 */
export async function openAddressInNewView(
  address: { ok: true; url: string } | { ok: "ask"; kind: "local-file"; url: string },
  title?: string,
  icon = "",
): Promise<Tab | undefined> {
  const local = address.ok === "ask";
  const id = local ? await openLocalFileView(address.url) : await openBrowserView(address.url);
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    url: address.url,
    title: title ?? (local ? fileTabTitle(address.url) : "New Tab"),
    icon,
    playingMedia: 0,
    muted: false,
    ...(local ? { kind: "local-file" as const } : {}),
  };
}
