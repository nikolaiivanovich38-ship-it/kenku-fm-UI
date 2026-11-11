/**
 * FND-4: smoke test of the packaged app. It starts, shows the Lyre page as its window (FND-16, 0.5.1), and no page
 * throws an uncaught error.
 */
import { test, expect } from "./fixtures/app";
import { findProblems } from "./fixtures/problems";

test("the window opens with the app name, on the Lyre page", async ({ mainWindow }) => {
  await expect(mainWindow).toHaveTitle("Lyre");
  await expect(mainWindow.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
});

test("no uncaught errors in the Lyre page, the capture window or the main process", async ({ app, mainWindow, errors }) => {
  await expect(mainWindow.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  // Give late start-up work (audio capture window, the bots logging in) time to fail.
  await mainWindow.waitForTimeout(3_000);
  expect(findProblems(errors)).toEqual([]);
  // The Lyre page and the hidden capture window.
  expect(app.windows().length).toBe(2);
});

test("the problem check notices a Content-Security-Policy refusal", async ({ mainWindow, errors }) => {
  await expect(mainWindow.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  // An inline script is exactly what the page's policy forbids (SEC-11).
  await mainWindow.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.inlineScriptRan = true";
    document.body.append(script);
  });
  await expect.poll(() => findProblems(errors).join("\n")).toMatch(/inline script violates the following Content Security Policy directive/);
  expect(await mainWindow.evaluate(() => "inlineScriptRan" in window)).toBe(false);
  // Forget the planted refusal so the automatic check after this test passes.
  errors.console.length = 0;
});
