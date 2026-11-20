/**
 * Library: every track, with filters, details, tags and bulk actions
 * (design/prototype/tools/lb-flow.js, lb-size.js and src/views/library.js).
 */
import type { Locator, Page } from "@playwright/test";
import { appOnly, expect, expectFailureUntilBuilt, metByTheAppAlready, test } from "./support/test";
import { openRoute, reopen } from "./support/target";
import { dropFiles } from "./support/drop";

const grid = (page: Page) => page.getByRole("grid", { name: "Tracks" });
const row = (page: Page, title: string | RegExp) => grid(page).getByRole("row", { name: typeof title === "string" ? new RegExp(`^Select ${escape(title)}`) : title });
const filters = (page: Page) => page.getByRole("region", { name: "Filters", exact: true });
const details = (page: Page) => page.getByRole("complementary", { name: /Details/ }).or(page.getByRole("region", { name: "Details", exact: true }));
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Titles of the rows now shown, read from each row's selection checkbox ("Select <title>"). */
async function shownTitles(page: Page): Promise<string[]> {
  const names = await grid(page).getByRole("row").getByRole("checkbox").evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-label") ?? ""));
  return names.filter((n) => n.startsWith("Select ") && !n.startsWith("Select all")).map((n) => n.slice(7));
}
/** The time ("0:07 / 3:42") shown in a Now playing row or an On air box changes twice by itself, with no click. */
async function expectTimeToMoveOn(where: Locator) {
  const time = async () => (await where.textContent())?.match(/\d+:\d\d \/ \d+:\d\d/)?.[0] ?? "";
  await expect.poll(time).not.toBe("");
  for (let i = 0; i < 2; i++) {
    const before = await time();
    await expect.poll(time, { message: `the time after ${before}`, timeout: 3_000 }).not.toBe(before);
  }
}

async function openFilters(page: Page) {
  const toggle = page.getByRole("button", { name: "Filters", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}
async function openTrack(page: Page, title: string) {
  await row(page, title).getByRole("gridcell").nth(1).click();
}

test.describe("finding tracks", () => {
  test("shows how many tracks there are and lists them with a Preview, Play on air and More button on every row", async ({ page }) => {
    await openRoute(page, "library");
    await expect(page.getByText("69 tracks")).toBeVisible();
    const r = row(page, "Abbess screams");
    await expect(r.getByRole("button", { name: "Preview Abbess screams" })).toBeVisible();
    await expect(r.getByRole("button", { name: "Play on air: Abbess screams" })).toBeVisible();
    await expect(r.getByRole("button", { name: "More for Abbess screams" })).toBeVisible();
  });

  test("the Music, Ambience and FX filter shows only that kind of track", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    const kinds = filters(page).getByRole("group", { name: "Kind of track" });
    await expect(kinds.getByRole("button")).toHaveText(["All", "Music", "Ambience", "FX"]);
    await kinds.getByRole("button", { name: "FX" }).click();
    await expect(kinds.getByRole("button", { name: "FX" })).toHaveAttribute("aria-pressed", "true");
    const fx = await shownTitles(page);
    expect(fx).toContain("Heavy door slams");
    expect(fx).toContain("Dread rising, choir stabs - monster approaches (sting)");
    expect(fx).not.toContain("Ashes");
    await kinds.getByRole("button", { name: "Ambience" }).click();
    const amb = await shownTitles(page);
    expect(amb).toContain("Busy tavern crowd, mugs, laughter");
    expect(amb).not.toContain("Heavy door slams");
    await kinds.getByRole("button", { name: "Music" }).click();
    expect(await shownTitles(page)).toContain("Ashes");
  });

  test("picking a tag narrows the list and says what is being shown", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    await filters(page).getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
    expect(await shownTitles(page)).toHaveLength(5);
    await expect(filters(page)).not.toContainText("None: showing every track");
  });

  test("a New, not tagged yet filter finds tracks that have just been added", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    await filters(page).getByRole("button", { name: /^New, not tagged yet/ }).click();
    const titles = await shownTitles(page);
    expect(titles).toHaveLength(3);
    expect(titles).toEqual(expect.arrayContaining(["Ashes", "Memories of Mother"]));
  });

  test("searching by words in the title narrows the list", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("searchbox", { name: "Search tracks" }).fill("tavern");
    const titles = await shownTitles(page);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.length).toBeLessThan(10);
    expect(titles).toContain("Busy tavern crowd, mugs, laughter");
  });

  test("tracks can be sorted, for example longest first", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("combobox", { name: "Sort tracks" }).selectOption({ label: "Longest first" });
    expect((await shownTitles(page))[0]).toMatch(/^Brutal battle/);
  });

  test("keys move through the rows: Down moves, Space selects, Enter opens the details", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("searchbox", { name: "Search tracks" }).focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const onFirstRow = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return !!a && (a.tagName === "TR" || a.getAttribute("role") === "row") && !/Select all/.test(a.textContent ?? "") && !a.closest("thead,[role=rowgroup]:first-of-type");
      });
      if (onFirstRow) break;
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(page.getByRole("toolbar", { name: "Selected tracks" })).toContainText("1 selected");
    await page.keyboard.press("Enter");
    await expect(details(page).getByRole("textbox", { name: "Your title" })).toBeVisible();
  });
});

test.describe("a track's details", () => {
  test("show the title you gave it, the title in the file, the file name and the folder, together", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    const d = details(page);
    await expect(d.getByRole("textbox", { name: "Your title" })).toBeVisible();
    await expect(d.getByRole("term").filter({ hasText: "Title in the file" })).toBeVisible();
    await expect(d.getByRole("term").filter({ hasText: "File name" })).toBeVisible();
    await expect(d.getByText("13 Ashes.flac")).toBeVisible();
    await expect(d.getByRole("term").filter({ hasText: "Folder" })).toBeVisible();
    await expect(d.getByText("H:\\Audio\\Scores\\Bear McCreary\\God of War")).toBeVisible();
    await expect(d.getByRole("button", { name: "Copy path" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Show in folder" })).toBeVisible();
  });

  test("a track without your title offers Use the title in the file; then typing your own title changes the list at once", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    const title = details(page).getByRole("textbox", { name: "Your title" });
    await expect(title).toHaveValue("");
    await details(page).getByRole("button", { name: "Use the title in the file" }).click();
    await expect(title).toHaveValue("Ashes");
    await title.fill("Grief and ash - slow, fade");
    await expect(row(page, "Grief and ash - slow, fade")).toBeVisible();
  });

  test("have Preview and Play on air, and a link to the Audio profile", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    const d = details(page);
    await d.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(d.getByRole("button", { name: /^Stop preview/ })).toBeVisible();
    await expect(d.getByRole("button", { name: "Play on air", exact: true })).toBeVisible();
    await expect(d.getByRole("link", { name: "Audio profile" })).toHaveAttribute("href", "#/profile/t44");
  });

  test("Stop preview stops the preview: the Only you row goes and the button is Preview again (Nik, 0.5.0)", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    const d = details(page);
    const you = page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: /^Only you/ });
    await d.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(you).toBeVisible();
    await d.getByRole("button", { name: "Stop preview", exact: true }).click();
    await expect(you).toHaveCount(0);
    await expect(d.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "false");
    // It does not start again a moment later.
    await page.waitForTimeout(1000);
    await expect(you).toHaveCount(0);
  });

  test("while a preview plays, its time in the Now playing bar moves on by itself (Nik, 0.5.0: it stayed at 0:00 until Pause)", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    await details(page).getByRole("button", { name: "Preview", exact: true }).click();
    const you = page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: /^Only you/ });
    await expectTimeToMoveOn(you);
  });

  test("while music plays on air, its time moves on by itself in the Now playing bar and in Live's On air (Nik, 0.5.0)", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Ashes");
    await details(page).getByRole("button", { name: "Play on air", exact: true }).click();
    const air = page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: /^On air/ });
    await expectTimeToMoveOn(air);
    await air.getByRole("link", { name: "Go to Live" }).click();
    await expectTimeToMoveOn(page.getByRole("region", { name: /^On air/ }).first());
  });

  test("Preview plays the track as its audio profile says: from its Start, 0:08 for this one (Nik, 0.5.0)", async ({ page }) => {
    await openRoute(page, "library/t02");
    await details(page).getByRole("button", { name: "Preview", exact: true }).click();
    const you = page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: /^Only you/ });
    // The time follows "Previewed from the Library" with no space between them in the text, so no \b before it.
    await expect(you).toContainText(/(^|\D)0:(0[89]|[1-5]\d) \//);
  });

  test("a mood tag is added by typing in the box: choose from the matches with the arrow keys, or create a new one", async ({ page }) => {
    await openRoute(page, "library/t44");
    const box = details(page).getByRole("combobox", { name: "Add a mood tag" });
    await box.focus();
    await page.keyboard.type("me");
    await expect(box).toHaveAttribute("aria-expanded", "true");
    const options = page.getByRole("listbox", { name: "Mood values" }).getByRole("option");
    await expect(options.first()).toHaveText("Melancholy");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(details(page).getByRole("button", { name: "Remove Melancholy from Mood" })).toBeVisible();
    // UX-R5 (0.5.0 review): the Saved pop-up says the tags were saved.
    await expect(page.getByRole("status").filter({ hasText: /^Saved: .+ tags$/ })).toBeVisible();
    await page.keyboard.type("Frostbitten");
    await expect(options.first()).toContainText("Frostbitten");
    await page.keyboard.press("Enter");
    await expect(details(page).getByRole("button", { name: "Remove Frostbitten from Mood" })).toBeVisible();
    await expect(box).toBeFocused();
  });

  test("Esc closes the tag suggestions and leaves what was typed", async ({ page }) => {
    await openRoute(page, "library/t44");
    const box = details(page).getByRole("combobox", { name: "Add a mood tag" });
    await box.fill("Ee");
    await page.keyboard.press("Escape");
    await expect(box).toHaveAttribute("aria-expanded", "false");
  });

  test("energy, role and looping advice are chosen with buttons", async ({ page }) => {
    await openRoute(page, "library/t44");
    const d = details(page);
    await d.getByRole("group", { name: "Energy, 1 calm to 5 intense" }).getByRole("button", { name: "4" }).click();
    await expect(d.getByRole("group", { name: "Energy, 1 calm to 5 intense" }).getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
    // Round 9 (item 18): Role and Loop advice became Use it for and At its end; choosing a use picks its usual end.
    await d.getByRole("group", { name: "Use it for" }).getByRole("button", { name: /^Background/ }).click();
    await expect(d.getByRole("group", { name: "Use it for" }).getByRole("button", { name: /^Background/ })).toHaveAttribute("aria-pressed", "true");
    await expect(d.getByRole("group", { name: "At its end" }).getByRole("button", { name: "Loop with a crossfade" })).toHaveAttribute("aria-pressed", "true");
  });

  test("show which playlists the track is in and which scenes use it", async ({ page }) => {
    await openRoute(page, "library/t13");
    await expect(details(page).getByRole("region", { name: "In playlists" })).toBeVisible();
    await expect(details(page).getByRole("region", { name: "Used in" })).toContainText(/abbey ruins/i);
  });
});

test.describe("adding tracks", () => {
  test("Add tracks offers files, a folder, or watching a folder, and says files can be dropped on the page", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "Add tracks" }).click();
    const menu = page.getByRole("menu", { name: "Add tracks" });
    await expect(menu.getByRole("menuitem", { name: /^Add files…/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Add a folder…/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Watch a folder…/ })).toBeVisible();
    await expect(menu.getByText(/drop files and folders anywhere on this page/i)).toBeVisible();
  });

  test("files dropped anywhere on the page join the Library, selected, and other files are ignored", async ({ page }) => {
    await openRoute(page, "library");
    await dropFiles(page.getByRole("main"), ["01 Wolf Moon.flac", "02 Ember.mp3", "notes.txt"]);
    await expect(page.getByText("71 tracks")).toBeVisible();
    expect(await shownTitles(page)).toEqual(expect.arrayContaining(["Wolf Moon", "Ember"]));
    await expect(page.getByText(/2 selected/).first()).toBeVisible();
    await expect(page.getByText(/Wolf Moon/).first()).toBeVisible();
  });

  test("w51-fix2: files dragged from the computer onto the track list itself join the Library (Nik, 0.5.0: \"I drop them, it doesn't\")", async ({ page }) => {
    await openRoute(page, "library");
    // As the browser does, the drop happens only if the list took the dragover and kept a drop effect (support/drop.ts).
    await dropFiles(page.getByRole("region", { name: "Tracks" }).getByRole("row").nth(2), ["01 Wolf Moon.flac"]);
    await expect(page.getByText("70 tracks")).toBeVisible();
    expect(await shownTitles(page)).toContain("Wolf Moon");
  });
});

test.describe("tagging many tracks at once", () => {
  async function selectTwoNew(page: Page) {
    await row(page, "Ashes").getByRole("checkbox").check();
    await row(page, "Memories of Mother").getByRole("checkbox").check();
  }

  test("ticking tracks shows a bar saying how many are selected, with Tag…, Add to playlist…, New playlist from these and Clear selection", async ({ page }) => {
    await openRoute(page, "library");
    await selectTwoNew(page);
    const bar = page.getByRole("toolbar", { name: "Selected tracks" });
    await expect(bar).toContainText("2 selected");
    // Round 10 fixes (R10-FIX §1) add Remove from library and a ⋯ (Delete files from disk…); they are left out here.
    await expect(bar.getByRole("button").filter({ hasText: /\S/ }).filter({ hasNotText: "Remove from library" })).toHaveText(["Tag…", "Add to playlist…", "New playlist from these", "Clear selection"]);
    if (test.info().project.name === "app") {
      // 0.5.2 items 4, 12, 39 (built in the app only): a ⋯ after them, for Type and Remove from library.
      await expect(bar.getByRole("button").last()).toHaveAccessibleName("More for the selected tracks");
    }
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toHaveCount(0);
  });

  test("Tag… adds the chosen tags to every selected track and explains how many already have each", async ({ page }) => {
    await openRoute(page, "library");
    await selectTwoNew(page);
    await page.getByRole("button", { name: "Tag…" }).click();
    const sheet = page.getByRole("dialog", { name: "Tag 2 tracks" });
    await expect(sheet).toContainText("None of the 2 selected tracks has a tag yet.");
    await sheet.getByRole("button", { name: "Grief, none have it" }).click();
    await sheet.getByRole("textbox", { name: "New Scene type value" }).fill("funeral");
    await sheet.getByRole("textbox", { name: "New Scene type value" }).press("Enter");
    const apply = sheet.getByRole("contentinfo").getByRole("button").last();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(sheet).toHaveCount(0);
    await openFilters(page);
    await filters(page).getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
    expect(await shownTitles(page)).toEqual(expect.arrayContaining(["Ashes", "Memories of Mother"]));
  });

  test("Tag… can also remove tags, and cannot be applied until a tag is ticked", async ({ page }) => {
    await openRoute(page, "library");
    await selectTwoNew(page);
    await page.getByRole("button", { name: "Tag…" }).click();
    const sheet = page.getByRole("dialog", { name: "Tag 2 tracks" });
    await expect(sheet.getByRole("button", { name: "Tick a tag first" })).toBeDisabled();
    await sheet.getByRole("group", { name: "Add or remove" }).getByRole("button", { name: "Remove tags" }).click();
    await expect(sheet.getByRole("group", { name: "Add or remove" }).getByRole("button", { name: "Remove tags" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Add to playlist… puts the selected tracks into a playlist", async ({ page }) => {
    await openRoute(page, "library");
    await selectTwoNew(page);
    await page.getByRole("button", { name: "Add to playlist…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/playlist/i);
  });
});

/* Round 5 (design/prototype/ROUND5.md), built in wave 4 (w4-prep-a; the ⋯ menu and Find missing files: w4-transfer). */
test.describe("round 5: shape, names in scenes, Use in… and missing files", () => {

  test("DAT-13: a track's shape is suggested from its loudness, and the game master's choice wins", async ({ page }) => {
    await openRoute(page, "library/t02");
    const shape = page.getByRole("group", { name: "Shape" });
    await expect(shape.getByRole("button")).toHaveText(["Steady", "Builds", "Falls away", "Peaks then falls", "Rises and falls"]);
    await expect(shape.getByRole("button", { name: "Peaks then falls" })).toHaveAttribute("aria-pressed", "true");
    await expect(details(page)).toContainText("Suggested by Lyre from the track's loudness");
    await shape.getByRole("button", { name: "Steady" }).click();
    await expect(shape.getByRole("button", { name: "Steady" })).toHaveAttribute("aria-pressed", "true");
    await expect(details(page)).toContainText("Lyre suggested peaks then falls."); // round 6: without "Your choice."
    await details(page).getByRole("button", { name: "Use the suggestion" }).click();
    await expect(shape.getByRole("button", { name: "Peaks then falls" })).toHaveAttribute("aria-pressed", "true");
  });

  test("DAT-13: the Library can be filtered by shape", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    await filters(page).getByRole("group", { name: "Shape" }).getByRole("button", { name: /^Builds/ }).click();
    const titles = await shownTitles(page);
    expect(titles).toContain("Brutal battle, driving brass and strings; long build to full war");
    expect(titles).not.toContain("Fragile melancholy strings, slow swell - loss, memory, flashback");
    expect(titles.length).toBeLessThan(69);
  });

  test("DAT-14: a track's details show its names in scenes beside its own name, the file's title, the file name and the folder", async ({ page }) => {
    await openRoute(page, "library/t07");
    const d = details(page);
    await expect(d.getByRole("textbox", { name: "Your title" })).toHaveValue("Release after loss, ethereal voice, resolves - end of session or death of an NPC");
    await expect(d).toContainText("Title in the file");
    await expect(d).toContainText("17 Now We Are Free.flac");
    await expect(d).toContainText(/Names in scenes\s*Dawn over the abbey\s*in Aftermath \(Session 14\)/);
  });

  test("ORG-12: Use in… on a track keeps it on hand in a campaign, and Used in says so", async ({ page }) => {
    await openRoute(page, "library/t05");
    await details(page).getByRole("button", { name: "Use in…" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("checkbox", { name: /^The Sunken Crown: whole campaign/ }).check();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(details(page)).toContainText("On hand in The Sunken Crown (whole campaign)");
  });

  test("DAT-8: files Lyre cannot find are marked Missing, have their own filter and point to Relink", async ({ page }) => {
    await openRoute(page, "library");
    await expect(row(page, /^Select Storm and dark romance/)).toContainText("Missing");
    await openFilters(page);
    await filters(page).getByRole("button", { name: /^Missing/ }).click();
    expect(await shownTitles(page)).toHaveLength(3);
    await openTrack(page, "Storm and dark romance, swells - villain's tragic backstory");
    await expect(details(page)).toContainText("Lyre cannot find this file where it was");
    await details(page).getByRole("link", { name: "Relink…" }).click();
    await expect(page.getByRole("heading", { name: "Find missing files", level: 1 })).toBeVisible();
  });

  test("the ⋯ beside Add tracks leads to Back up, move or share, Find missing files and the move report", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "More for the library" }).click();
    // Round 7 (DAT-10) adds Tags and groups… to this menu in the prototype.
    await expect(page.getByRole("menuitem").filter({ hasNotText: "Tags and groups…" })).toHaveText(["Back up, move or share…", "Find missing files (3)…", "What came across from Kenku FM", "Normalise volume…"]);
    await page.getByRole("menuitem", { name: "Back up, move or share…" }).click();
    await expect(page.getByRole("heading", { name: "Back up, move or share", level: 1 })).toBeVisible();
  });
});

/* Round 6 (design/prototype/ROUND6.md): less text on screen; what leaves the screen is read out instead. */
test.describe("round 6: the key legend", () => {
  test.beforeEach(() => expectFailureUntilBuilt("prep"));

  test("the keys show under the list while the keyboard is in it, and are read out with the list", async ({ page }) => {
    await openRoute(page, "library");
    const legend = page.getByText(/^Keys:/);
    await expect(legend).toBeHidden();
    await expect(grid(page)).toHaveAccessibleDescription(/Enter open/);
    await row(page, /^Select (?!all )/).first().focus();
    await expect(legend).toBeVisible();
  });

  test("a mouse click on a row leaves the legend hidden, so a row at the foot of the list opens (it moved away under the pointer); a key shows it", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const legend = page.getByText(/^Keys:/);
    // The last row wholly in sight, just above where the legend shows.
    const lastInSight = await grid(page).evaluate((table) => {
      const box = table.closest(".lb-scroll") as HTMLElement;
      const bottom = box.getBoundingClientRect().bottom;
      const rows = Array.from(table.querySelectorAll<HTMLElement>("tbody tr[data-tid]")).filter((r) => r.getBoundingClientRect().bottom <= bottom);
      return rows[rows.length - 1].dataset.tid as string;
    });
    await grid(page).locator(`tr[data-tid="${lastInSight}"] td.lb-c-title`).click();
    await expect(page).toHaveURL(new RegExp(`#/library/${lastInSight}$`));
    await expect(legend).toBeHidden();
    await page.keyboard.press("ArrowUp");
    await expect(legend).toBeVisible();
  });
});

/* Round 5, volume normalisation (design/prototype/ROUND5.md "Volume normalisation (PLY-15, DAT-15)"): built in wave 4. */
test.describe("round 5: volume normalisation", () => {

  test("PLY-15: ⋯ › Normalise volume… is off for the library at first, with Standard (-18 LUFS); turned on, tracks get their gain", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: "Normalise volume…" }).click();
    let dialog = page.getByRole("dialog", { name: "Normalise volume" });
    const on = dialog.getByRole("checkbox", { name: "Normalise volume for the whole library" });
    await expect(on).not.toBeChecked();
    await expect(dialog.getByRole("group", { name: "Target level" }).getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("radio", { name: /^Standard \(-18 LUFS\)/ })).toBeChecked();
    await expect(dialog.getByTitle(/It adds at most 12 dB and keeps peaks under -1 dBTP\./)).toContainText("Normalise volume for the whole library");
    await expect(dialog.getByRole("status")).toHaveText(/^66 of 69 tracks measured/); // then, for screen readers, what the hover says
    await on.check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await openTrack(page, "Melancholy tense - melancholy heroism - fade");
    await expect(details(page).getByText("-22.6 LUFS · +4.6 dB", { exact: true })).toBeVisible();
    // Loud (-14 LUFS) would need +8.6 dB, but the true peak (-8.0 dBTP) may rise only to -1 dBTP.
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: "Normalise volume…" }).click();
    dialog = page.getByRole("dialog", { name: "Normalise volume" });
    await expect(dialog.getByRole("checkbox", { name: "Normalise volume for the whole library" })).toBeChecked();
    await dialog.getByRole("radio", { name: /^Loud \(-14 LUFS\)/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(details(page).getByText("-22.6 LUFS · +7.0 dB (kept under -1 dBTP)", { exact: true })).toBeVisible();
  });

  test("DAT-15, PLY-15: a track's details show what Lyre measured and the gain it gets, with Library setting, On and Off", async ({ page }) => {
    await openRoute(page, "library/t02");
    const norm = details(page).getByRole("group", { name: "Normalise volume" });
    await expect(norm.getByRole("button")).toHaveText(["Library setting", "On", "Off"]);
    await expect(norm.getByRole("button", { name: "Library setting" })).toHaveAttribute("aria-pressed", "true");
    await expect(norm).toHaveAccessibleDescription("-22.6 LUFS · plays as it is");
    await expect(details(page).getByTitle(/^True peak -8\.0 dBTP\. Follows the library \(Off\)/)).toHaveText("-22.6 LUFS · plays as it is");
    await norm.getByRole("button", { name: "On" }).click();
    await expect(norm.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    await expect(norm).toHaveAccessibleDescription("-22.6 LUFS · +4.6 dB");
    await norm.getByRole("button", { name: "Off" }).click();
    await expect(norm).toHaveAccessibleDescription("-22.6 LUFS · plays as it is");
    await expect(details(page).getByTitle("True peak -8.0 dBTP. This track's own choice, wherever it plays.")).toBeVisible();
  });

  test("PLY-15: a boost stops at +12 dB, and a track not measured yet plays as it is", async ({ page }) => {
    await openRoute(page, "library/t09");
    const norm = details(page).getByRole("group", { name: "Normalise volume" });
    await norm.getByRole("button", { name: "On" }).click();
    await expect(norm).toHaveAccessibleDescription("-31.5 LUFS · +12.0 dB (the most Lyre adds)");
    await openTrack(page, "Memories of Mother");
    await expect(details(page).getByRole("group", { name: "Normalise volume" })).toHaveAccessibleDescription("Not measured yet: plays as it is");
  });
});

/* Round 7 (design/prototype/ROUND7.md): tracks behave as tagged (PLY-4), follow-with hand-overs (SHW-3), and dragging
   several selected tracks to another list (ORG-5). */
test.describe("round 7: how a track behaves", () => {
  test.beforeEach(() => expectFailureUntilBuilt("prep"));

  test("a sting never loops: its loop choices are off, and say why", async ({ page }) => {
    // Round 9 (item 18): a sting is a Short cue; At its end offers no loop for it.
    await openRoute(page, "library");
    await openTrack(page, "Dread rising, choir stabs");
    await expect(details(page).getByRole("group", { name: "Use it for" }).getByRole("button", { name: /^Short cue/ })).toHaveAttribute("aria-pressed", "true");
    await expect(details(page).getByRole("group", { name: "At its end" }).getByRole("button", { name: /^Loop/ })).toHaveCount(0);
  });

  test("Follow with… hands over to a playlist or track when it ends", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Dread rising, choir stabs");
    // Round 9 (item 5): At its end › Play… opens a picker with search and Playlists, Music, Ambience and FX.
    await details(page).getByRole("group", { name: "At its end" }).getByRole("button", { name: "Play…" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /^Crypt ambush/ }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await expect(details(page).getByRole("group", { name: "At its end" })).toContainText("Play: Crypt ambush");
    await expect(page.getByRole("status").filter({ hasText: /then plays Crypt ambush$/ })).toBeVisible();
  });

  test("Ending: Fades out, and Pick up where it stopped, are saved with the track", async ({ page }) => {
    await openRoute(page, "library");
    // An underscore: it can fade out at its end, and pick up where it stopped.
    await openTrack(page, "Storm and dark romance");
    // Round 9 (item 18): Ending is one of At its end's choices; Pick up is "Next time, start where it stopped".
    await details(page).getByRole("group", { name: "At its end" }).getByRole("button", { name: "Fade out" }).click();
    await expect(page.getByRole("status").filter({ hasText: /at its end: fades out$/ })).toBeVisible();
    await details(page).getByLabel("Next time, start where it stopped").check();
    await expect(page.getByRole("status").filter({ hasText: /picks up where it stopped$/ })).toBeVisible();
  });
});

test.describe("round 7: dragging selected tracks to another list", () => {
  test.beforeEach(() => expectFailureUntilBuilt("prep"));

  test("two ticked tracks dragged onto a playlist are both added", async ({ page }) => {
    await openRoute(page, "library");
    await row(page, "Ashes").getByRole("checkbox").check();
    await row(page, "Memories of Mother").getByRole("checkbox").check();
    await row(page, "Ashes").scrollIntoViewIfNeeded();
    const b = await row(page, "Ashes").getByRole("gridcell").nth(1).boundingBox();
    await page.mouse.move(b!.x + 20, b!.y + b!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + 60, b!.y + 60, { steps: 5 });
    const tray = page.getByRole("region", { name: "Drop on" });
    await expect(tray).toContainText("2 tracks");
    const t = await tray.getByRole("button", { name: "The Abbess", exact: true }).boundingBox();
    await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("status").filter({ hasText: /^Saved: The Abbess · 2 tracks added/ })).toBeVisible();
  });
});

/* 0.5.0 usability review (UX-R3): round 6's cuts on the Library, as the prototype shows them. */
test.describe("round 6 cuts on the Library", () => {
  test("UX-R3: a track's details repeat neither its title in the header nor Manual on its playlists, and say nothing of names it has none of", async ({ page }) => {
    await openRoute(page, "library/t21");
    const d = page.getByRole("region", { name: "Details", exact: true });
    await expect(d.getByRole("textbox", { name: "Your title" })).toBeVisible();
    await expect(d.locator(".pane-summary")).toHaveText("");
    await expect(d).not.toContainText("Names in scenes");
    await expect(d.getByText("Manual", { exact: true })).toHaveCount(0);
    await expect(d.getByText("Dynamic", { exact: true }).first()).toBeVisible();
  });
});

/* 0.5.0 usability review (UX-R18): ROUND7, every control on the Library is at least 24 × 24 px. */
test.describe("Library targets", () => {
  test("UX-R18: a row's check box and Select all are at least 24 × 24 px", async ({ page }) => {
    await openRoute(page, "library");
    for (const box of [grid(page).getByRole("checkbox").first(), grid(page).getByRole("checkbox").nth(1)]) {
      const r = (await box.boundingBox())!;
      expect(Math.round(r.width)).toBeGreaterThanOrEqual(24);
      expect(Math.round(r.height)).toBeGreaterThanOrEqual(24);
    }
  });
});

/* 0.5.1 (design/prototype/ROUND8.md, part 2). Nik, 11 Nov: "In library view I still need the Prep and Live toggle we have
   elsewhere." */
test.describe("0.5.1: Prep and Live in the Library", () => {
  test("the Library's top bar has Prep | Live; Prep is on, and Live opens the session loaded in Live", async ({ page }) => {
    expectFailureUntilBuilt("feat");
    await openRoute(page, "library");
    const modes = page.getByRole("main").getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeAttached();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
  });
});

/* 0.5.1 (ROUND8.md, part 3). Nik, 11 Nov 20:33: "I don't see pickup where it stops in details or audio profile views for
   a track". It showed only for underscores and loop beds. */
test.describe("0.5.1: Pick up where it stopped for every music track", () => {
  test("a track of any role but a sting, or with no role yet, has Pick up where it stopped in its details; a sting has not", async ({ page }) => {
    expectFailureUntilBuilt("feat");
    await openRoute(page, "library");
    for (const title of ["Ashes", "Haunted sea shanty"]) {
      await openTrack(page, title);
      // Round 9: the words are "Next time, start where it stopped" in the design; either is read.
      await expect(details(page).getByLabel(/^(Pick up where it stopped|Next time, start where it stopped)$/)).toBeVisible();
    }
    await openTrack(page, "Very short heroic moment");
    await expect(details(page).getByRole("textbox", { name: "Your title" })).toBeVisible();
    await expect(details(page).getByLabel(/^(Pick up where it stopped|Next time, start where it stopped)$/)).toHaveCount(0);
  });
});

/* 0.5.1: from Nik's test of 0.5.0 (11 Nov), built in the app with no prototype round (support/test.ts appOnly). */
test.describe("0.5.1: Nik's changes from his test of 0.5.0", () => {
  test("a music track with no role offers Pick up where it stopped in its details (\"I don't see pickup where it stops\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    await page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select Ashes/ }).getByRole("gridcell").nth(1).click();
    const details = page.getByRole("region", { name: "Details", exact: true });
    // Round 9's words since 0.6.0: "Next time, start where it stopped".
    const resume = details.getByRole("switch", { name: /^(Pick up where it stopped|Next time, start where it stopped)$/ });
    await resume.check();
    await expect(resume).toBeChecked();
  });

  test("the Now playing bar's time line is a seek bar: a click jumps the track there (\"choose to skip to a certain point\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    await page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select Ashes/ }).getByRole("button", { name: /^Play on air: / }).click();
    const air = page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: /^On air/ });
    const seek = air.getByRole("slider", { name: /^Position in / });
    await expect(seek).toHaveAttribute("aria-valuetext", /^\d+:\d\d of \d+:\d\d$/);
    const box = (await seek.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(24);
    const max = Number(await seek.getAttribute("aria-valuemax"));
    await seek.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeGreaterThan(max * 0.75 - 10);
    await seek.press("Home");
    await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeLessThan(5);
  });

  test("the Library's top bar has the Prep | Live switch (\"In library view I still need the Prep and Live toggle\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const modes = page.getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeAttached();
  });
});

test.describe("0.5.2: Nik's changes from his play test of 14 November", () => {
  test("item 7: a track's row shows its file's length and, under it, the length its Audio profile plays", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const length = row(page, /^Select Eerie dread/).locator("td.lb-c-dur");
    await expect(length).toContainText("7:21");
    await expect(length.getByTitle("Plays 5:18 with its Audio profile (file 7:21)")).toBeVisible();
  });

  test("item 6: Preview or Play on air on a row opens that track's details", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const ashes = row(page, "Ashes");
    await ashes.getByRole("button", { name: /^Preview / }).click();
    await expect(ashes).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(/#\/library\/[^/]+$/);
    const eerie = row(page, /^Select Eerie dread/);
    await eerie.getByRole("button", { name: /^Play on air: / }).click();
    await expect(eerie).toHaveAttribute("aria-current", "true");
  });

  test("item 35: opening a track keeps the list scrolled where it was", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const box = page.locator(".lb-scroll");
    await box.evaluate((el) => (el.scrollTop = 400));
    const target = grid(page).locator("tbody tr[data-tid]").nth(20);
    await target.locator("td.lb-c-title").click();
    await expect(target).toHaveAttribute("aria-current", "true");
    await expect.poll(() => box.evaluate((el) => el.scrollTop)).toBeGreaterThan(390);
    expect(await box.evaluate((el) => el.scrollTop)).toBeLessThan(410);
  });

  test("item 23: the menu, the heading and Back call it the Track library; the address stays #/library", async ({ page }) => {
    appOnly();
    await openRoute(page, "settings");
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Track library", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Track library");
    await expect(page).toHaveURL(/#\/library$/);
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: "Tags and groups…" }).click();
    await expect(page.getByRole("button", { name: "Back to Track library" })).toBeVisible();
  });

  test("item 21: Clear in one filter clears only that filter; Clear all filters clears every one", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const f = filters(page);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await f.getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
    await f.getByRole("group", { name: "Shape" }).getByRole("button", { name: /^Builds/ }).click();
    await expect(f).toContainText("2 filters on");
    await f.getByRole("button", { name: "Clear Mood" }).click();
    await expect(f).toContainText("1 filter on");
    await expect(f.getByRole("group", { name: "Shape" }).getByRole("button", { name: /^Builds/ })).toHaveAttribute("aria-pressed", "true");
    await f.getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
    await f.getByRole("button", { name: "Clear all filters" }).click();
    await expect(f).not.toContainText("filter on");
  });

  test("item 25: a click on a column header sorts by it, ascending then descending, and says so with aria-sort", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const title = grid(page).getByRole("columnheader", { name: /^Title/ });
    const length = grid(page).getByRole("columnheader", { name: /^Length/ });
    await expect(title).toHaveAttribute("aria-sort", "ascending");
    const first = (await shownTitles(page))[0];
    await title.getByRole("button").click();
    await expect(title).toHaveAttribute("aria-sort", "descending");
    expect((await shownTitles(page)).at(-1)).toBe(first);
    await length.getByRole("button").click();
    await expect(length).toHaveAttribute("aria-sort", "ascending");
    await expect(title).not.toHaveAttribute("aria-sort");
    await length.getByRole("button").click();
    await expect(length).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByRole("combobox", { name: "Sort tracks" })).toHaveValue("long");
  });

  test("item 10: a New track the game master tags is no longer New, with no title of its own", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const ashes = row(page, "Ashes");
    await expect(ashes.getByText("New", { exact: true })).toBeVisible();
    await ashes.locator("td.lb-c-title").click();
    await details(page).getByRole("combobox", { name: "Add a mood tag" }).fill("Grief");
    await details(page).getByRole("combobox", { name: "Add a mood tag" }).press("Enter");
    await expect(ashes.getByText("New", { exact: true })).toHaveCount(0);
  });

  test("item 40: a library folder's ⋯ says what kind its new tracks are", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const f = filters(page);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await f.getByRole("button", { name: "More for the folder H:\\Audio\\Scores" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Guessed from the folder name" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Always Ambience" }).click();
    await expect(f.getByRole("button", { name: /^H:\\Audio\\Scores/ }).getByText("Ambience", { exact: true })).toBeVisible();
    await f.getByRole("button", { name: "More for the folder H:\\Audio\\Scores" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Always Ambience" })).toHaveAttribute("aria-checked", "true");
  });

  test("item 20: Remove folder… forgets a watched folder, its tracks stay unless ticked, and Undo brings it back", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const f = filters(page);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    const count = (await shownTitles(page)).length;
    await f.getByRole("button", { name: "More for the folder H:\\Audio\\Effects" }).click();
    await page.getByRole("menuitem", { name: "Remove folder…" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove Effects?" });
    await expect(dialog.getByRole("checkbox", { name: /^Also remove its \d+ tracks? from the library$/ })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Remove folder" }).click();
    await expect(f.getByRole("button", { name: "More for the folder H:\\Audio\\Effects" })).toHaveCount(0);
    expect((await shownTitles(page)).length).toBe(count);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(f.getByRole("button", { name: "More for the folder H:\\Audio\\Effects" })).toBeVisible();
  });

  test("items 1 and 50: Remove from library names where a track is used and works with Undo; Delete file from disk… asks first", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const eerie = row(page, /^Select Eerie dread/);
    await eerie.getByRole("button", { name: /^More for / }).click();
    await page.getByRole("menuitem", { name: "Remove from library" }).click();
    const dialog = page.getByRole("dialog", { name: /^Remove “Eerie dread.*” from the library\?$/ });
    await expect(dialog.getByRole("note")).toContainText("The abbey ruins (Session 14)");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(eerie).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(eerie).toBeVisible();
    // The file's own confirmation: it names the file and says it can't be undone (Cancel here: the files are the test build's).
    await eerie.getByRole("button", { name: /^More for / }).click();
    await page.getByRole("menuitem", { name: "Delete file from disk…" }).click();
    const del = page.getByRole("dialog", { name: "Delete its file from disk?" });
    await expect(del).toContainText("06 Bridge of Death.flac");
    await expect(del).toContainText("This can't be undone in Lyre");
    await del.getByRole("button", { name: "Cancel" }).click();
    await expect(eerie).toBeVisible();
  });

  test("item 50: Remove all shown… removes the tracks a filter shows, with the count in its confirmation", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await filters(page).getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
    const shown = (await shownTitles(page)).length;
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: `Remove all shown (${shown})…` }).click();
    const dialog = page.getByRole("dialog", { name: `Remove all ${shown} shown tracks from the library?` });
    await dialog.getByRole("button", { name: `Remove ${shown} tracks` }).click();
    await expect.poll(async () => (await shownTitles(page)).length).toBe(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await shownTitles(page)).length).toBe(shown);
  });

  test("items 4, 12 and 39: Type in a track's details; an FX track is offered for pads, and the selection's ⋯ changes several at once", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    const ashes = row(page, "Ashes");
    await ashes.locator("td.lb-c-title").click();
    const type = details(page).getByRole("group", { name: "Type" });
    await expect(type.getByRole("button", { name: "Music" })).toHaveAttribute("aria-pressed", "true");
    await type.getByRole("button", { name: "FX" }).click();
    await expect(type.getByRole("button", { name: "FX" })).toHaveAttribute("aria-pressed", "true");
    await openRoute(page, "board/abbey");
    await page.getByRole("region", { name: /^Pad: / }).getByRole("button", { name: "Choose from library…" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: /^Ashes/ })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await openRoute(page, "library");
    await row(page, "Ashes").getByRole("checkbox").check();
    await row(page, /^Select Eerie dread/).getByRole("checkbox").check();
    await page.getByRole("button", { name: "More for the selected tracks" }).click();
    await page.getByRole("menuitemradio", { name: "Ambience" }).click();
    const ask = page.getByRole("dialog", { name: "Make 2 tracks Ambience?" });
    if (await ask.isVisible()) await ask.getByRole("button", { name: "Make Ambience" }).click();
    await expect(row(page, "Ashes").getByText("Amb", { exact: true })).toBeVisible();
    await expect(row(page, /^Select Eerie dread/).getByText("Amb", { exact: true })).toBeVisible();
  });

  test("round 8 #2: Pick up where it stopped fits on one line", async ({ page }) => {
    appOnly();
    await openRoute(page, "library");
    // An Underscore track: it has Pick up where it stopped (round 9: Next time, start where it stopped). Round 8 #4 (the
    // Follow with list's line) went with that list: At its end › Play… is a picker (round 9 block).
    await openTrack(page, "Melancholy tense - melancholy heroism - fade");
    const pickUp = details(page).locator("label.lb-resume");
    await expect(pickUp).toBeVisible();
    expect((await pickUp.boundingBox())!.height).toBeLessThan(30);
  });

  test("round 8 #5: a track title on a playlist page opens its details, and Open in Track library shows that row in view", async ({ page }) => {
    appOnly();
    await openRoute(page, "playlist/p-abbess");
    const links = page.getByRole("main").locator('a[href^="#/library/"]');
    await expect(links.first()).toBeVisible();
    const href = (await links.last().getAttribute("href"))!;
    await links.last().click();
    // Round 10: the title opens the Track panel beside the page; from there, the Track library.
    await page.getByRole("complementary").getByRole("link", { name: "Open in Track library" }).click();
    const open = grid(page).locator(`tr[data-tid="${href.split("/").pop()}"]`);
    await expect(open).toHaveAttribute("aria-current", "true");
    await expect(open).toBeInViewport();
  });
});

/* 0.5.2: from Nik's play test (14 Nov), built in the app with no prototype round (support/test.ts appOnly). */
test.describe("0.5.2: Nik's play test", () => {
  test("item 29: with music on air and a preview playing, tracks dragged from the list onto the Drop on panel land, and nothing fails (\"crashed the interface\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "playlists");
    await page.getByRole("button", { name: "Play on air: The Abbess" }).first().click();
    await page.getByRole("button", { name: "Preview The Company themes" }).first().click();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Track library", exact: true }).click();
    await expect(page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: "On air", exact: true })).toBeVisible();
    const dragOnto = async (title: string, place: string) => {
      await row(page, title).scrollIntoViewIfNeeded();
      const b = (await row(page, title).getByRole("gridcell").nth(1).boundingBox())!;
      await page.mouse.move(b.x + 20, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 60, b.y + 60, { steps: 5 });
      const tray = page.getByRole("region", { name: "Drop on" });
      const t = (await tray.getByRole("button", { name: place, exact: true }).boundingBox())!;
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect(tray).toBeHidden();
    };
    await dragOnto("Ashes", "The Abbess");
    await expect(page.getByRole("status").filter({ hasText: /^Saved: The Abbess/ })).toBeVisible();
    await dragOnto("Memories of Mother", "Up next in Table");
    await dragOnto("Ashes", "Greyhollow inn");
    // The screen and the Now playing bar are still there: no "Something went wrong" in their place.
    await expect(page.getByText(/went wrong|Show this screen again/)).toHaveCount(0);
    await expect(grid(page)).toBeVisible();
    await expect(page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: "On air", exact: true })).toBeVisible();
  });
});

/* Round 10 fixes (R10-FIX §1, from Nik's first look, 18 Nov 13:00: "There's still no way to remove tracks"). Items 1
   and 50, as 0.5.2 built them in the app (src/lyre/screens/library/RemoveTracks.tsx): Remove from library for one
   track, a selection and every track a filter shows, asking first and naming where the tracks are used, with Undo;
   the files stay. Delete file from disk… only in a row's ⋯, with a confirmation that names the files and the Recycle
   Bin. Not built in this branch's app yet. */
test.describe("round 10: removing tracks from the Track library", () => {
  const eerie = "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)";

  test("a row's ⋯ has Remove from library: it asks first, names the scene that uses it, and Undo brings it back", async ({ page }) => {
    metByTheAppAlready("0.5.2 built Remove from library in a row's ⋯ with these words (RemoveTracks.tsx)");
    await openRoute(page, "library");
    await row(page, eerie).getByRole("button", { name: `More for ${eerie}` }).click();
    await page.getByRole("menuitem", { name: "Remove from library", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Remove “${eerie}” from the library?` });
    await expect(dialog).toContainText("Its file stays on your computer");
    await expect(dialog).toContainText("The abbey ruins");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(row(page, eerie)).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row(page, eerie)).toHaveCount(1);
  });

  test("Delete file from disk… is in the row's ⋯ only, last: its confirmation names the file and the Recycle Bin", async ({ page }) => {
    await openRoute(page, "library");
    await row(page, "Abbess screams").getByRole("button", { name: "More for Abbess screams" }).click();
    const items = await page.getByRole("menu").getByRole("menuitem").allTextContents();
    expect(items.at(-1)?.trim()).toBe("Delete file from disk…");
    await page.getByRole("menuitem", { name: "Delete file from disk…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete its file from disk?" });
    await expect(dialog).toContainText("abbess_scream.wav");
    await expect(dialog).toContainText("Recycle Bin");
    await dialog.getByRole("button", { name: "Delete file", exact: true }).click();
    await expect(row(page, "Abbess screams")).toHaveCount(0);
    // Undo brings the track back; its file stays in the Recycle Bin, so it is missing until restored.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row(page, "Abbess screams")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Delete file from disk…" })).toHaveCount(0);
  });

  test("the selection bar has Remove from library for the selected tracks", async ({ page }) => {
    await openRoute(page, "library");
    await row(page, eerie).getByRole("checkbox").check();
    await row(page, "Abbess screams").getByRole("checkbox").check();
    const bar = page.getByRole("toolbar", { name: "Selected tracks" });
    await bar.getByRole("button", { name: "Remove from library" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove 2 tracks from the library?" });
    await dialog.getByRole("button", { name: "Remove 2 tracks" }).click();
    await expect(row(page, eerie)).toHaveCount(0);
    await expect(row(page, "Abbess screams")).toHaveCount(0);
    await expect(bar).toHaveCount(0);
  });

  test("with a search on, the ⋯ beside Add tracks removes every track it shows, after saying how many", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("searchbox", { name: "Search tracks" }).fill("battle");
    const n = (await shownTitles(page)).length;
    expect(n).toBeGreaterThan(1);
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: `Remove the ${n} tracks shown from the library…` }).click();
    const dialog = page.getByRole("dialog", { name: `Remove all ${n} shown tracks from the library?` });
    await dialog.getByRole("button", { name: `Remove ${n} tracks` }).click();
    expect(await shownTitles(page)).toEqual([]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await shownTitles(page)).toHaveLength(n);
  });

  test("a track's details have Remove from library, and Delete on a focused row asks the same", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Abbess screams");
    await details(page).getByRole("button", { name: "Remove from library" }).click();
    await expect(page.getByRole("dialog", { name: "Remove “Abbess screams” from the library?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await row(page, eerie).focus();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog", { name: `Remove “${eerie}” from the library?` })).toBeVisible();
  });
});

/* Round 9 (ROUND9.md §7, §9; R60-GAPS.md "Track library"): Columns beside Sort, filters that show or hide, the order of
   the filters, and At its end's Play… picker. Round 9 left these checks to the build stream: written by r10-tracks
   against the prototype first. */
test.describe("round 9: Columns, filters that show or hide, and the Play… picker", () => {
  const header = (page: Page, name: string) => grid(page).getByRole("columnheader", { name: new RegExp(`^${name}`) });

  test("Columns beside Sort: Title always, the usual three ticked, more added, kept, and Put back the usual columns", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "Columns", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Columns" });
    const items = menu.getByRole("menuitemcheckbox");
    await expect(items).toHaveText([/^Title \(always\)/, "Artist", "Album", "Type", "Use it for", "Tags", "Shape", "Energy", "Length", /^Plays for/, "Added", "Folder"]);
    for (const on of ["Tags", "Energy", "Length"]) await expect(menu.getByRole("menuitemcheckbox", { name: on, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Artist", exact: true })).toHaveAttribute("aria-checked", "false");
    // The menu stays open while columns are ticked, so several change at once.
    await menu.getByRole("menuitemcheckbox", { name: "Artist", exact: true }).click();
    await menu.getByRole("menuitemcheckbox", { name: "Energy", exact: true }).click();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Artist", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(header(page, "Artist")).toBeVisible();
    await expect(header(page, "Energy")).toHaveCount(0);
    // Kept on this computer.
    await reopen(page);
    await expect(header(page, "Artist")).toBeVisible();
    await expect(header(page, "Energy")).toHaveCount(0);
    await page.getByRole("button", { name: "Columns", exact: true }).click();
    await page.getByRole("menu", { name: "Columns" }).getByRole("menuitem", { name: "Put back the usual columns" }).click();
    await expect(header(page, "Artist")).toHaveCount(0);
    await expect(header(page, "Energy")).toBeVisible();
  });

  test("a chosen column's header sorts by it, A to Z first and then Z to A", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "Columns", exact: true }).click();
    await page.getByRole("menu", { name: "Columns" }).getByRole("menuitemcheckbox", { name: "Artist", exact: true }).click();
    await page.keyboard.press("Escape");
    await header(page, "Artist").getByRole("button").click();
    await expect(header(page, "Artist")).toHaveAttribute("aria-sort", "ascending");
    const firstUp = (await shownTitles(page))[0];
    await header(page, "Artist").getByRole("button").click();
    await expect(header(page, "Artist")).toHaveAttribute("aria-sort", "descending");
    expect((await shownTitles(page))[0]).not.toBe(firstUp);
  });

  test("a filter chip: once shows only those tracks, again hides them (read out as hidden), again clears", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    const grief = () => filters(page).getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ });
    await expect(filters(page)).toContainText("Click a filter once to show only those tracks, and again to hide them.");
    await grief().click();
    await expect(grief()).toHaveAttribute("aria-pressed", "true");
    expect(await shownTitles(page)).toHaveLength(5);
    await grief().click();
    await expect(grief()).toHaveAttribute("aria-pressed", "false");
    await expect(grief()).toHaveAccessibleName(/hidden/);
    expect(await shownTitles(page)).toHaveLength(64);
    await expect(page.getByRole("region", { name: "Filters", exact: true })).toContainText("not Grief");
    await grief().click();
    await expect(grief()).not.toHaveAccessibleName(/hidden/);
    expect(await shownTitles(page)).toHaveLength(69);
  });

  test("a folder works like a chip: once shows only it, again hides its tracks, again shows them", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    const effects = () => filters(page).getByRole("button", { name: /^H:\\Audio\\Effects/ });
    await effects().click();
    await expect(effects()).toHaveAttribute("aria-pressed", "true");
    const only = (await shownTitles(page)).length;
    expect(only).toBeLessThan(69);
    await effects().click();
    await expect(effects()).toHaveAccessibleName(/hidden/);
    expect(await shownTitles(page)).toHaveLength(69 - only);
    await effects().click();
    await expect(effects()).not.toHaveAccessibleName(/hidden/);
    expect(await shownTitles(page)).toHaveLength(69);
  });

  test("the order button sorts the filter chips, and Clear all filters clears shown and hidden ones", async ({ page }) => {
    await openRoute(page, "library");
    await openFilters(page);
    const mood = filters(page).getByRole("group", { name: "Mood" });
    const words = async () => (await mood.getByRole("button").allTextContents()).map((w) => w.replace(/\d+$/, "").trim()).filter((w) => w && w !== "Clear");
    await page.getByRole("button", { name: "Order the filters" }).click();
    const menu = page.getByRole("menu", { name: "Order the filters" });
    await expect(menu.getByRole("menuitemradio")).toHaveText(["Tag list order", "A to Z", "Z to A", "Most tracks first"]);
    await expect(menu.getByRole("menuitemradio", { name: "Tag list order" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "A to Z" }).click();
    const az = await words();
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
    await page.getByRole("button", { name: "Order the filters" }).click();
    await page.getByRole("menu", { name: "Order the filters" }).getByRole("menuitemradio", { name: "Z to A" }).click();
    expect(await words()).toEqual([...az].reverse());
    await mood.getByRole("button", { name: /^Tense/ }).click();
    await filters(page).getByRole("group", { name: "Scene" }).getByRole("button", { name: /^Combat/ }).click();
    await filters(page).getByRole("group", { name: "Scene" }).getByRole("button", { name: /^Combat/ }).click();
    await expect(page.getByRole("region", { name: "Filters", exact: true })).toContainText("Tense · not Combat");
    // The app's words since 0.5.2 (item 21) are Clear all filters; the prototype's are Clear all.
    await page.getByRole("button", { name: /^Clear all( filters)?$/ }).click();
    await expect(mood.getByRole("button", { name: /^Tense/ })).toHaveAttribute("aria-pressed", "false");
    await expect(filters(page).getByRole("group", { name: "Scene" }).getByRole("button", { name: /^Combat/ })).not.toHaveAccessibleName(/hidden/);
    expect(await shownTitles(page)).toHaveLength(69);
  });

  test("At its end › Play…: a picker with search, All · Playlists · Music · Ambience · FX with counts, Nothing at the top; a double-click chooses", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Dread rising, choir stabs");
    await details(page).getByRole("group", { name: "At its end" }).getByRole("button", { name: "Play…" }).click();
    const dialog = page.getByRole("dialog", { name: "When it ends, play" });
    const tabs = dialog.getByRole("group", { name: "Show" });
    await expect(tabs.getByRole("button")).toHaveText([/^All \d+$/, /^Playlists \d+$/, /^Music \d+$/, /^Ambience \d+$/, /^FX \d+$/]);
    const list = dialog.getByRole("list", { name: "When it ends, play" });
    await expect(list.getByRole("radio").first()).toHaveAccessibleName(/^Nothing/);
    await tabs.getByRole("button", { name: /^Playlists/ }).click();
    await expect(tabs.getByRole("button", { name: /^Playlists/ })).toHaveAttribute("aria-pressed", "true");
    await expect(list.getByRole("radio", { name: /^Ashes/ })).toHaveCount(0);
    await dialog.getByRole("searchbox", { name: "Search playlists and tracks" }).fill("crypt");
    await expect(list.getByRole("radio", { name: /^Crypt ambush/ })).toBeVisible();
    await list.getByRole("radio", { name: /^Crypt ambush/ }).dblclick();
    await expect(dialog).toHaveCount(0);
    await expect(details(page).getByRole("group", { name: "At its end" })).toContainText("Play: Crypt ambush");
  });
});
