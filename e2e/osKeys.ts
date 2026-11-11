/**
 * Real key presses for the end-to-end tests (fixtures/osKeys.py, through the X server's XTest), and the Electron
 * focus they need. Playwright's own presses reach the page directly, so they cannot show what a key registered in
 * every program (globalShortcut) or the app menu's keys do with a real keyboard.
 */
import { test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { spawnSync } from "child_process";
import path from "path";

const SCRIPT = path.join(__dirname, "fixtures", "osKeys.py");

/**
 * Press keys as a keyboard does ("F9", "Control_L+z"). `elsewhere`: with another window in front; `click`: after a
 * click of the mouse at that place on the screen. Skips the test without an X server.
 */
export function pressOnKeyboard(keys: string[], options: { elsewhere?: boolean; click?: { x: number; y: number } } = {}): void {
  const extra = [...(options.elsewhere ? ["--elsewhere"] : []), ...(options.click ? ["--click", `${Math.round(options.click.x)},${Math.round(options.click.y)}`] : [])];
  const run = spawnSync("python3", ["-I", SCRIPT, ...extra, ...keys], { encoding: "utf8", timeout: 15_000 });
  if (run.status === 2 || run.error) test.skip(true, `Needs an X server with XTest: ${run.stderr || run.error?.message}`);
  if (run.status !== 0) throw new Error(`osKeys.py failed: ${run.stderr}`);
}

/** Bring the main window to the front with the keyboard in the Lyre page, as a click there would. */
export async function focusLyrePage(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, webContents }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Lyre") ?? BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
    webContents
      .getAllWebContents()
      .find((contents) => contents.getTitle() === "Lyre Interface")
      ?.focus();
  });
}

/** Where an element of the Lyre page is on the screen: the window's place, the Lyre view's place in it, the element's. */
export async function screenPointOf(app: ElectronApplication, lyre: Page, selector: Locator): Promise<{ x: number; y: number }> {
  const box = (await selector.boundingBox())!;
  const origin = await app.evaluate(({ BrowserWindow, webContents }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === "Lyre") ?? BrowserWindow.getAllWindows()[0];
    const content = window.getContentBounds();
    const lyreContents = webContents.getAllWebContents().find((c) => c.getTitle() === "Lyre Interface");
    const view = window.contentView.children.find((child) => (child as unknown as { webContents?: unknown }).webContents === lyreContents);
    const at = view ? view.getBounds() : { x: 0, y: 0 };
    return { x: content.x + at.x, y: content.y + at.y };
  });
  const zoom = await lyre.evaluate(() => window.devicePixelRatio || 1);
  return { x: origin.x + (box.x + box.width / 2) * (zoom >= 1 ? 1 : zoom), y: origin.y + (box.y + box.height / 2) * (zoom >= 1 ? 1 : zoom) };
}
