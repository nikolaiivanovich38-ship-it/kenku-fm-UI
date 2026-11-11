/**
 * w51-fix2: Nik's 0.5.0 test on Windows (11 Nov 20:33), in the packaged app. Keys are pressed on the keyboard (through
 * the X server, e2e/osKeys.ts), so the app menu and keys registered in every program act on them as they would for Nik.
 *   - "Ctrl+z does not work" (Shift+Esc did).
 *   - "F9 does nothing" (Next scene on F9, "work in other programs too" on).
 *   - "Clicking audio profile in a track in a scene in the live view crashed the app interface".
 *   - "when I kick a bot and re-add it the music doesn't come back - the on air view clears of all playing music".
 */
import type { Page } from "@playwright/test";
import { test, expect, type LaunchedApp } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";
import { focusLyrePage, pressOnKeyboard, screenPointOf } from "./osKeys";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };

async function openLive(launchApp: (o?: { env?: Record<string, string> }) => Promise<LaunchedApp>): Promise<{ launched: LaunchedApp; lyre: Page }> {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "live");
  // As big as the app specs' page (playwright.spec.config.ts), so Live has its columns and every scene in Scenes.
  await lyre.setViewportSize({ width: 960, height: 1000 });
  await expect(lyre.getByRole("button", { name: /^Start: / })).toBeVisible();
  return { launched, lyre };
}

/** Settings › Keyboard shortcuts: Next scene on `key`, and "work in other programs too" `on` or off. */
async function nextSceneKey(lyre: Page, key: string, on: boolean) {
  await lyre.evaluate(
    async ([key, on]) => {
      const call = (window as unknown as { lyre: { api: { call: (area: string, method: string, args: unknown[]) => Promise<unknown> } } }).lyre.api.call;
      await call("settings", "setShortcut", ["nextScene", key]);
      await call("settings", "setComputer", [{ globalKeys: on }]);
    },
    [key, on] as const,
  );
}

const blur = (lyre: Page) => lyre.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("Ctrl+Z on the keyboard undoes Live's scene change while its Undo shows", async ({ launchApp }) => {
  const { launched, lyre } = await openLive(launchApp);
  await lyre.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
  await lyre.getByRole("button", { name: "Next scene: Crypt ambush" }).click();
  await expect(lyre.getByRole("group", { name: "Undo" }).filter({ hasText: "Started Crypt ambush" })).toBeVisible();
  await focusLyrePage(launched.app);
  await blur(lyre);
  pressOnKeyboard(["Control_L+z"]);
  await expect(lyre.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeVisible();
});

test("Ctrl+Z on the keyboard after a click into Live (as Nik does) undoes Live's scene change", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "live");
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  // The first scene (Recap and the coast road), then the next one, which offers Undo.
  await lyre.getByRole("button", { name: /^Start: / }).first().click();
  await lyre.getByRole("button", { name: /^Next scene: / }).first().click();
  await expect(lyre.getByRole("group", { name: "Undo" }).filter({ hasText: /^Started / })).toBeVisible();
  // A real click on the page's heading, then Ctrl+Z on the keyboard: the app menu's Undo must not take it.
  pressOnKeyboard(["Control_L+z"], { click: await screenPointOf(launched.app, lyre, lyre.getByRole("heading", { level: 1 })) });
  await expect(lyre.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
});

/** The page that has the keyboard in Lyre's window: its title ("Lyre Interface" for the Lyre page). */
const keyboardPage = (app: LaunchedApp["app"]) => app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getTitle() ?? null);

test("Ctrl+Z after another program had the keyboard (Discord, as in the F9 check) undoes Live's scene change", async ({ launchApp }) => {
  const { launched, lyre } = await openLive(launchApp);
  await focusLyrePage(launched.app);
  await expect.poll(() => keyboardPage(launched.app)).toBe("Lyre Interface");
  await lyre.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
  await lyre.getByRole("button", { name: "Next scene: Crypt ambush" }).click();
  await expect(lyre.getByRole("group", { name: "Undo" }).filter({ hasText: "Started Crypt ambush" })).toBeVisible();
  await blur(lyre);
  // Another program takes the keyboard, then Lyre's window comes back to the front (a click on it in the taskbar).
  pressOnKeyboard([], { elsewhere: true });
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  await expect.poll(() => keyboardPage(launched.app), { message: "the keyboard is back in the Lyre page", timeout: 3000 }).toBe("Lyre Interface");
  pressOnKeyboard(["Control_L+z"]);
  await expect(lyre.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeVisible();
});

test("Ctrl+Z on the keyboard still undoes typing in a text field", async ({ launchApp }) => {
  const { launched, lyre } = await openLive(launchApp);
  const find = lyre.getByRole("searchbox", { name: "Find a track or playlist in the whole library" });
  await find.click();
  await focusLyrePage(launched.app);
  await find.focus();
  pressOnKeyboard(["a", "b"]);
  await expect(find).toHaveValue("ab");
  pressOnKeyboard(["Control_L+z"]);
  await expect(find).not.toHaveValue("ab");
});

test("Next scene on F9 with \"work in other programs too\" on: F9 starts the next scene, with Lyre in front or another program", async ({ launchApp }) => {
  const { launched, lyre } = await openLive(launchApp);
  await nextSceneKey(lyre, "F9", true);
  await expect.poll(() => launched.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("F9")), { message: "F9 registered in every program" }).toBe(true);
  await focusLyrePage(launched.app);
  await blur(lyre);
  pressOnKeyboard(["F9"]);
  await expect(lyre.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
  // The next-scene guard ignores a second press within a second.
  await lyre.waitForTimeout(1200);
  pressOnKeyboard(["F9"], { elsewhere: true });
  await expect(lyre.getByRole("button", { name: /^Restart scene 2: / })).toBeVisible();
});

test("Next scene on F9 in other programs, pressed while Lyre shows Settings (as the test script had it): Live opens and starts the next scene", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "settings");
  await nextSceneKey(lyre, "F9", true);
  await expect.poll(() => launched.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("F9"))).toBe(true);
  pressOnKeyboard(["F9"], { elsewhere: true });
  await expect(lyre.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
  await expect(lyre.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
});

test("Next scene on F9 with \"work in other programs too\" off: F9 works in Live", async ({ launchApp }) => {
  const { launched, lyre } = await openLive(launchApp);
  await nextSceneKey(lyre, "F9", false);
  expect(await launched.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("F9"))).toBe(false);
  await focusLyrePage(launched.app);
  await blur(lyre);
  pressOnKeyboard(["F9"]);
  await expect(lyre.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
});

test("a track's Audio profile in a scene unfolded in Live opens the Audio profile, and the music plays on", async ({ launchApp }) => {
  const { lyre } = await openLive(launchApp);
  await lyre.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
  const scenes = lyre.getByRole("region", { name: "Scenes" });
  for (const [scene, list] of [
    ["Scene 3: The abbey ruins", "The abbey ruins: music in play order"],
    ["Scene 4: Crypt ambush", "Crypt ambush: music in play order"],
  ]) {
    const name = scenes.getByRole("button", { name: scene, exact: true });
    if ((await name.getAttribute("aria-expanded")) !== "true") await name.click();
    const row = scenes.getByRole("list", { name: list }).getByRole("listitem").first();
    await row.getByRole("button", { name: /\(click for details\)$/ }).first().click();
    await row.getByRole("link", { name: /Audio profile/ }).click();
    await expect(lyre.getByRole("heading", { level: 1 })).toContainText("Audio profile");
    await expect(lyre.getByText(/Something went wrong/)).toHaveCount(0);
    await lyre.goBack();
    await expect(lyre.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
  }
  await expect(lyre.getByRole("region", { name: "On air" }).getByText("Playing").first()).toBeVisible();
});

test("kicking the only bot keeps On air's music; adding the bot back by hand plays it on in the room", async ({ launchApp }) => {
  const { lyre } = await openLive(launchApp);
  await lyre.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
  const onAir = lyre.getByRole("region", { name: "On air" });
  await expect(onAir.getByRole("group", { name: "Table" }).getByText("Playing")).toBeVisible();
  await lyre.getByRole("button", { name: "Kick Lyre Table from Table" }).click();
  // Undo is offered (Nik saw none), and No room still shows what plays.
  await expect(onAir.getByRole("group", { name: "Undo" }).filter({ hasText: "Lyre Table left Table" })).toBeVisible();
  const noRoom = onAir.getByRole("group", { name: "No room" });
  await expect(noRoom.getByText(/Eerie dread/).first()).toBeVisible();
  await noRoom.getByRole("button", { name: "Join Table" }).click();
  await expect(onAir.getByRole("group", { name: "Table" }).getByText("Playing")).toBeVisible({ timeout: 15_000 });
  await expect(onAir.getByRole("group", { name: "Table" }).getByText(/Eerie dread/).first()).toBeVisible();
});
