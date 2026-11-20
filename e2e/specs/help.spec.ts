/**
 * FND-8 and FND-9 (design/prototype/HELP.md, src/views/help.js): Help in the app, the first-run tour and Save
 * diagnostics. Nik (6 Nov 2026): "less text and clutter on screen"; help costs the screens nothing until asked for.
 * One Help entry at the foot of the rail, beside Look and feel, and F1. The tour: at most 5 short steps, once, on the
 * first start of the Lyre tab, Skip on every step, replayed from Help.
 */
import type { Page } from "@playwright/test";
import fs from "fs";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { knownLongHelpArticle, openFirstStart, openRoute, reopen, reportUpdate, type Theme } from "./support/target";

const helpPanel = (page: Page) => page.getByRole("complementary", { name: "Help", exact: true });
const helpButton = (page: Page) => page.getByRole("button", { name: "Help", exact: true });
const tour = (page: Page) => page.getByRole("dialog", { name: /\d of \d$/ });

const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** axe-core with the WCAG 2.2 A and AA tags, on the whole page apart from the prototype's own strips. */
async function axeProblems(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const run = await axe.run({ include: [["body"]], exclude: [["#proto"], ["#notes"]] }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return run.violations.map((v: any) => `${v.id}: ${v.nodes.length} element(s), e.g. ${v.nodes[0].target.join(" ")}`);
  }, TAGS);
}

test.describe("FND-8 the Help entry", () => {
  test("the rail has one Help entry at its foot, right under Look and feel, with its icon and its name", async ({ page }) => {
    await openRoute(page, "library");
    await expect(helpButton(page)).toHaveCount(1);
    await expect(helpButton(page)).toHaveText("Help");
    await expect(helpButton(page).locator("svg")).toHaveCount(1);
    await expect(helpButton(page)).toHaveAttribute("aria-keyshortcuts", "F1");
    const look = await page.getByRole("link", { name: "Look and feel" }).boundingBox();
    const help = await helpButton(page).boundingBox();
    expect(look && help && Math.abs(help.x - look.x) < 2 && help.y > look.y && help.y - look.y < 50).toBe(true);
  });

  test("help costs the screens nothing until asked for: no panel and no help text on any screen", async ({ page }) => {
    for (const route of ["campaigns", "library", "live"]) {
      await openRoute(page, route);
      await expect(helpPanel(page)).toHaveCount(0);
      await expect(tour(page)).toHaveCount(0);
      await expect(page.getByRole("main").getByText(/press F1|Take the tour|Save diagnostics/)).toHaveCount(0);
    }
  });

  test("Help opens a side panel with the search box focused; Esc closes it and focus goes back to Help", async ({ page }) => {
    await openRoute(page, "library");
    await helpButton(page).click();
    await expect(helpPanel(page)).toBeVisible();
    await expect(helpButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(helpPanel(page).getByRole("heading", { level: 2, name: "Help" })).toBeVisible();
    await expect(helpPanel(page).getByRole("searchbox", { name: "Search help" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(helpPanel(page)).toHaveCount(0);
    await expect(helpButton(page)).toBeFocused();
    await expect(helpButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("F1 opens Help from any screen; Close help closes it", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    await expect(helpPanel(page).getByRole("searchbox", { name: "Search help" })).toBeFocused();
    await helpPanel(page).getByRole("button", { name: "Close help" }).click();
    await expect(helpPanel(page)).toHaveCount(0);
  });

  test("the articles are grouped by task, one list per group", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    for (const group of ["Get started", "Prepare", "Run a session", "Your library"]) {
      await expect(helpPanel(page).getByRole("list", { name: group })).toBeVisible();
    }
    const start = helpPanel(page).getByRole("list", { name: "Get started" });
    await expect(start.getByRole("button", { name: "Connect Discord and add a bot to a room" })).toBeVisible();
    await expect(helpPanel(page).getByRole("list", { name: "Run a session" }).getByRole("button", { name: "Run a session in Live" })).toBeVisible();
    await expect(helpPanel(page).getByRole("list", { name: "Your library" }).getByRole("button", { name: "Save diagnostics for a bug report" })).toBeVisible();
  });

  test("round 6: Play next, Add to queue and Repeat is a fifteenth article, under Run a session", async ({ page }) => {
    // Round 6 review, Should 12 (src/lyre/help/articles/15-up-next.md): what left Live's screen is in Help.
    expectFailureUntilBuilt("shell");
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const run = helpPanel(page).getByRole("list", { name: "Run a session" });
    await expect(run.getByRole("button", { name: "Play next, Add to queue and Repeat" })).toBeVisible();
    // Round 9 added articles (16 to 21) and Set up Lyre's list: fifteen or more items now.
    expect(await helpPanel(page).getByRole("listitem").count()).toBeGreaterThanOrEqual(15);
  });

  test("an article opens in the panel with Back; Back returns to the list with focus on that article", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    await panel.getByRole("button", { name: "Run a session in Live" }).click();
    const article = panel.getByRole("article", { name: "Run a session in Live" });
    await expect(article.getByRole("heading", { level: 3, name: "Run a session in Live" })).toBeFocused();
    await expect(article).toContainText("Shift+Esc");
    await expect(article.locator("kbd", { hasText: "Space" })).toHaveCount(1);
    await panel.getByRole("button", { name: "Back", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Run a session in Live" })).toBeFocused();
  });

  test("every article is under 300 words", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    // Round 9: only the articles' lists (each named by its group), not Set up Lyre's Show me buttons.
    const titles = await panel.getByRole("list", { name: /\S/ }).getByRole("listitem").getByRole("button").allTextContents();
    // 14 articles in 0.4.1; round 6 adds a fifteenth (checked above).
    expect(titles.length).toBeGreaterThanOrEqual(14);
    for (const title of titles) {
      await panel.getByRole("button", { name: title, exact: true }).click();
      const text = await panel.getByRole("article").innerText();
      const words = text.split(/\s+/).filter(Boolean).length;
      if (knownLongHelpArticle(title)) test.info().annotations.push({ type: "known prototype issue", description: `${title}: ${words} words` });
      else expect(words, title).toBeLessThan(300);
      await panel.getByRole("button", { name: "Back", exact: true }).click();
    }
  });

  test("search finds articles by their words, and says so when nothing matches", async ({ page }) => {
    await openRoute(page, "library");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    const search = panel.getByRole("searchbox", { name: "Search help" });
    await search.fill("token");
    await expect(panel.getByRole("button", { name: "Connect Discord and add a bot to a room" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Get started" })).toHaveCount(0);
    await search.fill("shuffle repeat");
    await expect(panel.getByRole("listitem").first()).toHaveText("Shuffle and repeat in playlists and scenes");
    await search.fill("zzzz");
    await expect(panel.getByText("Nothing found. Try other words.")).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(panel.getByRole("list", { name: "Get started" })).toBeVisible();
  });

  test("Help stays open beside the screen while you move between screens and use them", async ({ page }) => {
    await openRoute(page, "library");
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "Add your music and tag it" }).click();
    await page.getByRole("link", { name: "Playlists" }).click();
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Playlists" })).toBeVisible();
    await expect(helpPanel(page).getByRole("article", { name: "Add your music and tag it" })).toBeVisible();
  });

  test("keys pressed in Help stay there: Space in an article does not start Live's next scene", async ({ page }) => {
    await openRoute(page, "live");
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "Run a session in Live" }).click();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    // Round 6 part 5: no "Scene 1 of 6" any more; the running scene is found by its Restart button.
    await expect(page.getByRole("region", { name: "Scenes", exact: true }).getByRole("button", { name: /^Restart scene 1:/ })).toHaveCount(0);
    await helpPanel(page).getByRole("button", { name: "Close help" }).click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
    await expect(page.getByRole("region", { name: "Scenes", exact: true }).getByRole("button", { name: /^Restart scene 1:/ })).toBeVisible();
  });

  for (const theme of ["default", "parchment"] as Theme[]) {
    test(`with Help open on a playlist (${theme} theme): keyboard only, no overlap, no accessibility failures`, async ({ page }) => {
      await openRoute(page, "playlists", { theme });
      await page.keyboard.press("F1");
      const panel = helpPanel(page);
      // Tab moves from the search box through the articles to the foot. Round 9: On this screen and Set up Lyre come
      // before the articles, so Tab goes on until the first article.
      const first = panel.getByRole("button", { name: "Connect Discord and add a bot to a room" });
      for (let i = 0; i < 30 && !(await first.evaluate((b) => b === document.activeElement)); i++) await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("heading", { level: 3, name: "Connect Discord and add a bot to a room" })).toBeFocused();
      expect(await axeProblems(page)).toEqual([]);
      const box = await panel.boundingBox();
      const size = page.viewportSize();
      expect(box && size && box.x >= 0 && box.x + box.width <= size.width + 1).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});

test.describe("FND-9 Save diagnostics", () => {
  test("Save diagnostics… at the foot of Help saves one zip in the chosen folder and says where", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    await panel.getByRole("button", { name: "Save diagnostics…" }).click();
    await expect(panel.getByText(/^Saved in Documents: Lyre diagnostics \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.zip$/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Show in folder" })).toBeVisible();
  });

  test("the article says what is in the file, what is taken out, and that nothing is sent", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "Save diagnostics for a bug report" }).click();
    const article = helpPanel(page).getByRole("article");
    await expect(article).toContainText("bot tokens and other secrets are taken out");
    await expect(article).toContainText("Nothing is sent anywhere");
  });
});

test.describe("FND-8 the first-run tour", () => {
  test("on the first start a short tour points at the rail; each of its 5 steps has Skip", async ({ page }) => {
    await openFirstStart(page);
    const titles: string[] = [];
    for (let step = 1; step <= 5; step++) {
      const box = page.getByRole("dialog", { name: new RegExp(` ${step} of 5$`) });
      await expect(box).toBeVisible();
      await expect(box.getByRole("button", { name: "Skip" })).toBeVisible();
      expect((await box.innerText()).split(/\s+/).length).toBeLessThan(40);
      titles.push(await box.getByRole("heading").innerText());
      await box.getByRole("button", { name: step === 5 ? "Done" : "Next" }).click();
    }
    // 0.5.2 item 23: the app's step is "Track library"; the prototype's "Library".
    expect(titles.map((t) => t.replace(/^Track library$/, "Library"))).toEqual(["The menu", "Library", "Scenes", "Live", "Now playing"]);
    await expect(tour(page)).toHaveCount(0);
  });

  test("the tour starts with focus on Next, and Back goes to the step before", async ({ page }) => {
    await openFirstStart(page);
    await expect(tour(page).getByRole("button", { name: "Next" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: /^(Track l|L)ibrary 2 of 5$/ })).toBeVisible();
    await tour(page).getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("dialog", { name: "The menu 1 of 5" })).toBeVisible();
  });

  test("Skip ends it, and it does not come back on the next start", async ({ page }) => {
    await openFirstStart(page);
    await tour(page).getByRole("button", { name: "Skip" }).click();
    await expect(tour(page)).toHaveCount(0);
    await reopen(page);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(tour(page)).toHaveCount(0);
  });

  test("Esc skips it too, and Take the tour in Help plays it again", async ({ page }) => {
    await openFirstStart(page);
    await page.keyboard.press("Escape");
    await expect(tour(page)).toHaveCount(0);
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "Take the tour" }).click();
    await expect(helpPanel(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "The menu 1 of 5" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(helpButton(page)).toBeFocused();
  });
});

/* ---------- 0.5.1 (design/prototype/ROUND8.md): update news, the version, and help for one window ----------
   The old main window showed "update ready" and the first update failure (src/autoUpdate.ts); with it gone, Lyre shows
   them in the Saved pop-up's place, bottom right. The ready note stays until dismissed; a failure shows once, as a
   warning card that says what to do. Help shows Lyre's version at its foot. */
const OFFLINE = "net::ERR_INTERNET_DISCONNECTED";

test.describe("0.5.1: update news and the version", () => {
  test.beforeEach(() => expectFailureUntilBuilt("retire"));

  test("an update that has downloaded says so at the bottom right with Restart now, and stays until dismissed", async ({ page }) => {
    await openRoute(page, "library");
    await reportUpdate(page, { kind: "downloaded" });
    const note = page.getByRole("status").filter({ hasText: "Lyre has an update. Restart Lyre to use it." });
    await expect(note).toBeVisible();
    await expect(note.getByRole("button", { name: "Restart now" })).toBeVisible();
    // In the Saved pop-up's place: the bottom right of the work area.
    const box = (await note.boundingBox())!;
    const work = (await page.locator("#view").boundingBox())!;
    expect(work.x + work.width - (box.x + box.width)).toBeLessThan(40);
    expect(work.y + work.height - (box.y + box.height)).toBeLessThan(120);
    // A Saved pop-up comes and goes; the update note stays (pop-ups go after 3 to 6 s).
    await page.waitForTimeout(6500);
    await expect(note).toBeVisible();
    await note.getByRole("button", { name: "Dismiss: Lyre has an update" }).click();
    await expect(note).toHaveCount(0);
  });

  test("an update check that fails shows the plain message once, as a warning card that says what to do", async ({ page }) => {
    await openRoute(page, "campaigns");
    await reportUpdate(page, { kind: "error", error: OFFLINE });
    const card = page.getByRole("alert").filter({ hasText: "Lyre could not check for updates: this computer seems to be offline." });
    await expect(card).toBeVisible();
    await expect(card).toContainText("It tries again every 15 minutes; this version keeps working.");
    await card.getByRole("button", { name: /^Dismiss: Lyre could not check for updates/ }).click();
    await expect(card).toHaveCount(0);
    // The checks repeat every 15 minutes: the same failure again is not shown again ...
    await reportUpdate(page, { kind: "error", error: OFFLINE });
    await page.waitForTimeout(500);
    await expect(page.getByRole("alert").filter({ hasText: "could not check for updates" })).toHaveCount(0);
    // ... until a check has worked in between.
    await reportUpdate(page, { kind: "up-to-date" });
    await reportUpdate(page, { kind: "error", error: OFFLINE });
    await expect(card).toBeVisible();
  });

  test("an update that Windows cannot install says what to do", async ({ page }) => {
    await openRoute(page, "campaigns");
    // Windows could not start Update.exe at all (since w51-fix2, "Command failed" means it ran and stopped with a code).
    await reportUpdate(page, { kind: "error", error: "spawn UNKNOWN" });
    await expect(page.getByRole("alert").filter({ hasText: "Windows could not run Lyre's updater." })).toContainText("Restart the computer");
  });

  test("Help shows Lyre's version at its foot", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    const version = panel.getByTitle("Lyre version");
    await expect(version).toHaveText(/^\d+\.\d+\.\d+/);
    await expect(panel.getByText(/^Lyre \d+\.\d+\.\d+/)).toBeVisible();
    // At the foot: under Save diagnostics….
    expect((await version.boundingBox())!.y).toBeGreaterThan((await panel.getByRole("button", { name: "Save diagnostics…" }).boundingBox())!.y);
  });
});

test.describe("0.5.1: help for Lyre as one window", () => {
  test.beforeEach(() => expectFailureUntilBuilt("retire"));

  test("no article mentions the Lyre Player tab, website tabs or remote control", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const panel = helpPanel(page);
    for (const title of await panel.getByRole("list", { name: /\S/ }).getByRole("listitem").getByRole("button").allTextContents()) {
      await panel.getByRole("button", { name: title, exact: true }).click();
      await expect(panel.getByRole("article"), title).not.toContainText(/Lyre Player|Player tab|website tab|remote control/i);
      await panel.getByRole("button", { name: "Back", exact: true }).click();
    }
  });

  test("What came across from Kenku FM says the bookmarks are listed to copy and websites can't be opened in Lyre for now", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "What came across from Kenku FM", exact: true }).click();
    const article = helpPanel(page).getByRole("article");
    await expect(article).toContainText("Copy");
    await expect(article).toContainText("Lyre cannot open websites for now");
    await expect(article).toContainText("encrypted");
    await expect(article).toContainText("Lyre has one window");
  });

  test("Connect Discord says a token from Kenku FM comes across encrypted", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    await helpPanel(page).getByRole("button", { name: "Connect Discord and add a bot to a room", exact: true }).click();
    await expect(helpPanel(page).getByRole("article")).toContainText("Kenku FM");
    await expect(helpPanel(page).getByRole("article")).toContainText("encrypted");
  });
});

/* 0.5.1 (ROUND8.md, part 3): Nik, 11 Nov 20:33, on fades and the split headset. */
test("0.5.1: Run a session in Live says Fade all takes 5 seconds; Preview or play on air says when one headset is split", async ({ page }) => {
  expectFailureUntilBuilt("retire");
  await openRoute(page, "campaigns");
  await page.keyboard.press("F1");
  await helpPanel(page).getByRole("button", { name: "Run a session in Live", exact: true }).click();
  await expect(helpPanel(page).getByRole("article")).toContainText("fades everything out over 5 seconds");
  await helpPanel(page).getByRole("button", { name: "Back", exact: true }).click();
  await helpPanel(page).getByRole("button", { name: "Preview or play on air", exact: true }).click();
  await expect(helpPanel(page).getByRole("article")).toContainText("A preview on its own plays in both ears");
});

/* Round 10 (design/prototype/ROUND10.md; Nik, 18 Nov 03:14, answer 5b: the tour, then the checklist). Built in 0.6.0. */
test.describe("round 10: the first start, and the Live tour", () => {

  test("on the first start, Done on the tour's last step opens Help at Set up Lyre", async ({ page }) => {
    await openFirstStart(page);
    for (let step = 1; step <= 5; step++) await tour(page).getByRole("button", { name: step === 5 ? "Done" : "Next" }).click();
    await expect(helpPanel(page).getByRole("heading", { name: "Set up Lyre" })).toBeVisible();
  });

  test("the Live tour shows what the players hear, only you, pads, Undo, Fade all and Stop all", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
    await helpButton(page).click();
    await helpPanel(page).getByRole("button", { name: "Tour of this screen" }).click();
    await expect(page.getByRole("dialog", { name: /Live · 1 of \d$/ })).toBeVisible();
    const titles: string[] = [];
    for (let i = 0; i < 8; i++) {
      const box = page.getByRole("dialog", { name: /Live · \d of \d$/ });
      if (!(await box.count())) break;
      titles.push((await box.getByRole("heading").innerText()).trim());
      const next = box.getByRole("button", { name: /^(Next|Done)$/ });
      const done = (await next.innerText()).trim() === "Done";
      await next.click();
      if (done) break;
    }
    expect(titles).toEqual(["Next scene", "On air: what the players hear", "Preview: only you", "Pads and their keys", "Undo", "Fade all and Stop all"]);
  });
});

/* Round 10 (design/prototype/ROUND10.md, "Nothing drawn on top of anything else"; R60-GAPS.md step 0): side panels
   sit beside the screen, which gets narrower; below 760 px of window a panel takes the whole window until it is
   closed. Help is the first panel on the app's side-panel host. */
test.describe("round 10: Help beside the screen, not over it", () => {
  test("Help opens beside the screen: the screen gets narrower, nothing of it is under Help, and closing Help gives the width back", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoute(page, "library");
    const main = page.getByRole("main");
    const before = (await main.boundingBox())!;
    await page.keyboard.press("F1");
    await expect(helpPanel(page)).toBeVisible();
    // Narrower by Help's width, less what the menu gives back when it folds to icons below 1100 px.
    await expect.poll(async () => (await main.boundingBox())!.width, { message: "the screen's width with Help open" }).toBeLessThan(before.width - 200);
    const screenBox = (await main.boundingBox())!;
    const help = (await helpPanel(page).boundingBox())!;
    expect(screenBox.x + screenBox.width, "the screen ends where Help starts").toBeLessThanOrEqual(help.x + 1);
    expect(help.x + help.width, "Help reaches the window's right edge").toBeGreaterThanOrEqual(1279);
    await helpPanel(page).getByRole("button", { name: "Close help" }).click();
    await expect.poll(async () => Math.round((await main.boundingBox())!.width)).toBe(Math.round(before.width));
  });

  test("below 760 px of window Help takes the whole window until it is closed", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await openRoute(page, "library");
    await page.keyboard.press("F1");
    await expect(helpPanel(page)).toBeVisible();
    const help = (await helpPanel(page).boundingBox())!;
    expect(Math.round(help.x)).toBeLessThanOrEqual(1);
    expect(Math.round(help.width)).toBeGreaterThanOrEqual(699);
    await page.keyboard.press("Escape");
    await expect(helpPanel(page)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  });
});

/* 0.6.0 finishing work (R60-FINISH.md, f-prep 3): Help's Tour of this screen, on every screen that has one, goes
   through that screen's whole tour, every step pointing at its control. A step whose control is not found is left out
   of the tour, so its count would come up short; the language review found the "Move a room" step left out so. The
   rooms and a track's details have no screen of their own in Help: Set up Lyre's Show me starts them. Live's tour has
   its own check above (it needs a scene running). */
test.describe("0.6.0: a tour per screen, every step finding its control", () => {
  const SETTINGS = ["Add a bot", "Your bot", "Starting volume", "Rooms"];
  const LIBRARY = ["Add tracks", "Search", "Filters", "Columns"];
  const PLAYLISTS = ["New playlist", "Sort", "Your order"];
  const SESSION = ["Add a scene", "Open a scene", "This session’s playlists"];
  const BOARD = ["Pads", "Play mode", "While it plays"];
  const DETAILS = ["Your title", "Tags", "Use it for", "At its end"];
  const ROOMS = ["Add a room", "Move a room", "Mute and volume"];

  /** Goes through the tour that is showing with Next, up to Done, and gives each step's title. */
  async function walkTour(page: Page, name: string, length: number): Promise<string[]> {
    const step = (n: number) => page.getByRole("dialog", { name: new RegExp(`${name} · ${n} of \\d+$`) });
    await expect(step(1), `${name}: the tour starts`).toBeVisible();
    await expect(step(1), `${name}: every step found its control`).toHaveAccessibleName(new RegExp(`${name} · 1 of ${length}$`));
    const titles: string[] = [];
    for (let n = 1; n <= length; n++) {
      await expect(step(n)).toBeVisible();
      titles.push((await step(n).getByRole("heading").innerText()).trim());
      await step(n).getByRole("button", { name: n === length ? "Done" : "Next", exact: true }).click();
    }
    await expect(page.getByRole("dialog", { name: /· \d+ of \d+$/ })).toHaveCount(0);
    return titles;
  }

  const SCREENS: { route: string; name: string; steps: string[]; also?: "f-live" }[] = [
    { route: "settings", name: "Settings › Discord bots", steps: SETTINGS },
    { route: "library", name: "Track library", steps: LIBRARY },
    { route: "library/t13", name: "Track library", steps: LIBRARY },
    { route: "playlists", name: "Playlists", steps: PLAYLISTS },
    { route: "playlist/p-abbess", name: "Playlists", steps: PLAYLISTS },
    { route: "campaigns", name: "Planning a session", steps: SESSION },
    { route: "campaign/crown", name: "Planning a session", steps: SESSION },
    { route: "session/crown/s14", name: "Planning a session", steps: SESSION },
    // The pad's While it plays field comes with f-live (R60-FINISH.md, f-live 1).
    { route: "boards", name: "A pad board", steps: BOARD, also: "f-live" },
    { route: "board/weather", name: "A pad board", steps: BOARD, also: "f-live" },
    { route: "profile/t13", name: "A track’s details", steps: DETAILS },
    { route: "look", name: "Look and feel", steps: ["Look and feel"] },
  ];
  for (const s of SCREENS) {
    test(`#/${s.route}: Tour of this screen goes through "${s.name}", every step on its control`, async ({ page }) => {
      if (s.also) expectFailureUntilBuilt(s.also);
      // Wide enough for the Track library's Filters to be open (folded below 1200 px of screen, as designed).
      await page.setViewportSize({ width: 1600, height: 1000 });
      await openRoute(page, s.route);
      await helpButton(page).click();
      await helpPanel(page).getByRole("button", { name: "Tour of this screen" }).click();
      expect(await walkTour(page, s.name, s.steps.length)).toEqual(s.steps);
    });
  }

  for (const [task, name, steps] of [
    ["Put the bot in a room", "Rooms in Live", ROOMS],
    ["Tag a few tracks", "A track’s details", DETAILS],
  ] as const) {
    test(`Set up Lyre's Show me for "${task}" goes through "${name}", every step on its control`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await openRoute(page, "campaigns");
      await helpButton(page).click();
      await helpPanel(page).getByRole("button", { name: new RegExp(`^Show me( again)?: ${task}$`) }).click();
      expect(await walkTour(page, name, steps.length)).toEqual([...steps]);
    });
  }

  // Round 9, item 56 (built in 0.6.0): the room's name is the button that moves it, so the step says so.
  test("Rooms in Live: the Move a room step tells you to press the room's name", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openRoute(page, "campaigns");
    await helpButton(page).click();
    await helpPanel(page).getByRole("button", { name: /^Show me( again)?: Put the bot in a room$/ }).click();
    const step = (n: number) => page.getByRole("dialog", { name: new RegExp(`Rooms in Live · ${n} of ${ROOMS.length}$`) });
    await step(1).getByRole("button", { name: "Next", exact: true }).click();
    await expect(step(2)).toContainText("Move a room");
    await expect(step(2)).toContainText("Press the room’s name to move the room to another channel or make its bot leave. From the same menu you can copy what another room plays.");
  });
});

/* 0.6.0 usability test (/root/kenku-wt/R60-USABILITY.md, F-P11): when a side panel closes another to keep the screen's
   room (kit/sidePanelRoom.ts), a short line says so on screen and to a screen reader. */
test("0.6.0 usability test, F-P11: a side panel that closes another says so", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRoute(page, "playlist/p-abbess/t41");
  await expect(page.getByRole("complementary").first()).toBeVisible();
  await page.keyboard.press("F1");
  await expect(helpPanel(page)).toBeVisible();
  const words = "The Track panel closed to make room for Help.";
  await expect(page.getByRole("status").filter({ hasText: words })).toBeVisible();
  await expect
    .poll(() => page.evaluate((t) => Array.from(document.querySelectorAll("[aria-live], [role=status], [role=alert]")).filter((e) => e.getAttribute("aria-live") !== "off" && (e.textContent ?? "").includes(t)).length, words))
    .toBeGreaterThan(0);
});
