/**
 * Campaigns: the top level (all campaigns, one campaign with its sessions, playlists and pad boards).
 * Source: design/prototype/tools/cp-tab.js and src/views/campaigns.js.
 */
import type { Page } from "@playwright/test";
import { expect, test, expectFailureUntilBuilt } from "./support/test";
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
    expectFailureUntilBuilt("live"); // it ends on the Live screen
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
    expectFailureUntilBuilt("live"); // it ends on the Live screen
    await openRoute(page, "campaign/crown");
    const modes = page.getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
  });

  test("Run next session sits beside the switch and starts the next session in Live", async ({ page }) => {
    expectFailureUntilBuilt("live"); // it ends on the Live screen
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
    expectFailureUntilBuilt("live"); // it ends on the Live screen
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
    expectFailureUntilBuilt("on-air bar"); // the shell's on-air bar is not built yet
    await openRoute(page, "campaign/crown");
    await region(page, "Campaign playlists").getByRole("button", { name: "Play on air: The Company themes" }).click();
    // 0.3's bar is "On air"; round 5 calls it "Now playing" (it also shows a preview).
    const bar = page.getByRole("region", { name: /^(On air|Now playing)$/ });
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
    const boards = page.getByRole("region", { name: /^Campaign pad(s| boards)$/ });
    await expect(boards.getByRole("button", { name: "Preview the first pad of Combat" })).toBeVisible();
    await boards.getByRole("button", { name: "Show contents of Combat" }).click();
    await expect(boards.getByRole("button", { name: "Hide contents of Combat" })).toBeVisible();
  });
});

/* Round 5 (design/prototype/ROUND5.md): built in wave 4, so each check waits for "round 5" in the app. */
test.describe("round 5: the Now playing bar and play order on the campaign page", () => {
  // The three UX-16 checks are built (w4-kit-bar, the shell's Now playing bar). They read the bar as the prototype draws
  // it with its sample bot in the voice channel Table ("On air", not "On air · no room"), so in the app they wait for the
  // test start to have that bot, which the Outputs stream adds. The others wait for the campaign page (round 5).
  const needsTheBotInTable = () => expectFailureUntilBuilt("outputs");

  test("UX-16: the Now playing bar has a row tagged On air: what plays, where it comes from and how far, with Pause, Stop, Next and Volume", async ({ page }) => {
    needsTheBotInTable();
    await openRoute(page, "campaign/crown");
    await expect(region(page, "Now playing")).toHaveCount(0);
    await region(page, "Campaign playlists").getByRole("button", { name: "Play on air: The Company themes" }).click();
    const row = region(page, "Now playing").getByRole("group", { name: "On air", exact: true });
    await expect(row.getByTitle("The players hear this")).toHaveText("On air");
    await expect(row).toContainText("Epic choir hero anthem - the Company's big moment");
    await expect(row).toContainText("Playlist: The Company themes · The Sunken Crown");
    await expect(row).toContainText(/\d:\d\d \/ 3:57/);
    await expect(row.getByRole("slider", { name: "Volume in Table" })).toHaveValue("85");
    // Round 6 (PLY-17): the row's play order is Shuffle and Repeat buttons (checked in the round 6 block below).
    await expect(row.getByRole("link", { name: "Go to Live" })).toBeVisible();
    await row.getByRole("button", { name: "Next" }).click();
    await expect(row).toContainText("Heroic charge - horns, gallop, full orchestra");
  });

  test("UX-16: paused, the row stays and says Paused; stopped, the bar goes", async ({ page }) => {
    needsTheBotInTable();
    await openRoute(page, "campaign/crown");
    await region(page, "Campaign playlists").getByRole("button", { name: "Play on air: The Company themes" }).click();
    const bar = region(page, "Now playing");
    await bar.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(bar.getByRole("group", { name: "Paused", exact: true })).toContainText("Paused");
    await expect(bar.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Play", exact: true }).click();
    await expect(bar.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(bar).toBeHidden({ timeout: 10_000 });
  });

  test("UX-16: a preview and music on air play at once, each in its own row: On air for the players, Only you for the headphones", async ({ page }) => {
    needsTheBotInTable();
    await openRoute(page, "campaign/crown");
    const lists = region(page, "Campaign playlists");
    await lists.getByRole("button", { name: "Play on air: The Company themes" }).click();
    await lists.getByRole("button", { name: "Preview Ashen King" }).click();
    const bar = region(page, "Now playing");
    const air = bar.getByRole("group", { name: "On air", exact: true });
    const you = bar.getByRole("group", { name: "Only you", exact: true });
    await expect(air).toContainText("Epic choir hero anthem");
    await expect(you.getByTitle("Only you hear this, in your headphones")).toHaveText("Only you");
    await expect(you).toContainText("Previewed from the campaign page");
    await expect(you.getByRole("slider", { name: "Headphone volume" })).toBeVisible();
    await you.getByRole("button", { name: "Stop the preview" }).click();
    await expect(you).toHaveCount(0);
    await expect(air).toBeVisible();
  });

  test("PLY-13: a campaign playlist's play order applies when it plays from the campaign", async ({ page }) => {
    expectFailureUntilBuilt("round 5");
    await openRoute(page, "campaign/crown");
    const order = region(page, "Campaign playlists").getByRole("button", { name: /^Play order of The Company themes: / });
    await expect(order).toHaveAccessibleName("Play order of The Company themes: In order, repeat all");
    await order.click();
    await page.getByRole("menuitemcheckbox", { name: "Shuffle" }).click();
    await page.keyboard.press("Escape");
    await expect(order).toHaveAccessibleName("Play order of The Company themes: Shuffle, repeat all");
    await expect(page.getByRole("region", { name: "Campaign playlists", exact: true }).getByRole("button", { name: /^Play order of Ashen King: / })).toHaveAccessibleName("Play order of Ashen King: In order, repeat all");
  });

  test("ORG-12: single tracks kept on hand for the campaign are listed with its playlists", async ({ page }) => {
    expectFailureUntilBuilt("round 5");
    await openRoute(page, "campaign/crown");
    await expect(region(page, "Campaign playlists").getByRole("link", { name: "Ominous song, the villain's calling card (short) (single track)" })).toBeVisible();
    await expect(region(page, "Campaign playlists").getByRole("button", { name: "Play on air: Ominous song, the villain's calling card (short)" })).toBeVisible();
  });
});

/* Round 5, volume normalisation (design/prototype/ROUND5.md "Volume normalisation (PLY-15, DAT-15)"): built in wave 4. */
test.describe("round 5: volume normalisation in the Now playing bar", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 5"));

  test("PLY-15: a Now playing row's track name says on hover how much its volume is evened out, for the players and for a preview", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const lists = region(page, "Campaign playlists");
    await lists.getByRole("button", { name: "Play on air: Ashen King" }).click();
    const bar = region(page, "Now playing");
    const air = bar.getByRole("group", { name: "On air", exact: true });
    await expect(air.getByTitle("Gothic menace, pounding low brass - villain reveal · Volume evened out: -2.2 dB (-15.8 LUFS measured)")).toBeVisible();
    await lists.getByRole("button", { name: "Preview Ashen King" }).click();
    const you = bar.getByRole("group", { name: "Only you", exact: true });
    await expect(you.getByTitle(/· Volume evened out: -2\.2 dB/)).toBeVisible();
    await air.getByRole("button", { name: "Stop", exact: true }).click();
    await lists.getByRole("button", { name: "Play on air: The Company themes" }).click();
    await expect(air.getByTitle(/· Volume not evened out$/)).toBeVisible();
  });
});

/* Round 6, part 2 (design/prototype/ROUND6.md, "Your notes on 0.4.0", Nik, 6 Nov 10:34). Not built yet. */
test.describe("round 6: Repeat on the Now playing bar, the campaign's own order, and Back", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));

  test("PLY-17: a Now playing row has Shuffle and Repeat; Repeat goes off, all, one for what plays now, not saved (round 6 part 3)", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await region(page, "Campaign playlists").getByRole("button", { name: "Play on air: The Company themes" }).click();
    const row = region(page, "Now playing").getByRole("group", { name: "On air", exact: true });
    await expect(row.getByRole("button", { name: "Shuffle" })).toHaveAttribute("aria-pressed", "false");
    const repeat = row.getByRole("button", { name: /^Repeat: / });
    await expect(repeat).toHaveAccessibleName("Repeat: all");
    await repeat.click();
    await expect(repeat).toHaveAccessibleName("Repeat: one");
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    await expect(region(page, "Campaign playlists").getByRole("button", { name: /^Play order of The Company themes: / })).toHaveAccessibleName("Play order of The Company themes: In order, repeat all");
    await repeat.click();
    await expect(repeat).toHaveAccessibleName("Repeat: off");
    await expect(repeat).toHaveAttribute("aria-pressed", "false");
  });

  test("ORG-13: a campaign playlist's tracks can be put in another order for this campaign only, and back", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const box = region(page, "Campaign playlists");
    await box.getByRole("button", { name: "Show contents of The Company themes" }).click();
    const list = box.getByRole("list", { name: "Tracks in The Company themes, in the order in this campaign" });
    await expect(list).toHaveAccessibleDescription(/Alt\+Up or Alt\+Down/);
    await expect(list.getByRole("listitem").first()).toContainText("Epic choir hero anthem");
    await list.getByRole("listitem").first().getByRole("button", { name: /^Preview / }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(list.getByRole("listitem").nth(1)).toContainText("Epic choir hero anthem");
    await expect(list.getByRole("listitem").nth(1).getByRole("button", { name: /^Preview / })).toBeFocused();
    await expect(box.getByRole("button", { name: "Back to the playlist's order" })).toBeVisible();
  });

  test("ORG-13: Back to the playlist's order undoes the campaign's own order", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const box = region(page, "Campaign playlists");
    await box.getByRole("button", { name: "Show contents of The Company themes" }).click();
    const list = box.getByRole("list", { name: "Tracks in The Company themes, in the order in this campaign" });
    await expect(box.getByRole("button", { name: "Back to the playlist's order" })).toHaveCount(0);
    await list.getByRole("listitem").first().getByRole("button", { name: /^Preview / }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await box.getByRole("button", { name: "Back to the playlist's order" }).click();
    await expect(list.getByRole("listitem").first()).toContainText("Epic choir hero anthem");
    await expect(box.getByRole("button", { name: "Back to the playlist's order" })).toHaveCount(0);
  });

  test("ORG-13: the campaign's playlists themselves can be moved into another order", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    const box = region(page, "Campaign playlists");
    await box.getByRole("link", { name: "The Company themes" }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(box.getByRole("listitem").nth(1)).toContainText("The Company themes");
    await expect(box.getByRole("link", { name: "The Company themes" })).toBeFocused();
  });

  test("UX-18: a playlist opened from the campaign page has Back to the campaign, and Back returns to the same row", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await expect(page.getByRole("button", { name: /^Back to / })).toHaveCount(0);
    await region(page, "Campaign playlists").getByRole("link", { name: "Ashen King" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ashen King");
    await page.getByRole("button", { name: "Back to The Sunken Crown" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The Sunken Crown");
    await expect(region(page, "Campaign playlists").getByRole("link", { name: "Ashen King" })).toBeFocused();
  });

  test("UX-18: screens opened from the menu have no Back", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    await expect(page.getByRole("button", { name: /^Back to / })).toHaveCount(0);
  });
});
