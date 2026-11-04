/**
 * Campaigns: the top level (all campaigns, one campaign with its sessions, playlists and pad boards).
 * Source: design/prototype/tools/cp-tab.js and src/views/campaigns.js.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const dialog = (page: Page) => page.getByRole("dialog");

test.describe("all campaigns", () => {
  test("every campaign shows its next session and a Run next session button", async ({ page }) => {
    await openRoute(page, "campaigns");
    await expect(page.getByRole("article")).toHaveCount(3);
    const crown = page.getByRole("article", { name: "The Sunken Crown" });
    await expect(crown).toContainText("Session 14: The Drowned Abbey");
    await expect(crown.getByRole("button", { name: "Run next session of The Sunken Crown: Session 14" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Ash and Masks" })).toContainText("Session 7: Elysium at the opera");
  });

  test("Run next session opens Live with that session ready to start", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.getByRole("button", { name: "Run next session of The Sixth Year: Session 4" }).click();
    await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeAttached();
    await expect(page.getByRole("button", { name: /The Sixth Year Session 4/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start: / })).toBeVisible();
  });

  test("New campaign asks for a name, game system, one-line description and theme, with Candlelit Library as the default", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.getByRole("button", { name: "New campaign" }).click();
    const sheet = dialog(page);
    await expect(sheet.getByRole("textbox", { name: "Name" })).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "Game system" })).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "Description (one line)" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /Candlelit Library/ })).toBeChecked();
    await expect(sheet.getByText(/Obsidian/).first()).toBeVisible();
    await sheet.getByRole("textbox", { name: "Name" }).fill("Harbour lights");
    await sheet.getByRole("button", { name: "Create campaign" }).click();
    await expect(page.getByRole("heading", { name: "Harbour lights", level: 1 })).toBeVisible();
  });

  test("Esc closes the New campaign sheet and nothing is added", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.getByRole("button", { name: "New campaign" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(3);
  });
});

test.describe("one campaign", () => {
  test("a Prep | Live switch sits at the top, with Prep pressed, and Live opens the live screen for this campaign", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const modes = page.getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
  });

  test("Run next session sits beside the switch and starts the next session in Live", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await page.getByRole("button", { name: /^Run next session/ }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
  });

  test("name, game system, theme and description can be edited on the page", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("The Sunken Crown");
    await expect(page.getByRole("combobox", { name: "Game system" })).toBeVisible();
    const theme = page.getByRole("main").getByRole("combobox", { name: "Theme" });
    expect(await theme.evaluate((s) => (s as HTMLSelectElement).selectedOptions[0].label)).toBe("Hearth and Iron");
    await page.getByRole("textbox", { name: "Name" }).fill("The Sunken Crown (revised)");
    await expect(page.getByRole("heading", { name: "The Sunken Crown (revised)", level: 1 })).toBeVisible();
  });

  test("changing the campaign's theme changes how the page looks", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor + getComputedStyle(document.getElementById("view") ?? document.body).backgroundColor);
    const before = await background();
    await page.getByRole("main").getByRole("combobox", { name: "Theme" }).selectOption({ label: "Parchment" });
    await expect.poll(background).not.toBe(before);
  });

  test("New session adds a draft session and opens it", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await page.getByRole("button", { name: "New session" }).click();
    await expect(page.getByRole("heading", { name: "Session 16", level: 1 })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue(/draft/i);
  });

  test("Obsidian has a Coming later placeholder", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await expect(region(page, "Obsidian").getByText("Coming later")).toBeVisible();
  });
});

test.describe("sessions of a campaign", () => {
  test("every session has a Run button; played sessions can be run again", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const sessions = page.getByRole("list", { name: "Sessions in order" });
    await expect(sessions.getByRole("listitem")).toHaveCount(4);
    for (const run of [/^Run Session 12/, /^Run Session 13/, /^Run Session 14/, /^Run Session 15/]) {
      await expect(sessions.getByRole("button", { name: run })).toBeVisible();
    }
    await expect(sessions.getByRole("button", { name: /Run Session 12.*again/ })).toBeVisible();
  });

  test("the Run button of the next session looks different from the others (the others are grey)", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const sessions = page.getByRole("list", { name: "Sessions in order" });
    const look = (name: RegExp) =>
      sessions.getByRole("button", { name }).evaluate((b) => {
        const s = getComputedStyle(b);
        return `${s.backgroundColor}|${s.color}|${s.borderColor}`;
      });
    const next = await look(/^Run Session 14/);
    expect(await look(/^Run Session 12/)).not.toBe(next);
    expect(await look(/^Run Session 13/)).toBe(await look(/^Run Session 12/));
  });

  test("running a played session again opens it in Live", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await page.getByRole("button", { name: /^Run Session 12/ }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 12/ })).toBeVisible();
  });

  test("each session shows its date and whether it is Played, Next or Draft", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const rows = page.getByRole("list", { name: "Sessions in order" }).getByRole("listitem");
    await expect(rows.nth(0)).toContainText("Played");
    await expect(rows.nth(2)).toContainText("Next");
    await expect(rows.nth(3)).toContainText("Draft");
    await expect(rows.nth(2)).toContainText("Thu 5 Nov 2026");
  });

  test("making another session Next leaves exactly one Next", async ({ page }) => {
    await openRoute(page, "session/crown/s15");
    await page.getByRole("combobox", { name: "Status" }).selectOption({ label: "Next" });
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "The Sunken Crown" }).click();
    await expect(page.getByRole("list", { name: "Sessions in order" }).getByText("Next", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Sessions in order" }).getByRole("listitem").nth(3)).toContainText("Next");
  });
});

test.describe("playlists and pad boards on hand in every session", () => {
  test("a campaign playlist's tracks are hidden until its expander is opened", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const playlists = region(page, "Campaign playlists");
    await expect(playlists.getByRole("list", { name: "Tracks in The Company themes" })).toHaveCount(0);
    await playlists.getByRole("button", { name: "Show contents of The Company themes" }).click();
    await expect(playlists.getByRole("list", { name: "Tracks in The Company themes" }).getByRole("listitem")).toHaveCount(6);
    await playlists.getByRole("button", { name: "Hide contents of The Company themes" }).click();
    await expect(playlists.getByRole("list", { name: "Tracks in The Company themes" })).toHaveCount(0);
  });

  test("a campaign playlist can be listened to (Preview) before and while it is chosen, and stopped again", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const playlists = region(page, "Campaign playlists");
    await playlists.getByRole("button", { name: "Preview The Company themes" }).click();
    await expect(playlists.getByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await playlists.getByRole("button", { name: "Stop preview of The Company themes" }).click();
    await expect(playlists.getByRole("button", { name: "Preview The Company themes" })).toBeVisible();
  });

  test("Play on air from a campaign playlist shows the bar of what the players hear, with Stop and Go to Live", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await region(page, "Campaign playlists").getByRole("button", { name: "Play on air: The Company themes" }).click();
    const bar = region(page, "On air");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Go to Live" })).toBeVisible();
    await bar.getByRole("button", { name: "Stop" }).click();
    await expect(bar).toBeHidden({ timeout: 10_000 });
  });

  test("Add playlists… lists playlists with Preview and expanders, and Done keeps the ticked ones", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await region(page, "Campaign playlists").getByRole("button", { name: "Add playlists…" }).click();
    const sheet = dialog(page);
    await expect(sheet.getByRole("button", { name: "Preview Coast road travel" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Show contents of Coast road travel" })).toBeVisible();
    await sheet.getByRole("checkbox", { name: /^Coast road travel/ }).check();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(region(page, "Campaign playlists").getByRole("link", { name: "Coast road travel" })).toBeVisible();
  });

  test("a playlist can be taken off the campaign from its menu, and stays in the library", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const playlists = region(page, "Campaign playlists");
    await playlists.getByRole("button", { name: "More for Ashen King" }).click();
    await page.getByRole("menuitem", { name: "Remove from this campaign" }).click();
    await expect(playlists.getByRole("link", { name: "Ashen King" })).toHaveCount(0);
    await page.getByRole("link", { name: "Playlists" }).first().click();
    await expect(page.getByText("Ashen King").first()).toBeVisible();
  });

  test("campaign pad boards open to show their pads and have a Preview of the first pad", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const boards = region(page, "Campaign pad boards");
    await expect(boards.getByRole("button", { name: "Preview the first pad of Combat" })).toBeVisible();
    await boards.getByRole("button", { name: "Show contents of Combat" }).click();
    await expect(boards.getByRole("button", { name: "Hide contents of Combat" })).toBeVisible();
  });
});
