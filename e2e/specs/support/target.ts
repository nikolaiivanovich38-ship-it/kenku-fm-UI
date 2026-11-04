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
import { type Page, test } from "@playwright/test";
import path from "path";
import { pathToFileURL } from "url";

export type Theme = "default" | "parchment";

/** Routes, as the prototype writes them: "live", "campaigns", "campaign/crown", "session/crown/s14", "library",
 *  "playlists", "boards", "board/abbey", "profile/t13", "profile/t13/sc:crown:s14:sc3", "outputs". */
export type Route = string;

const PROTOTYPE = pathToFileURL(path.resolve(__dirname, "../../../design/prototype/lyre-prototype.html")).href;

function isApp(): boolean {
  return test.info().project.name === "app";
}

function notBuilt(what: string): never {
  throw new Error(`target.${what}: not built yet. The app has no such screen until wave 3; implement this in e2e/specs/support/target.ts.`);
}

/** Open a screen. `theme: "default"` keeps each campaign's own table theme; "parchment" forces that theme. */
export async function openRoute(page: Page, route: Route, options: { theme?: Theme } = {}): Promise<void> {
  if (isApp()) notBuilt(`openRoute(${route})`);
  const theme = options.theme === "parchment" ? "parchment" : "campaign";
  await page.addInitScript((t) => {
    try {
      // "frame: full" and "notes: false" hide the prototype's own presentation strips.
      localStorage.setItem("lyre-r2", JSON.stringify({ theme: t, frame: "full", notes: false }));
    } catch {
      /* storage unavailable: the prototype opens in its default theme */
    }
  }, theme);
  await page.goto(`${PROTOTYPE}#${route.split("/").join("--")}`);
  await page.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
}

/** Simulate a Discord bot (by its name) joining a voice channel (by its name). Resolves when it is connected. */
export async function joinRoom(page: Page, bot: string, channel: string): Promise<void> {
  if (isApp()) notBuilt(`joinRoom(${bot}, ${channel})`);
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
  if (isApp()) notBuilt("leaveAllRooms");
  await page.evaluate(() => {
    const L = (window as any).L;
    for (const b of L.bots()) L.botLeave(b.id);
  });
}

/** CSS selectors for parts of the page that are not Lyre itself (the prototype's own strip of controls).
 *  The sweeps leave them out. The app has none. */
export function notLyre(): string[] {
  return isApp() ? [] : ["#proto", "#notes"];
}

/** Accessibility rules the PROTOTYPE is known to break, so that its run can pass while the finding stays on record
 *  (each is listed as an annotation on every sweep that hits it). The app must not break them: this is empty there.
 *  - label-content-name-mismatch (WCAG 2.5.3 Label in Name): the pad tiles on a pad board show "Thunder crack 1" but
 *    are named "Thunder crack, key 1, One-shot, row 1, column 1"; the "To: Table" choice on Live shows "To: Table" but
 *    is named "Plays in Table. Choose a room". Fix in the app by starting the accessible name with the visible words. */
export function knownAxeIssues(): string[] {
  return isApp() ? [] : ["label-content-name-mismatch"];
}

/** Layout findings the PROTOTYPE is known to have, kept on record as annotations so its run can pass. Empty for the app.
 *  - Session planner, scene open, 600 px wide: the visually hidden " (Track)" label inside a long, ellipsised item
 *    name sticks out 24 px to the right and the whole page scrolls sideways (fine from 640 px). */
export function knownLayoutIssue(screen: string, width: number, kind: "sideways" | "overlap" | "clipped"): boolean {
  return !isApp() && screen === "Session planner with a scene open" && kind === "sideways" && width < 640;
}
