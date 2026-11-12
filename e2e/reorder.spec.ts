/**
 * Dragging a scene or a session into the last place, in the packaged app (Nik, 0.5.0: "Dragging and dropping a scene
 * (a session) into last position doesn't work").
 *
 * Two ways to let go to put a row last: on the lower half of the last row, which is always there (a full list leaves
 * nothing below it, as in GitHub's window and in Nik's long lists), and below the last row, in the rest of its box,
 * when there is room. Before the drop, the line shows at the bottom of the last row, drawn inside it (not cut off).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, type LaunchedApp } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";
import { sizeWindow } from "./fixtures/screen";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };

/** The scrolling body of the pane the list is in. */
const bodyOf = (box: Locator) => box.locator(".pane-body").first();

/** The rows' names in order: a scene's accessible name, a session's name link. */
async function names(rows: Locator): Promise<string[]> {
  const out: string[] = [];
  for (const row of await rows.all()) {
    const label = await row.getAttribute("aria-label");
    const name = label ?? (await row.locator(".cp-sname").textContent()) ?? "";
    // Without the number, which changes with the order ("Scene 3: ", "Session 14: ").
    out.push(name.trim().replace(/^(Scene|Session) \d+: /, ""));
  }
  return out;
}

/** The order after moving the row at `from` to the end. */
const movedLast = (before: string[], from: number) => [...before.slice(0, from), ...before.slice(from + 1), before[from]];

/** Index of the first row (not the last) whose handle shows inside the visible part of the box. */
async function firstVisibleHandle(rows: Locator, body: Locator): Promise<number> {
  const seen = (await body.boundingBox())!;
  const count = await rows.count();
  for (let i = 0; i < count - 1; i++) {
    const handle = (await rows.nth(i).getByTitle("Drag to reorder").boundingBox())!;
    if (handle.y >= seen.y && handle.y + handle.height <= seen.y + seen.height) return i;
  }
  throw new Error("no row but the last has its handle in view");
}

/** Drag the row at `from` by its handle to the page height `y`, check the line after the last row shows, let go. */
async function dragTo(page: Page, rows: Locator, from: number, body: Locator, y: number) {
  const last = rows.last();
  const handle = (await rows.nth(from).getByTitle("Drag to reorder").boundingBox())!;
  const end = (await last.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 30, { steps: 5 });
  await page.mouse.move(end.x + 60, y, { steps: 15 });
  await expect(last, "the line shows after the last row").toHaveClass(/\bcp-drop-after\b/);
  // The line is drawn inside the row, at its bottom (as the Playlists screen's), so a box that ends right under the
  // last row cannot cut it off; the row itself shows whole.
  expect(await last.evaluate((el) => getComputedStyle(el).boxShadow), "the line is drawn inside the row").toMatch(/inset/);
  const seen = (await body.boundingBox())!;
  const shown = (await last.boundingBox())!;
  expect(shown.y + shown.height, "the last row shows whole in its box").toBeLessThanOrEqual(seen.y + seen.height + 0.5);
  await page.mouse.up();
}

/** With the last row at the bottom of its box, drop the first row whose handle shows on the last row's lower half. */
async function dropOnLowerHalfOfLast(page: Page, rows: Locator, box: Locator): Promise<string[]> {
  const body = bodyOf(box);
  await rows.last().evaluate((el) => el.scrollIntoView({ block: "end" }));
  const before = await names(rows);
  const from = await firstVisibleHandle(rows, body);
  const end = (await rows.last().boundingBox())!;
  await dragTo(page, rows, from, body, end.y + end.height * 0.75);
  return movedLast(before, from);
}

/** In a big window, drop the first row below the last one, in the empty rest of its box. */
async function dropBelowLast(launched: LaunchedApp, page: Page, rows: Locator, box: Locator): Promise<string[]> {
  await sizeWindow(launched.app, await launched.mainWindow(), 1920, 1080);
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThan(900);
  const body = bodyOf(box);
  await rows.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  const before = await names(rows);
  const end = (await rows.last().boundingBox())!;
  const seen = (await body.boundingBox())!;
  const y = Math.min(end.y + end.height + 24, seen.y + seen.height - 4);
  expect(y, "a place below the last row inside its box (the window is big enough)").toBeGreaterThan(end.y + end.height + 4);
  await dragTo(page, rows, 0, body, y);
  return movedLast(before, 0);
}

for (const kind of ["scene", "session"] as const) {
  const open = async (launchApp: (options: { env: Record<string, string> }) => Promise<LaunchedApp>) => {
    const launched = await launchApp({ env: SEEDED });
    const lyre = await openLyreRoute(await launched.mainWindow(), kind === "scene" ? "session/crown/s14" : "campaign/crown");
    const rows =
      kind === "scene"
        ? lyre.getByRole("list", { name: "Scenes in order" }).getByRole("listitem", { name: /^Scene \d+: / })
        : lyre.getByRole("list", { name: "Sessions in order" }).getByRole("listitem");
    await expect(rows).toHaveCount(kind === "scene" ? 6 : 4);
    const box = lyre.getByRole("region", { name: kind === "scene" ? "Scenes" : "Sessions", exact: true });
    return { launched, lyre, rows, box };
  };

  test(`a ${kind} dropped on the lower half of the last ${kind} goes last`, async ({ launchApp }) => {
    const { lyre, rows, box } = await open(launchApp);
    const expected = await dropOnLowerHalfOfLast(lyre, rows, box);
    await expect.poll(() => names(rows)).toEqual(expected);
  });

  test(`a ${kind} dragged below the last ${kind}, where there is room, goes last`, async ({ launchApp }) => {
    const { launched, lyre, rows, box } = await open(launchApp);
    const expected = await dropBelowLast(launched, lyre, rows, box);
    await expect.poll(() => names(rows)).toEqual(expected);
  });
}
