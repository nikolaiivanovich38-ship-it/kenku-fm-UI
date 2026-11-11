/**
 * Dragging a scene or a session into the last place, in the packaged app (Nik, 0.5.0: "Dragging and dropping a scene
 * (a session) into last position doesn't work"). The row is dropped below the last one, in the rest of its box, where
 * a person lets go to put it last; only the rows took a drop before.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };

/** Drag `row` by its handle to just below `last`, inside `box` (the pane the list is in), and let go. */
async function dragBelow(page: Page, row: Locator, last: Locator, box: Locator) {
  const handle = (await row.getByTitle("Drag to reorder").boundingBox())!;
  const end = (await last.boundingBox())!;
  const pane = (await box.boundingBox())!;
  const y = Math.min(end.y + end.height + 24, pane.y + pane.height - 4);
  expect(y, "a place below the last row inside its box").toBeGreaterThan(end.y + end.height);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 30, { steps: 5 });
  await page.mouse.move(end.x + 60, y, { steps: 15 });
  await page.mouse.up();
}

test("a scene dragged below the last scene goes last", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "session/crown/s14");
  const rows = lyre.getByRole("list", { name: "Scenes in order" }).getByRole("listitem");
  await expect(rows).toHaveCount(6);
  await dragBelow(lyre, rows.nth(0), rows.nth(5), lyre.getByRole("region", { name: "Scenes", exact: true }));
  await expect(rows.nth(5)).toHaveAccessibleName("Scene 6: Recap and the coast road");
  await expect(rows.nth(0)).toHaveAccessibleName("Scene 1: Greyhollow inn");
});

test("a session dragged below the last session goes last", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "campaign/crown");
  const rows = lyre.getByRole("list", { name: "Sessions in order" }).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await dragBelow(lyre, rows.nth(0), rows.nth(3), lyre.getByRole("region", { name: "Sessions", exact: true }));
  await expect(rows.nth(3)).toContainText("Smugglers of Greyhollow");
  await expect(rows.nth(0)).toContainText("The coast road");
});
