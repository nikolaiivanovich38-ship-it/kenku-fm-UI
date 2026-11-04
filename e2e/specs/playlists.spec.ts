/**
 * Playlists: the list of all playlists and one playlist (manual, or dynamic with tag rules)
 * (design/prototype/tools/tab-playlists.js and src/views/playlists.js). Nik's words: Manual and Dynamic;
 * Music, Ambience and FX; expanders in the list; Preview and Play on air; no Duplicate; drop files in.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";
import { dropFiles } from "./support/drop";

const list = (page: Page) => page.getByRole("list", { name: "Playlists", exact: true });
const rowOf = (page: Page, name: string) => list(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: `Show contents of ${name}` }).or(page.getByRole("button", { name: `Hide contents of ${name}` })) });
const trackLinks = (page: Page, name: RegExp | string = "Tracks in order") => page.getByRole("list", { name }).getByRole("listitem");
const trackNames = async (page: Page, name: RegExp | string = "Tracks in order") =>
  (await trackLinks(page, name).evaluateAll((rows) => rows.map((r) => r.querySelector("a")?.textContent?.trim() ?? "")));

test.describe("all playlists", () => {
  test("lists every playlist with its kind (Manual or Dynamic, Music, Ambience or FX), track count and length", async ({ page }) => {
    await openRoute(page, "playlists");
    await expect(page.getByText("21 playlists")).toBeVisible();
    await expect(page.getByRole("link", { name: /^The Company themes , Manual, Music/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Abbey: eerie, low energy , Dynamic, Music/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Abbey ambience , Manual, Ambience/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Stings and hits , Manual, FX/ })).toBeVisible();
    await expect(rowOf(page, "The Company themes")).toContainText("19:26");
  });

  test("filters: Music, Ambience, FX; Manual, Dynamic; Used, Not used yet; and a search", async ({ page }) => {
    await openRoute(page, "playlists");
    const kind = page.getByRole("group", { name: "Music, ambience or FX" });
    await expect(kind.getByRole("button")).toHaveText(["All", "Music", "Ambience", "FX"]);
    await kind.getByRole("button", { name: "FX" }).click();
    await expect(list(page).getByRole("listitem")).toHaveCount(1);
    await kind.getByRole("button", { name: "Ambience" }).click();
    await expect(list(page).getByRole("link", { name: /^Abbey ambience/ })).toBeVisible();
    await expect(list(page).getByRole("link", { name: /^The Company themes/ })).toHaveCount(0);
    await kind.getByRole("button", { name: "All" }).click();
    const how = page.getByRole("group", { name: "Manual or dynamic" });
    await how.getByRole("button", { name: "Dynamic" }).click();
    await expect(list(page).getByRole("link", { name: /, Manual,/ })).toHaveCount(0);
    await expect(list(page).getByRole("link", { name: /^Gothic dread/ })).toBeVisible();
    await how.getByRole("button", { name: "All" }).click();
    await page.getByRole("group", { name: "Used or not" }).getByRole("button", { name: "Not used yet" }).click();
    await expect(list(page).getByRole("link", { name: /used in/ })).toHaveCount(0);
    await page.getByRole("group", { name: "Used or not" }).getByRole("button", { name: "All" }).click();
    await page.getByRole("searchbox", { name: /Search playlists/ }).fill("abbess");
    await expect(list(page).getByRole("link", { name: /^The Abbess/ })).toBeVisible();
    await expect(list(page).getByRole("link", { name: /^The Company themes/ })).toHaveCount(0);
  });

  test("each row opens in place to show its tracks and where it is used, and starts closed", async ({ page }) => {
    await openRoute(page, "playlists");
    await expect(page.getByRole("list", { name: "Tracks in The Company themes" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show contents of The Company themes" }).click();
    await expect(page.getByRole("list", { name: "Tracks in The Company themes" }).getByRole("listitem")).toHaveCount(6);
    await expect(rowOf(page, "The Company themes")).toContainText("Session 14 › Greyhollow inn");
    await page.getByRole("button", { name: "Hide contents of The Company themes" }).click();
    await expect(page.getByRole("list", { name: "Tracks in The Company themes" })).toHaveCount(0);
  });

  test("each row has Preview (only Nik hears it) and Play on air (the players hear it)", async ({ page }) => {
    await openRoute(page, "playlists");
    const row = rowOf(page, "The Company themes");
    await row.getByRole("button", { name: "Preview The Company themes" }).click();
    await expect(row.getByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await row.getByRole("button", { name: "Play on air: The Company themes" }).click();
    await expect(page.getByRole("region", { name: "On air", exact: true })).toContainText("Epic choir hero anthem");
  });

  test("a row's menu offers Open and Use in…, and no Duplicate", async ({ page }) => {
    await openRoute(page, "playlists");
    await page.getByRole("button", { name: "More for The Company themes" }).click();
    const menu = page.getByRole("menu", { name: "More for The Company themes" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Open", "Use in…"]);
    await expect(menu.getByRole("menuitem", { name: /duplicate/i })).toHaveCount(0);
  });

  test("New playlist offers Manual and Dynamic for Music, Ambience and FX, and a new manual playlist opens empty", async ({ page }) => {
    await openRoute(page, "playlists");
    await page.getByRole("button", { name: "New playlist" }).click();
    const menu = page.getByRole("menu", { name: "New playlist" });
    await expect(menu.getByRole("menuitem")).toHaveCount(6);
    await expect(menu.getByRole("menuitem", { name: /^Manual Pick tracks and put them in order/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Dynamic Every track that matches your tag rules/ })).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Manual Pick tracks/ }).click();
    await expect(page.getByRole("heading", { name: "New music playlist", level: 1 })).toBeVisible();
    await expect(page.getByText("No tracks yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
  });

  test("audio files dropped on a row are added to that playlist and to the Library", async ({ page }) => {
    await openRoute(page, "playlists");
    await dropFiles(rowOf(page, "Coast road travel"), ["01 Harbour dawn.flac", "notes.txt"]);
    await page.getByRole("button", { name: "Show contents of Coast road travel" }).click();
    await expect(page.getByRole("list", { name: "Tracks in Coast road travel" }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByRole("list", { name: "Tracks in Coast road travel" })).toContainText("Harbour dawn");
  });
});

test.describe("one manual playlist", () => {
  test("shows its tracks numbered in play order, with Preview, Play on air and Use in…", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await expect(page.getByRole("heading", { name: "The Abbess", level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(/Manual\s*·\s*Music/);
    expect(await trackNames(page)).toHaveLength(5);
    expect((await trackNames(page))[0]).toMatch(/^Ancient sorrow/);
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Play on air", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Use in…" }).first()).toBeVisible();
  });

  test("can be renamed", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("button", { name: "Rename this playlist" }).click();
    await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.getByRole("textbox", { name: "Name" }).fill("The Abbess, her theme");
    await expect(page.getByRole("heading", { name: "The Abbess, her theme", level: 1 })).toBeVisible();
  });

  test("a track is added from the Add tracks box, which can search Music, Ambience or FX", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const add = page.getByRole("region", { name: "Add tracks", exact: true });
    await expect(add.getByRole("group", { name: "Search in" }).getByRole("button")).toHaveText(["Music", "Ambience", "FX"]);
    await add.getByRole("searchbox", { name: /Search the library/ }).fill("quiet grief");
    await add.getByRole("button", { name: /^Add Quiet grief/ }).click();
    expect((await trackNames(page)).at(-1)).toMatch(/^Quiet grief/);
    expect(await trackNames(page)).toHaveLength(6);
  });

  test("tracks can be tried in the Add tracks box before adding them", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const add = page.getByRole("region", { name: "Add tracks", exact: true });
    await add.getByRole("searchbox", { name: /Search the library/ }).fill("quiet grief");
    await expect(add.getByRole("button", { name: /^Preview Quiet grief/ })).toBeVisible();
    await expect(add.getByRole("button", { name: /^Play on air: Quiet grief/ })).toBeVisible();
  });

  test("a track moves down from its menu, and Alt+Up moves it back from the keyboard", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const first = (await trackNames(page))[0];
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Ancient sorrow/ }).click();
    await page.getByRole("menuitem", { name: /^Move down/ }).click();
    expect((await trackNames(page))[1]).toBe(first);
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Ancient sorrow/ }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect((await trackNames(page))[0]).toBe(first);
  });

  test("a track is taken out of the playlist from its menu, and stays in the Library", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Alien, unknowable/ }).click();
    await page.getByRole("menuitem", { name: "Remove from this playlist" }).click();
    expect(await trackNames(page)).toHaveLength(4);
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect(page.getByText("Alien, unknowable voices - ancient magic, a ghost speaks").first()).toBeVisible();
  });

  test("each track has an Audio profile for this playlist in its menu", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Ancient sorrow/ }).click();
    await expect(page.getByRole("menuitem", { name: "Audio profile in this playlist" })).toBeVisible();
  });

  test("audio files dropped on the playlist are added to it, in order, and to the Library", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await dropFiles(page.getByRole("region", { name: "Tracks", exact: true }), ["01 Candle smoke.flac", "02 Bell tower.mp3", "readme.txt"]);
    const names = await trackNames(page);
    expect(names.indexOf("Bell tower")).toBe(names.indexOf("Candle smoke") + 1);
    expect(names.indexOf("Candle smoke")).toBeGreaterThan(-1);
    expect(names).toHaveLength(7);
    expect(names).not.toContain("readme");
  });

  test("Use in… lists campaigns, sessions and scenes with ticks where it is used already, and Save changes where it plays", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("button", { name: "Use in…" }).first().click();
    const sheet = page.getByRole("dialog", { name: /Use "The Abbess" in…/ });
    await expect(sheet.getByRole("checkbox", { name: /^Scene: The abbey ruins/ })).toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ })).not.toBeChecked();
    await sheet.getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ }).check();
    await expect(sheet).toContainText("3 chosen");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: "Used in", exact: true })).toContainText("Session 14");
  });

  test("Delete playlist… asks before anything is removed", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("button", { name: "Delete playlist…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "The Abbess", level: 1 })).toBeVisible();
  });
});

test.describe("one dynamic playlist", () => {
  test("shows its rules as editable conditions, in plain words, with the matching tracks below", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    await expect(page.getByRole("main")).toContainText(/Dynamic\s*·\s*Music/);
    const rules = page.getByRole("region", { name: "Rules", exact: true });
    await expect(rules.getByRole("group", { name: "Condition 1" }).getByRole("combobox", { name: "Tag group, condition 1" })).toBeVisible();
    await expect(rules.getByText(/In plain words: Music tracks with Leitmotif any of Drowned Abbess/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Matching tracks", exact: true })).toContainText("4 tracks");
    await expect(page.getByRole("list", { name: "Matching tracks" }).getByRole("listitem")).toHaveCount(4);
  });

  test("changing 'any of' to 'all of' rewrites the plain words and narrows the matching tracks", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    const rules = page.getByRole("region", { name: "Rules", exact: true });
    await rules.getByRole("combobox", { name: "How it matches, condition 2" }).selectOption({ label: "all of" });
    await expect(rules.getByText(/Mood all of Eerie, Dread/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Matching tracks", exact: true })).not.toContainText("4 tracks");
  });

  test("tags are added to a condition from a menu and removed with their X", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    const rules = page.getByRole("region", { name: "Rules", exact: true });
    await rules.getByRole("button", { name: "Remove Dread" }).click();
    await expect(rules.getByText(/Mood any of Eerie;/).first()).toBeVisible();
    await rules.getByRole("button", { name: "Add mood" }).click();
    await page.getByRole("menuitem", { name: "Tense" }).click();
    await expect(rules.getByText(/Mood any of Eerie, Tense/).first()).toBeVisible();
  });

  test("conditions can be added and removed, and stings can be left out", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    const rules = page.getByRole("region", { name: "Rules", exact: true });
    await rules.getByRole("button", { name: "Add condition" }).click();
    await expect(rules.getByRole("group", { name: "Condition 3" })).toBeVisible();
    await rules.getByRole("button", { name: "Remove condition 3" }).click();
    await expect(rules.getByRole("group", { name: "Condition 3" })).toHaveCount(0);
    await rules.getByRole("checkbox", { name: "Leave out stings" }).check();
    await expect(rules.getByText(/not stings/).first()).toBeVisible();
  });

  test("energy limits are chosen from two lists", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    const rules = page.getByRole("region", { name: "Rules", exact: true });
    await rules.getByRole("combobox", { name: "Highest energy" }).selectOption({ label: "1" });
    await expect(rules.getByText(/energy 0 to 1/).first()).toBeVisible();
  });

  test("Make a manual copy turns the matching tracks into a hand-ordered playlist", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    await page.getByRole("button", { name: "Make a manual copy" }).click();
    await expect(page.getByRole("main")).toContainText(/Manual\s*·\s*Music/);
    await expect(page.getByRole("list", { name: "Tracks in order" }).getByRole("listitem")).toHaveCount(4);
  });

  test("shows where it is used, with each scene's place in the list", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    await expect(page.getByRole("region", { name: "Used in", exact: true })).toContainText("The abbey ruins");
    await expect(page.getByRole("region", { name: "Used in", exact: true })).toContainText("2 of 4");
  });
});
