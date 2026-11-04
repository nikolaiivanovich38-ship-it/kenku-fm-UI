/**
 * FND-4: smoke test of the packaged app. It starts, shows the main window and
 * the player, and no page throws an uncaught error.
 */
import { test, expect } from "./fixtures/app";

test("main window opens with the app name", async ({ mainWindow }) => {
  await expect(mainWindow).toHaveTitle("Cue Desk");
});

test("player tab shows the Playlists and Soundboards sections", async ({ mainWindow, playerView }) => {
  // The tab label follows the player page's title once it has loaded.
  await expect(mainWindow.getByText(/Player$/).first()).toBeVisible();
  // The section titles are not heading elements yet, so match their exact text.
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await expect(playerView.getByText("Soundboards", { exact: true })).toBeVisible();
});

test("no uncaught errors in the main window, player or main process", async ({ app, mainWindow, playerView, errors }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  // Give late start-up work (audio capture window, remote API) time to fail.
  await mainWindow.waitForTimeout(3_000);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.mainProcess).toEqual([]);
  expect(app.windows().length).toBeGreaterThanOrEqual(2);
});
