/**
 * The only place where the specs differ between the prototype and the real app.
 *
 * Specs use these functions for what a person cannot do from the page itself: open a screen at a given address,
 * pick the table theme before it loads, and simulate something happening in Discord (a bot joining a room).
 * Everything else a spec does is clicking, typing and reading the screen by role, accessible name and text.
 *
 * Each function has one branch per project. The `app` branches throw until wave 3 builds the screen; wave 3
 * fills them in (with the app's main window as `page`) and adds the screen to built.ts.
 */
import { _electron as electron, type ElectronApplication, type Page, test } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { openLyreRoute, openLyreTab } from "../../fixtures/lyre";
import { assertE2EBuild, findPackagedExecutable, launchArgs } from "../../fixtures/packagedApp";
import { BUILT_SCREENS } from "./built";

export type Theme = "default" | "parchment";

/** Routes, as the prototype writes them: "live", "campaigns", "campaign/crown", "session/crown/s14", "library",
 *  "playlists", "boards", "board/abbey", "profile/t13", "profile/t13/sc:crown:s14:sc3", "outputs", and (round 5)
 *  "profile/t03/ss:crown:s14", "backup", "moved", "relink", and (round 6) "settings". */
export type Route = string;

const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../design/prototype/lyre-prototype.html")).href;

function isApp(): boolean {
  return test.info().project.name === "app";
}

/** The app the running test works in (app project), for what happens in Discord rather than on the page. */
let currentApp: ElectronApplication | null = null;

/** The main process's hook for the prototype's Discord (src/main/broadcast/testing/prototypeWorld.ts). */
type OutputsTestHook = { join(bot: string, channel: string): Promise<void>; leaveAll(): void };

function runningApp(what: string): ElectronApplication {
  if (!currentApp) throw new Error(`target.${what}: no app is running`);
  return currentApp;
}

function notBuilt(what: string): never {
  throw new Error(`target.${what}: not built yet. The app has no such screen until wave 3; implement this in e2e/specs/support/target.ts.`);
}

/**
 * The app project's `page`: the Lyre page of a fresh copy of the packaged test build (CUE_DESK_E2E_BUILD=1 yarn
 * package), with its own data folder and a library seeded from the prototype's data (CUE_DESK_LYRE_SEED, honoured by
 * test builds only), Discord faked with the prototype's servers and bots (CUE_DESK_FAKE_DISCORD=prototype: Lyre Table
 * in Table, Lyre Side in no room). Closed, and its data folder removed, after the test.
 */
export async function withAppPage(use: (page: Page) => Promise<void>): Promise<void> {
  const executablePath = findPackagedExecutable();
  await assertE2EBuild(executablePath);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-spec-"));
  const { args, chromiumSandbox } = launchArgs();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  const app = await electron.launch({
    executablePath,
    args,
    chromiumSandbox,
    env: { ...env, CUE_DESK_USER_DATA_DIR: dataDir, CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype",
      // w6-rooms (SEC-4): the e2e machine has no home network; Settings › Remote control shows this address for it.
      CUE_DESK_FAKE_HOME_ADDRESS: "192.168.1.20" },
  });
  currentApp = app;
  try {
    // The app's pages are not made by Playwright's own browser, so the project's timeouts are set on them here.
    const { actionTimeout, navigationTimeout } = test.info().project.use;
    if (actionTimeout) app.context().setDefaultTimeout(actionTimeout);
    if (navigationTimeout) app.context().setDefaultNavigationTimeout(navigationTimeout);
    const main = await app.firstWindow();
    // The first-run tour stays up: openRoute marks it as seen, openFirstStart (help.spec.ts) uses it.
    const lyre = await openLyreTab(main, { keepTour: true });
    // The page the specs see is as big as in the prototype project (the config's viewport), not the window's default.
    const { viewport } = test.info().project.use;
    if (viewport) await lyre.setViewportSize(viewport);
    await use(lyre);
  } finally {
    currentApp = null;
    await app.close().catch((): void => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** The screen (spec file name, as in built.ts) a route opens: "campaign/crown" is "campaigns", "board/abbey" "pad-boards". */
export function screenOfRoute(route: Route): string {
  const first = route.split("/")[0];
  const screens: Record<string, string> = {
    campaigns: "campaigns",
    campaign: "campaigns",
    session: "session-planner",
    library: "library",
    playlists: "playlists",
    playlist: "playlists",
    boards: "pad-boards",
    board: "pad-boards",
    profile: "audio-profile",
    live: "live",
    outputs: "outputs",
    look: "look",
    // Round 5: the library as a file, the move report and Find missing files (library-files.spec.ts).
    backup: "library-files",
    moved: "library-files",
    relink: "library-files",
    // Round 6 (OUT-8): Settings in Lyre (settings.spec.ts).
    settings: "settings",
  };
  return screens[first] ?? first;
}

/**
 * Open a screen. `theme: "default"` keeps the default base theme; "parchment" makes Parchment the base. In the app a
 * campaign's own theme still shows on its pages (0.5.1); the prototype's "parchment" still forces it everywhere.
 */
export async function openRoute(page: Page, route: Route, options: { theme?: Theme } = {}): Promise<void> {
  if (isApp()) {
    // The app: choose the "Lyre" tab in the main window, then open the route in the Lyre page with the theme
    // remembered as Look and feel would (e2e/fixtures/lyre.ts). `page` is any page of the app (its main window or
    // the Lyre page); the spec then works in the Lyre page, so the app project's `page` must be the Lyre page.
    await openLyreRoute(page, route, options.theme === "parchment" ? "parchment" : "default");
    // The page opened; a screen the app does not have yet stops here, so no check can pass on its placeholder.
    const screen = screenOfRoute(route);
    if (!BUILT_SCREENS.includes(screen)) notBuilt(`openRoute(${route}): the ${screen} screen`);
    return;
  }
  const theme = options.theme === "parchment" ? "parchment" : "campaign";
  await page.addInitScript((t) => {
    try {
      // "frame: full" and "notes: false" hide the prototype's own presentation strips.
      // "tour: done": the first-run tour was seen (help.spec.ts opens a first start with openFirstStart).
      localStorage.setItem("lyre-r2", JSON.stringify({ theme: t, frame: "full", notes: false, tour: "done" }));
    } catch {
      /* storage unavailable: the prototype opens in its default theme */
    }
  }, theme);
  await page.goto(`${PROTOTYPE}#${route.split("/").join("--")}`);
  await page.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
}

/**
 * FND-8: Lyre as a person finds it on its very first start, before the first-run tour was seen (openRoute marks the
 * tour as seen). The app: the Lyre tab of a fresh copy, as withAppPage opened it. The prototype: no settings yet.
 */
export async function openFirstStart(page: Page): Promise<void> {
  if (isApp()) {
    if (!BUILT_SCREENS.includes("help")) notBuilt("openFirstStart: the help screen");
    await page.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
    return;
  }
  // No init script: one that reads storage can run before a reloaded page's storage is ready, find nothing, and
  // write over what the page saved (seen on reopen). The page's own settings are written once, then it reloads.
  await page.goto(`${PROTOTYPE}#campaigns`);
  await page.evaluate(() => localStorage.setItem("lyre-r2", JSON.stringify({ frame: "full", notes: false })));
  await Promise.all([page.waitForEvent("load"), page.evaluate(() => window.location.reload())]);
  await page.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
}

/**
 * Close and open the page again (the next start), keeping what it saved. The page reloads itself, as the app's
 * fixture does: a reload from outside could start a new page process before the old one's storage was written.
 */
export async function reopen(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.evaluate(() => window.location.reload())]);
  await page.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
}

/** Simulate a Discord bot (by its name) joining a voice channel (by its name). Resolves when it is connected. */
export async function joinRoom(page: Page, bot: string, channel: string): Promise<void> {
  if (isApp()) {
    // The fake Discord in the main process moves the bot, as a join from Discord would (w4-outputs).
    await runningApp("joinRoom").evaluate(
      (_electron, [b, c]) => (globalThis as unknown as { __lyreOutputsTest: OutputsTestHook }).__lyreOutputsTest.join(b, c),
      [bot, channel] as const,
    );
    return;
  }
  await page.evaluate(
    ([b, c]) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const L = (window as any).L;
      const theBot = L.bots().find((x: any) => x.name === b);
      for (const s of L.data.discord.servers) {
        const ch = s.channels.find((x: any) => x.name === c);
        if (ch) return L.botJoin(theBot.id, s.id, ch.id);
      }
      throw new Error(`No channel called ${c}`);
    },
    [bot, channel],
  );
  await page.waitForFunction((b) => (window as any).L.bots().find((x: any) => x.name === b).status === "connected", bot);
}

/** Simulate every bot leaving its voice channel (nobody can hear anything). */
export async function leaveAllRooms(page: Page): Promise<void> {
  if (isApp()) {
    await runningApp("leaveAllRooms").evaluate(() => (globalThis as unknown as { __lyreOutputsTest: OutputsTestHook }).__lyreOutputsTest.leaveAll());
    return;
  }
  await page.evaluate(() => {
    const L = (window as any).L;
    for (const b of L.bots()) L.botLeave(b.id);
  });
}

/** Round 6, part 5: make the next save fail, as a full or read-only drive would, to show the failed-save pop-up.
 *  The prototype has a hook for it (its strip's "Make the next save fail"); the app needs a test-build hook. */
export async function failNextSave(page: Page): Promise<void> {
  if (isApp()) {
    // w6-contracts (UX-19): the test build's library refuses its next write with "not-saved", as a full drive would.
    await runningApp("failNextSave").evaluate(() => (globalThis as unknown as { __lyreLibraryTest: { failNextWrite: () => Promise<void> } }).__lyreLibraryTest.failNextWrite());
    return;
  }
  await page.evaluate(() => (window as any).L.failNextSave());
}

/** CSS selectors for parts of the page that are not Lyre itself (the prototype's own strip of controls).
 *  The sweeps leave them out. The app has none. */
export function notLyre(): string[] {
  return isApp() ? [] : ["#proto", "#notes"];
}

/** Accessibility rules the prototype is known to break, recorded as annotations so its run can pass. None now: the
 *  Label in Name findings (pad tiles, the Live "To: <room>" choice) were fixed in the prototype. Always empty for the app. */
export function knownAxeIssues(): string[] {
  return [];
}

/** Help articles the prototype is known to have over the 300-word limit (FND-8, HELP.md), recorded as annotations so
 *  its run can pass. None now: round 6's Live draft was trimmed below 300 words (7 Nov). Kept so a future draft can be
 *  recorded the same way. */
export function knownLongHelpArticle(title: string): boolean {
  void title; // no article is known to be long now; the parameter stays for the next one
  return false;
}

/** Layout findings the prototype is known to have, recorded as annotations so its run can pass. Always none for the
 *  app. The hidden " (Track)" text that widened the session planner below 640 px was fixed in the prototype.
 *  BUG-14 (w31-fix): in the prototype too, a box header with more than fits pushes its buttons out of the box: the
 *  Library's Filters header with a filter on (Clear all) on wide windows, and the pad's box header just above 900 px.
 *  The app wraps such headers; the design stream is to fix the prototype, then this goes. */
export function knownLayoutIssue(screen: string, width: number, kind: "sideways" | "overlap" | "clipped" | "cut"): boolean {
  if (isApp() || kind !== "cut") return false;
  return screen === "Library with a filter on" || (screen === "A pad board" && width > 900 && width < 1000);
}
