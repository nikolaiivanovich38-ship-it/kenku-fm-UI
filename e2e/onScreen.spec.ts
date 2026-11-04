/**
 * UX review findings 1, 7, 8 and 10: dialogs, menus, Settings and error
 * messages are really on screen, not hidden behind the website or player
 * view that Electron draws over the main window. Checked at 800 × 600 and
 * 1920 × 1080 against where the main process actually draws the views
 * (fixtures/screen.ts), not only in the page's DOM.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";
import { clippedText, drawnViews, expectOnScreen, sizeWindow } from "./fixtures/screen";

let site: LocalSite;
test.beforeEach(async () => {
  site = await startLocalSite({ "/one": { title: "Page One", body: "<h1>One</h1>" } });
});
test.afterEach(async () => {
  await site.close();
});

const sidebar = (mainWindow: Page) => mainWindow.getByRole("navigation", { name: "Sidebar" });

async function openSettings(mainWindow: Page) {
  await mainWindow.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

for (const [width, height] of [
  [800, 600],
  [1920, 1080],
] as const) {
  test(`the "Add a second bot" guide is on screen at ${width} × ${height}, and the player comes back after it (finding 1)`, async ({
    app,
    mainWindow,
    playerView,
  }) => {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    await sizeWindow(app, mainWindow, width, height);
    const settings = await openSettings(mainWindow);
    await settings.getByRole("button", { name: "Add a second bot" }).click();
    const guide = mainWindow.getByRole("dialog", { name: "Add a second bot" });
    await expectOnScreen(app, mainWindow, guide);
    await expectOnScreen(app, mainWindow, guide.getByRole("button", { name: "Cancel" }));
    await expectOnScreen(app, mainWindow, guide.getByRole("button", { name: "Add bot" }));

    await guide.getByRole("button", { name: "Cancel" }).click();
    await expect(guide).toHaveCount(0);
    // Settings is still open: the player is back, beside it.
    await expect.poll(async () => (await drawnViews(app)).length).toBe(1);
    const panel = await settings.boundingBox();
    expect((await drawnViews(app))[0].x).toBeGreaterThanOrEqual(Math.floor(panel!.x + panel!.width));
  });
}

test("Settings grows with the window, moves the player aside, and cuts nothing off (finding 8)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await sizeWindow(app, mainWindow, 800, 600);
  let settings = await openSettings(mainWindow);
  await expect.poll(async () => Math.round((await settings.boundingBox())!.width)).toBe(320);
  await expect.poll(async () => (await drawnViews(app))[0]?.x).toBe(320);
  await expectOnScreen(app, mainWindow, settings.getByRole("button", { name: "Done" }));
  expect(await clippedText(settings)).toEqual([]);

  // Each streaming mode says how it differs, in full.
  await settings.getByRole("combobox", { name: "Mode" }).click();
  const options = mainWindow.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("Clearer sound");
  await expectOnScreen(app, mainWindow, options.last());
  expect(await clippedText(mainWindow.getByRole("listbox"))).toEqual([]);
  await mainWindow.keyboard.press("Escape");
  await expect(options).toHaveCount(0);

  await settings.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => (await drawnViews(app))[0]?.x).toBe(240);

  await sizeWindow(app, mainWindow, 1920, 1080);
  settings = await openSettings(mainWindow);
  await expect.poll(async () => Math.round((await settings.boundingBox())!.width)).toBe(440);
  await expect.poll(async () => (await drawnViews(app))[0]?.x).toBe(440);
});

test("the bookmark folder menu is shown in full over a website (finding 10)", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await sizeWindow(app, mainWindow, 800, 600);
  await sidebar(mainWindow).getByRole("button", { name: "New bookmark folder" }).click();
  await mainWindow.getByRole("dialog", { name: "New folder" }).getByRole("button", { name: "Done" }).click();
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  const address = mainWindow.getByLabel("Web address");
  await address.fill(site.url("/one"));
  await address.press("Enter");
  await pageWithTitle(app, "Page One");

  await sidebar(mainWindow).getByRole("button", { name: "Options for folder New folder" }).click();
  const remove = mainWindow.getByRole("menuitem", { name: "Delete folder (keeps its bookmarks)" });
  await expectOnScreen(app, mainWindow, remove);
  expect(await clippedText(mainWindow.getByRole("menu"))).toEqual([]);
  await mainWindow.keyboard.press("Escape");
  // The website is shown again once the menu has closed.
  await expect.poll(async () => (await drawnViews(app)).length).toBe(1);
});

test("a file that is not there is explained in the sidebar, opens no tab, and the message goes once a page opens (findings 1, 4, 7)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await sizeWindow(app, mainWindow, 800, 600);
  const missing = pathToFileURL(path.join(fs.realpathSync(os.tmpdir()), "no-such-folder", "map.html")).href;
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  const tabs = mainWindow.getByRole("list", { name: "Tabs" }).getByRole("listitem");
  const tabCount = await tabs.count();
  const address = mainWindow.getByLabel("Web address");
  await address.fill(missing);
  await address.press("Enter");

  const alert = mainWindow.getByRole("alert");
  await expect(alert).toHaveText("Can't find this file. Check the name and folder.");
  await expectOnScreen(app, mainWindow, alert);
  await expect(sidebar(mainWindow)).toContainText("Can't find this file.");
  await mainWindow.waitForTimeout(500);
  await expect(tabs).toHaveCount(tabCount);

  // Collapsed sidebar: the message gets a column of its own, and the view moves right of it.
  await sidebar(mainWindow).getByRole("button", { name: "Collapse sidebar" }).click();
  await expectOnScreen(app, mainWindow, alert);
  const box = await alert.boundingBox();
  await expect.poll(async () => (await drawnViews(app))[0]?.x).toBeGreaterThanOrEqual(Math.floor(box!.x + box!.width));
  await sidebar(mainWindow).getByRole("button", { name: "Expand sidebar" }).click();

  // Fixed: a page opens, and the message closes by itself.
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await address.fill(site.url("/one"));
  await address.press("Enter");
  await pageWithTitle(app, "Page One");
  await expect(alert).toHaveCount(0);
});

test("at 800 px, no scrollbar is drawn over the tab titles, and the tab in front is in view (minor finding)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await sizeWindow(app, mainWindow, 800, 600);
  for (let i = 0; i < 4; i++) {
    await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  }
  const strip = mainWindow.getByRole("list", { name: "Tabs" });
  // More tabs than fit: the strip scrolls sideways…
  await expect.poll(() => strip.evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true);
  // …without a scrollbar taking any of its height.
  expect(await strip.evaluate((list) => (list as HTMLElement).offsetHeight - list.clientHeight)).toBe(0);
  const front = strip.locator('[aria-current="page"]');
  await expect(front).toBeInViewport({ ratio: 1 });
});
