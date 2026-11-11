/**
 * Library: every track, with filters, details, tags and bulk actions
 * (design/prototype/tools/lb-flow.js, lb-size.js and src/views/library.js).
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { openRoute } from "./support/target";
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
    await d.getByRole("group", { name: "Role" }).getByRole("button", { name: "Loop bed" }).click();
    await expect(d.getByRole("group", { name: "Role" }).getByRole("button", { name: "Loop bed" })).toHaveAttribute("aria-pressed", "true");
    await d.getByRole("group", { name: "Loop advice" }).getByRole("button", { name: "Crossfade the loop" }).click();
    await expect(d.getByRole("group", { name: "Loop advice" }).getByRole("button", { name: "Crossfade the loop" })).toHaveAttribute("aria-pressed", "true");
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
    await expect(bar.getByRole("button")).toHaveText(["Tag…", "Add to playlist…", "New playlist from these", "Clear selection"]);
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
    await openRoute(page, "library");
    await openTrack(page, "Dread rising, choir stabs");
    const loop = details(page).getByRole("group", { name: "Loop advice" });
    await expect(details(page).getByRole("group", { name: "Role" }).getByRole("button", { name: "Sting" })).toHaveAttribute("aria-pressed", "true");
    await expect(loop.getByRole("button", { name: "Loops well" })).toBeDisabled();
    await expect(loop).toHaveAccessibleDescription(/A sting plays once/);
  });

  test("Follow with… hands over to a playlist or track when it ends", async ({ page }) => {
    await openRoute(page, "library");
    await openTrack(page, "Dread rising, choir stabs");
    await details(page).getByRole("button", { name: "Follow with…" }).click();
    await page.getByRole("dialog").getByRole("combobox", { name: "When it ends, play" }).selectOption({ label: "Crypt ambush (playlist)" });
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await expect(details(page).getByRole("group", { name: "Then" })).toContainText("Crypt ambush");
    await expect(page.getByRole("status").filter({ hasText: /follows with Crypt ambush$/ })).toBeVisible();
  });

  test("Ending: Fades out, and Pick up where it stopped, are saved with the track", async ({ page }) => {
    await openRoute(page, "library");
    // An underscore: it can fade out at its end, and pick up where it stopped.
    await openTrack(page, "Storm and dark romance");
    await details(page).getByRole("group", { name: "Ending" }).getByRole("button", { name: "Fades out" }).click();
    await expect(page.getByRole("status").filter({ hasText: /ending: fades out$/ })).toBeVisible();
    await details(page).getByRole("switch", { name: "Pick up where it stopped" }).check();
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
