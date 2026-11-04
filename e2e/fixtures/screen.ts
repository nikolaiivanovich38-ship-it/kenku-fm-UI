/**
 * Checks of what the user actually sees in the main window.
 *
 * Website tabs and the player are WebContentsViews that Electron draws on top
 * of the main window's page. Playwright only sees the page, so a dialog can be
 * "visible" to Playwright while a view covers it on screen (UX review finding
 * 1: the "Add a second bot" test passed while the dialog was hidden). These
 * helpers ask the main process which views are drawn, and where, and check
 * that an element is in the window, not under a view, and not under another
 * part of the page.
 */
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect } from "./app";

export type Rect = { x: number; y: number; width: number; height: number };

/** Where the website or player views are drawn in the main window right now. */
export function drawnViews(app: ElectronApplication): Promise<Rect[]> {
  return app.evaluate(({ BrowserWindow }) => {
    // The main window is the visible one; the audio capture window is hidden.
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    if (!window) {
      return [];
    }
    return window.contentView.children.filter((view) => view.getVisible()).map((view) => view.getBounds());
  });
}

function overlaps(a: Rect, b: Rect): boolean {
  // One pixel of slack for rounding between the page and the window.
  return a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height;
}

/**
 * The element is fully inside the window, no website or player view is
 * drawn over any part of it, and the page shows it at its centre (no other
 * part of the page lies on top of it).
 */
export async function expectOnScreen(app: ElectronApplication, page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeInViewport({ ratio: 1 });
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) {
          return ["no box"];
        }
        return (await drawnViews(app)).filter((view) => overlaps(box, view)).map((view) => JSON.stringify(view));
      },
      { message: "no website or player view is drawn over the element" },
    )
    .toEqual([]);
  const onTop = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && (element === hit || element.contains(hit));
  });
  expect(onTop, "nothing else on the page covers the element").toBe(true);
}

/** Resize the main window (the review used 800 × 600 and 1920 × 1080). */
export async function sizeWindow(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      window?.setPosition(0, 0);
      window?.setSize(w, h);
    },
    [width, height] as const,
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

/** Text that is cut off (ellipsis or overflow) inside the element, if any. */
export function clippedText(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) => {
    const clipped: string[] = [];
    for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
      const text = element.textContent?.trim() ?? "";
      if (text !== "" && element.children.length === 0 && element.scrollWidth > element.clientWidth + 1) {
        clipped.push(text);
      }
    }
    return clipped;
  });
}

/**
 * How many pixels of the keyboard focus outline's gold (#ffd866) are drawn
 * around the element, from a screenshot of the page.
 */
export async function focusRingPixels(page: Page, locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) {
    return 0;
  }
  const margin = 6;
  const clip = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };
  const png = await page.screenshot({ clip });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (Math.abs(r - 0xff) < 30 && Math.abs(g - 0xd8) < 30 && Math.abs(b - 0x66) < 40) {
        count += 1;
      }
    }
    return count;
  }, png.toString("base64"));
}
