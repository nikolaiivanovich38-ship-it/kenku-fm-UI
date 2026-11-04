/**
 * FND-4: smoke test of the packaged app. It starts, shows the main window and
 * the player, and no page throws an uncaught error.
 */
import { test, expect } from "./fixtures/app";
import { findProblems } from "./fixtures/problems";

test("main window opens with the app name", async ({ mainWindow }) => {
  await expect(mainWindow).toHaveTitle("Lyre");
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
  expect(findProblems(errors)).toEqual([]);
  expect(app.windows().length).toBeGreaterThanOrEqual(2);
});

test("the problem check notices a Content-Security-Policy refusal", async ({ playerView, errors }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  // An inline script is exactly what the player's policy forbids (SEC-11).
  await playerView.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.inlineScriptRan = true";
    document.body.append(script);
  });
  await expect.poll(() => findProblems(errors).join("\n")).toMatch(/inline script violates the following Content Security Policy directive/);
  expect(await playerView.evaluate(() => "inlineScriptRan" in window)).toBe(false);
  // Forget the planted refusal so the automatic check after this test passes.
  errors.console.length = 0;
});
