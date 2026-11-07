/**
 * FND-8 and FND-9 (design/prototype/HELP.md, src/views/help.js): Help in the app, the first-run tour and Save
 * diagnostics. Nik (6 Nov 2026): "less text and clutter on screen"; help costs the screens nothing until asked for.
 * One Help entry at the foot of the rail, beside Look and feel, and F1. The tour: at most 5 short steps, once, on the
 * first start of the Lyre tab, Skip on every step, replayed from Help.
 */
import type { Page } from "@playwright/test";
import fs from "fs";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { knownLongHelpArticle, openFirstStart, openRoute, reopen, type Theme } from "./support/target";

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
    await expect(start.getByRole("button", { name: "Connect Discord and bring a bot into a room" })).toBeVisible();
    await expect(helpPanel(page).getByRole("list", { name: "Run a session" }).getByRole("button", { name: "Run a session in Live" })).toBeVisible();
    await expect(helpPanel(page).getByRole("list", { name: "Your library" }).getByRole("button", { name: "Save diagnostics for a bug report" })).toBeVisible();
  });

  test("round 6: Play next, Add to queue and Repeat is a fifteenth article, under Run a session", async ({ page }) => {
    // Round 6 review, Should 12 (design/prototype/help-drafts/15-up-next.md): what left Live's screen is in Help.
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "campaigns");
    await page.keyboard.press("F1");
    const run = helpPanel(page).getByRole("list", { name: "Run a session" });
    await expect(run.getByRole("button", { name: "Play next, Add to queue and Repeat" })).toBeVisible();
    await expect(helpPanel(page).getByRole("listitem")).toHaveCount(15);
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
    const titles = await panel.getByRole("listitem").getByRole("button").allTextContents();
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
    await expect(panel.getByRole("button", { name: "Connect Discord and bring a bot into a room" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Get started" })).toHaveCount(0);
    await search.fill("shuffle repeat");
    await expect(panel.getByRole("listitem").first()).toHaveText("Shuffle and repeat per place");
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
      // Tab moves from the search box through the articles to the foot.
      await page.keyboard.press("Tab");
      await expect(panel.getByRole("button", { name: "Connect Discord and bring a bot into a room" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("heading", { level: 3, name: "Connect Discord and bring a bot into a room" })).toBeFocused();
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
    expect(titles).toEqual(["Lyre's places", "Library", "Scenes", "Live", "Now playing"]);
    await expect(tour(page)).toHaveCount(0);
  });

  test("the tour starts with focus on Next, and Back goes to the step before", async ({ page }) => {
    await openFirstStart(page);
    await expect(tour(page).getByRole("button", { name: "Next" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Library 2 of 5" })).toBeVisible();
    await tour(page).getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("dialog", { name: "Lyre's places 1 of 5" })).toBeVisible();
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
    await expect(page.getByRole("dialog", { name: "Lyre's places 1 of 5" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(helpButton(page)).toBeFocused();
  });
});
