/**
 * WP5 (w3-shell): the new interface opens as a built-in "Lyre" tab beside the old player, with the player page's
 * protections, and the old player keeps working.
 */
import fs from "fs";
import { test, expect } from "./fixtures/app";
import { findProblems } from "./fixtures/problems";
import { LYRE_PAGE_TITLE, openLyreRoute, openLyreTab } from "./fixtures/lyre";

const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test("the Lyre tab sits beside the player tab and opens the new interface", async ({ mainWindow, errors }) => {
  const tabs = mainWindow.getByRole("list", { name: "Tabs" });
  await expect(tabs.getByRole("button", { name: "Lyre Player" })).toBeVisible();
  const lyreTab = tabs.getByRole("button", { name: "Lyre", exact: true });
  await expect(lyreTab).toBeVisible();
  // The old player still opens first; the Lyre tab cannot be closed.
  await expect(tabs.getByRole("button", { name: "Lyre Player" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("button", { name: "Close tab Lyre" })).toHaveCount(0);

  const lyre = await openLyreTab(mainWindow);
  await expect(lyreTab).toHaveAttribute("aria-current", "page");
  await expect(lyre).toHaveTitle(LYRE_PAGE_TITLE);
  await expect(lyre.getByRole("main").getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible();
  await expect(lyre.getByRole("navigation", { name: "Lyre" })).toBeVisible();
  // No address bar over the app's own page.
  await expect(mainWindow.getByRole("textbox", { name: /address/i })).toHaveCount(0);
  expect(await lyre.evaluate(() => document.documentElement.dataset.theme)).toBe("candle");
  // The bundled fonts load (the page's policy allows its own font files).
  expect(
    await lyre.evaluate(async () => {
      const fonts = ["400 14px 'Atkinson Hyperlegible'", "600 18px 'Cormorant Garamond'", "600 14px 'Barlow Condensed'", "600 18px Cinzel"];
      const loaded = await Promise.all(fonts.map((font) => document.fonts.load(font)));
      return loaded.map((faces) => faces.length > 0 && faces.every((face) => face.status === "loaded"));
    }),
  ).toEqual([true, true, true, true]);
  expect(findProblems(errors)).toEqual([]);
});

test("the Lyre page has the player page's protections", async ({ mainWindow, app, errors }) => {
  const lyre = await openLyreTab(mainWindow);
  // Sandboxed with context isolation: only window.lyre reaches the page (its library calls and its audio channel).
  const exposed = await lyre.evaluate(() => {
    const page = window as unknown as Record<string, unknown>;
    const lyre = page.lyre as Record<string, Record<string, unknown>>;
    return {
      lyre: { page: lyre.page, api: Object.keys(lyre.api).sort(), audio: typeof lyre.audio },
      require: typeof page.require,
      process: typeof page.process,
    };
  });
  expect(exposed).toEqual({
    lyre: { page: "lyre", api: ["call", "onEvent"], audio: "object" },
    require: "undefined",
    process: "undefined",
  });
  // Its policy refuses inline scripts.
  await lyre.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.inlineScriptRan = true";
    document.body.append(script);
  });
  await expect.poll(() => findProblems(errors).join("\n")).toMatch(/inline script violates the following Content Security Policy directive/);
  expect(await lyre.evaluate(() => "inlineScriptRan" in window)).toBe(false);
  errors.console.length = 0;
  // Pinned to its own document: a route change is fine, leaving the page is cancelled.
  await lyre.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await lyre.waitForTimeout(500);
  expect(lyre.url()).toMatch(/lyre_window\/index\.html/);
  // It runs in the app's own session with its sandbox on, like the player page.
  const prefs = await app.evaluate(({ webContents }, title) => {
    const page = webContents.getAllWebContents().find((c) => c.getTitle() === title);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const web = (page as any)?.getLastWebPreferences?.() ?? {};
    return { found: Boolean(page), sandbox: web.sandbox, contextIsolation: web.contextIsolation, nodeIntegration: web.nodeIntegration };
  }, LYRE_PAGE_TITLE);
  expect(prefs).toEqual({ found: true, sandbox: true, contextIsolation: true, nodeIntegration: false });
  errors.console.length = 0;
});

test("routes, focus and themes work in the packaged app with no console errors or policy refusals", async ({ mainWindow, errors }) => {
  const lyre = await openLyreRoute(mainWindow, "profile/t13/sc:crown:s14:sc3");
  await expect(lyre.getByRole("main").getByRole("heading", { level: 1, name: "Audio profile" })).toBeVisible();
  // The rail's Library (the Audio profile's trail has a Library link too, round 6 part 6).
  await expect(lyre.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library", exact: true })).toHaveAttribute("aria-current", "page");

  await lyre.getByRole("link", { name: "Pad boards" }).click();
  const heading = lyre.getByRole("main").getByRole("heading", { level: 1, name: "Pad boards" });
  await expect(heading).toBeFocused();
  // Focus on the heading after a route change shows no outline (as in the prototype).
  expect(await heading.evaluate((h) => getComputedStyle(h).outlineStyle)).toBe("none");

  await lyre.getByRole("link", { name: "Look and feel" }).click();
  await lyre.getByRole("combobox", { name: "Theme" }).selectOption({ label: "Elysium (Vampire)" });
  expect(await lyre.evaluate(() => document.documentElement.dataset.theme)).toBe("elysium");
  // The choice is remembered across a restart of the page.
  await lyre.reload();
  await lyre.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
  expect(await lyre.evaluate(() => document.documentElement.dataset.theme)).toBe("elysium");

  const parchment = await openLyreRoute(mainWindow, "campaigns", "parchment");
  expect(await parchment.evaluate(() => document.documentElement.dataset.theme)).toBe("parchment");
  expect(findProblems(errors)).toEqual([]);
});

test("the shell passes axe (WCAG 2.2 A and AA, colour contrast included) in Candlelit Library and Parchment", async ({ mainWindow }) => {
  for (const theme of ["default", "parchment"] as const) {
    for (const route of ["campaigns", "look"]) {
      const lyre = await openLyreRoute(mainWindow, route, theme);
      // Run through the debugger protocol, so the page's own policy (no injected scripts) stays as it is.
      await lyre.evaluate(AXE_SOURCE);
      const violations = await lyre.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const axe = (window as any).axe;
        const run = await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return run.violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(" ")).join(", ")}`);
      });
      expect(violations, `${route} in ${theme}`).toEqual([]);
    }
  }
});

test("the old Player tab still works beside it", async ({ mainWindow, playerView, errors }) => {
  await openLyreTab(mainWindow);
  await mainWindow.getByRole("list", { name: "Tabs" }).getByRole("button", { name: "Lyre Player" }).click();
  await expect(mainWindow.getByRole("list", { name: "Tabs" }).getByRole("button", { name: "Lyre Player" })).toHaveAttribute("aria-current", "page");
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await expect(playerView.getByText("Soundboards", { exact: true })).toBeVisible();
  await playerView.getByRole("button", { name: "Add Playlist" }).first().click();
  await expect(playerView.getByRole("dialog", { name: "Add Playlist" })).toBeVisible();
  await playerView.keyboard.press("Escape");
  expect(findProblems(errors)).toEqual([]);
});
