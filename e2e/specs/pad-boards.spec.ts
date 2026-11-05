/**
 * Pad boards: the list of boards and the board editor (design/prototype/tools/pb-flows.js, src/views/boards.js).
 * Nik's words: change the number of pads; spare pads for the ones that no longer fit; Preview on every pad;
 * search and filter.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";

const boards = (page: Page) => page.getByRole("list", { name: "Pad boards", exact: true });
const padGrid = (page: Page) => page.getByRole("group", { name: /^Pads, \d+ columns by \d+ rows$/ });
const spare = (page: Page) => page.getByRole("region", { name: "Spare pads", exact: true });
/** The pads on the grid (not the empty slots and not the Preview buttons beside them). */
const PAD = /^(?!Empty slot).*, row \d+, column \d+/;
const pads = (page: Page) => padGrid(page).getByRole("button", { name: PAD });
/** A pad tile, named "<label> <KEY>: <play mode>, row …" (the visible label and key first; prototype boards.js). */
const pad = (page: Page, label: string) =>
  padGrid(page).getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\S+)?: `) });
const boardRows = (page: Page) => boards(page).getByRole("listitem");

test.describe("all pad boards", () => {
  test("lists each board with its size, how many pads it holds and where it is used", async ({ page }) => {
    await openRoute(page, "boards");
    await expect(page.getByText("5 boards")).toBeVisible();
    await expect(boards(page).getByRole("link", { name: "Combat 4 × 3, 11 pads, 1 empty" })).toBeVisible();
    await expect(boards(page).getByRole("link", { name: "Weather and places 4 × 2, 8 pads, 1 spare" })).toBeVisible();
    await expect(boards(page).getByRole("listitem").filter({ hasText: "Weather and places" })).toContainText("Used in 8 places");
  });

  test("a search finds boards by the board's name or by the label of a pad on it", async ({ page }) => {
    await openRoute(page, "boards");
    const search = page.getByRole("searchbox", { name: /Search pad boards/ });
    await search.fill("bell");
    await expect(boards(page).getByRole("link", { name: /^Drowned Abbey/ }).first()).toBeVisible();
    expect(await boardRows(page).count()).toBeLessThan(5);
    await search.fill("combat");
    await expect(boardRows(page)).toHaveCount(1);
    await expect(boards(page).getByRole("link", { name: /^Combat/ }).first()).toBeVisible();
    await expect(search).toBeFocused();
  });

  test("filters: Used, Not used yet, and by campaign", async ({ page }) => {
    await openRoute(page, "boards");
    const used = page.getByRole("group", { name: "Used or not" });
    await used.getByRole("button", { name: "Not used yet" }).click();
    expect(await boardRows(page).count()).toBeLessThan(5);
    await used.getByRole("button", { name: "All" }).click();
    await page.getByRole("combobox", { name: "Campaign" }).selectOption({ label: "Ash and Masks" });
    await expect(boards(page).getByRole("link", { name: /^Elysium court/ }).first()).toBeVisible();
    await expect(boards(page).getByRole("link", { name: /^Combat/ })).toHaveCount(0);
  });

  test("every board has a Preview of its first pad", async ({ page }) => {
    await openRoute(page, "boards");
    await boards(page).getByRole("button", { name: "Preview the first pad of Combat" }).click();
    await expect(boards(page).getByRole("button", { name: /^Stop preview/ })).toBeVisible();
  });

  test("New board asks for a name and a size and opens the empty board", async ({ page }) => {
    await openRoute(page, "boards");
    await page.getByRole("button", { name: "New board" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("textbox", { name: "Name" }).fill("Harbour at night");
    await sheet.getByRole("radio", { name: /^6 × 4/ }).check();
    await sheet.getByRole("button", { name: "Make board" }).click();
    await expect(page.getByRole("heading", { name: "Harbour at night", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Empty slot/ })).toHaveCount(24);
  });

  test("Delete board… asks first and says what happens to the places it is used", async ({ page }) => {
    await openRoute(page, "boards");
    await page.getByRole("button", { name: "More for Combat" }).click();
    await page.getByRole("menuitem", { name: /^Delete board/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Combat");
    await page.keyboard.press("Escape");
    await expect(boards(page).getByRole("link", { name: /^Combat/ }).first()).toBeVisible();
  });
});

test.describe("resizing a board: spare pads", () => {
  test("making the grid smaller moves the pads that no longer fit to Spare pads, and says nothing was deleted", async ({ page }) => {
    await openRoute(page, "board/weather");
    await page.getByRole("button", { name: "Fewer rows" }).click();
    await expect(page.getByText(/4 pads moved to Spare pads: Horse whinny, Storm, Wind gust, Fire flares\. Nothing was deleted\./).first()).toBeVisible();
    await expect(pads(page)).toHaveCount(4);
    await expect(spare(page)).toContainText("5 pads");
    await expect(spare(page).getByRole("button", { name: /^Storm/ })).toBeVisible();
  });

  test("a spare pad's key does nothing while it is spare, and it says so", async ({ page }) => {
    await openRoute(page, "board/weather");
    await page.getByRole("button", { name: "Fewer rows" }).click();
    await expect(spare(page).getByRole("button", { name: "Storm W (key does nothing while spare)" })).toBeVisible();
  });

  test("making the grid bigger again says there are empty slots, and Put all back puts the spare pads in them", async ({ page }) => {
    await openRoute(page, "board/weather");
    await page.getByRole("button", { name: "Fewer rows" }).click();
    await page.getByRole("button", { name: "More rows" }).click();
    await expect(page.getByText(/Grid is now 4 × 2: 4 empty slots to fill\. Spare pads can go back into them\./).first()).toBeVisible();
    await spare(page).getByRole("button", { name: "Put all back" }).click();
    await expect(pads(page)).toHaveCount(8);
    await expect(pad(page, "Storm")).toBeVisible();
  });

  test("Undo on the message puts the pads back where they were", async ({ page }) => {
    await openRoute(page, "board/weather");
    await page.getByRole("button", { name: "Fewer rows" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(pads(page)).toHaveCount(8);
  });

  test("the quick sizes set columns and rows at once, and the current size is pressed", async ({ page }) => {
    await openRoute(page, "board/weather");
    const quick = page.getByRole("group", { name: "Quick sizes" });
    await expect(quick.getByRole("button", { name: "4 columns by 2 rows" })).toHaveAttribute("aria-pressed", "true");
    await quick.getByRole("button", { name: "6 columns by 4 rows" }).click();
    await expect(padGrid(page)).toHaveAccessibleName("Pads, 6 columns by 4 rows");
    await expect(page.getByText("8 of 24 slots used")).toBeVisible();
  });

  test("the editor says why spare pads exist", async ({ page }) => {
    await openRoute(page, "board/weather");
    await expect(spare(page).getByText(/Pads that are not on the grid wait here; their keys do nothing until you put them back\./)).toBeVisible();
  });

  test("an empty slot can be filled with a new pad", async ({ page }) => {
    await openRoute(page, "board/combat");
    await page.getByRole("button", { name: "Empty slot, row 3, column 4. Add a pad" }).click();
    await expect(pads(page)).toHaveCount(12);
  });
});

test.describe("pads on a board", () => {
  test("arrow keys move between pads and Alt+arrow moves the pad itself", async ({ page }) => {
    await openRoute(page, "board/abbey");
    const first = pads(page).first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    const second = pads(page).nth(1);
    await expect(second).toBeFocused();
    const label = (await second.textContent())!;
    await page.keyboard.press("Alt+ArrowRight");
    await expect(pads(page).nth(2)).toHaveText(label);
  });

  test("pads can be swapped by dragging one onto another", async ({ page }) => {
    await openRoute(page, "board/abbey");
    const buttons = pads(page);
    const a = (await buttons.nth(0).textContent())!;
    const b = (await buttons.nth(1).textContent())!;
    await buttons.nth(0).dragTo(buttons.nth(1));
    await expect(buttons.nth(0)).toHaveText(b);
    await expect(buttons.nth(1)).toHaveText(a);
  });

  test("every pad has its own Preview, and the selected pad stays selected while another is previewed", async ({ page }) => {
    await openRoute(page, "board/abbey");
    const grid = padGrid(page);
    const previews = grid.getByRole("button", { name: /^Preview / });
    await expect(previews).toHaveCount(12);
    await previews.nth(5).click();
    await expect(grid.getByRole("button", { name: /^Stop preview/ })).toHaveCount(1);
    await expect(grid.getByRole("button", { name: /previewing$/ })).toHaveCount(1);
    await expect(pads(page).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("the P key previews the focused pad", async ({ page }) => {
    await openRoute(page, "board/abbey");
    await pads(page).nth(3).focus();
    await page.keyboard.press("p");
    await expect(padGrid(page).getByRole("button", { name: /^Stop preview/ })).toHaveCount(1);
  });

  test("the pad's own box has Preview, Play on air, Label, Play mode and Hotkey", async ({ page }) => {
    await openRoute(page, "board/weather");
    const box = page.getByRole("region", { name: "Pad: Thunder crack" });
    await expect(box.getByRole("button", { name: "Play on air" })).toBeVisible();
    await expect(box.getByRole("textbox", { name: "Label" })).toHaveValue("Thunder crack");
    await expect(box.getByRole("group", { name: "Play mode" }).getByRole("button")).toHaveText(["One-shot", "Toggle loop", "Hold to play", "Restart on press"]);
    await box.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(box.getByRole("button", { name: "Stop preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("a pad's play mode is chosen with buttons and explained in words", async ({ page }) => {
    await openRoute(page, "board/weather");
    const box = page.getByRole("region", { name: "Pad: Thunder crack" });
    await expect(box).toContainText("Plays once from the start on each press. Quick presses overlap.");
    await box.getByRole("group", { name: "Play mode" }).getByRole("button", { name: "Toggle loop" }).click();
    await expect(box.getByRole("group", { name: "Play mode" }).getByRole("button", { name: "Toggle loop" })).toHaveAttribute("aria-pressed", "true");
    await expect(pad(page, "Thunder crack")).toHaveAccessibleName(/Toggle loop/);
  });

  test("giving a pad a key another pad has warns, and offers to take the key from that pad", async ({ page }) => {
    await openRoute(page, "board/combat");
    const box = page.getByRole("region", { name: /^Pad: / });
    await box.getByRole("button", { name: /^Hotkey/ }).click();
    await page.keyboard.press("q");
    await expect(box).toContainText('Q is also the key for "Fireball" on this board.');
    await box.getByRole("button", { name: "Take it from that pad" }).click();
    await expect(padGrid(page).getByRole("button", { name: /^Fireball/ })).not.toHaveAccessibleName(/key Q/);
  });

  test("a pad's sound comes from library files, with variants played at random or in turn", async ({ page }) => {
    await openRoute(page, "board/weather");
    const box = page.getByRole("region", { name: "Pad: Thunder crack" });
    await expect(box.getByRole("button", { name: "Choose from library…" })).toBeVisible();
    await expect(box.getByRole("button", { name: "Add a file…" })).toBeVisible();
    await expect(box.getByRole("group", { name: "Order of variants" }).getByRole("button", { name: "Random" })).toHaveAttribute("aria-pressed", "true");
    await box.getByRole("group", { name: "Order of variants" }).getByRole("button", { name: "In turn" }).click();
    await expect(box.getByRole("group", { name: "Order of variants" }).getByRole("button", { name: "In turn" })).toHaveAttribute("aria-pressed", "true");
  });

  test("a pad can be duplicated, moved to another place or deleted (after asking)", async ({ page }) => {
    await openRoute(page, "board/combat");
    await page.getByRole("button", { name: "More for this pad" }).click();
    await expect(page.getByRole("menu", { name: "Pad" }).getByRole("menuitem")).toHaveText(["Duplicate pad", "Move to…", "Delete pad…"]);
    await page.getByRole("menuitem", { name: "Delete pad…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pads(page)).toHaveCount(11);
  });

  test("a board can be used in campaigns, sessions and scenes, and shows where", async ({ page }) => {
    await openRoute(page, "board/weather");
    await expect(page.getByRole("region", { name: "Used in", exact: true })).toContainText("The Sunken Crown (whole campaign)");
    await page.getByRole("button", { name: "Use in…" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Weather and places");
  });
});
