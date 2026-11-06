/**
 * Playlists: the list of all playlists and one playlist (manual, or dynamic with tag rules)
 * (design/prototype/tools/tab-playlists.js and src/views/playlists.js). Nik's words: Manual and Dynamic;
 * Music, Ambience and FX; expanders in the list; Preview and Play on air; no Duplicate; drop files in.
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
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
    await expect(page.getByRole("region", { name: /^(On air|Now playing)$/ })).toContainText("Epic choir hero anthem");
  });

  test("a row's menu offers Open and Use in…, and no Duplicate", async ({ page }) => {
    await openRoute(page, "playlists");
    await page.getByRole("button", { name: "More for The Company themes" }).click();
    const menu = page.getByRole("menu", { name: "More for The Company themes" });
    // Round 7 (ORG-4) adds Move to folder… in the prototype.
    await expect(menu.getByRole("menuitem").filter({ hasNotText: "Move to folder…" })).toHaveText(["Open", "Use in…"]);
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
    // The app imports the files before they join the playlist; wait for them (the prototype adds them at once).
    await expect(trackLinks(page)).toHaveCount(7);
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

/* Round 5 (design/prototype/ROUND5.md): built in wave 4, so each check waits for "round 5" in the app. */
test.describe("round 5: play order, Details with the rules, shapes and Use in… on tracks", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 5"));

  test("PLY-13: every playlist row shows its own play order, and its menu changes it", async ({ page }) => {
    await openRoute(page, "playlists");
    await expect(rowOf(page, "Combat: big and loopable").getByRole("button", { name: "Play order of Combat: big and loopable: Shuffle, repeat all" })).toBeVisible();
    const order = rowOf(page, "The Company themes").getByRole("button", { name: /^Play order of The Company themes: / });
    await expect(order).toHaveAccessibleName("Play order of The Company themes: In order, repeat all");
    await order.click();
    const menu = page.getByRole("menu", { name: "Play order" });
    await expect(menu).toContainText("Play order of this playlist");
    await expect(menu.getByRole("menuitemradio", { name: /^Repeat all/ })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: /^No repeat/ }).click();
    await expect(order).toHaveAccessibleName("Play order of The Company themes: In order, no repeat");
  });

  test("PLY-13: a playlist's page has its play order by Play on air", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("button", { name: /^Play order of The Abbess: / }).click();
    await page.getByRole("menuitemradio", { name: /^Repeat one/ }).click();
    await expect(page.getByRole("button", { name: "Play order of The Abbess: In order, repeat one" })).toBeVisible();
  });

  test("EDT-8: a dynamic playlist's Details sit at the top with its rules, folded", async ({ page }) => {
    await openRoute(page, "playlist/p-abbey-eerie");
    const detailsToggle = page.getByRole("button", { name: "Details", exact: true });
    await expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    const details = (await page.getByRole("region", { name: "Details", exact: true }).boundingBox())!;
    const rules = (await page.getByRole("region", { name: "Rules", exact: true }).boundingBox())!;
    expect(details.y).toBeLessThan(rules.y);
    expect(Math.abs(details.x - rules.x)).toBeLessThan(2);
    await detailsToggle.click();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Abbey: eerie, low energy");
  });

  test("EDT-8: in a narrow window Details stays at the top", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await openRoute(page, "playlist/p-abbey-eerie");
    await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-expanded", "false");
    const details = (await page.getByRole("region", { name: "Details", exact: true }).boundingBox())!;
    const rules = (await page.getByRole("region", { name: "Rules", exact: true }).boundingBox())!;
    const used = (await page.getByRole("region", { name: "Used in", exact: true }).boundingBox())!;
    expect(details.y).toBeLessThan(rules.y);
    expect(details.y).toBeLessThan(used.y);
  });

  test("DAT-13: a dynamic playlist's rules can ask for shapes", async ({ page }) => {
    await openRoute(page, "playlist/p-gothic");
    const shapes = page.getByRole("group", { name: "Shape: how the track moves" });
    await expect(shapes.getByRole("button")).toHaveText(["Steady", "Builds", "Falls away", "Peaks then falls", "Rises and falls"]);
    const before = await page.getByRole("list", { name: "Matching tracks" }).getByRole("listitem").count();
    await shapes.getByRole("button", { name: "Builds" }).click();
    await expect(shapes.getByRole("button", { name: "Builds" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Rules", exact: true })).toContainText("shape builds");
    expect(await page.getByRole("list", { name: "Matching tracks" }).getByRole("listitem").count()).toBeLessThan(before);
  });

  test("ORG-12: a track's menu in a playlist has Use in…", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for / }).first().click();
    await page.getByRole("menuitem", { name: "Use in…" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /^Use ".+" in…$/ })).toBeVisible();
  });
});

/* Round 6 (design/prototype/ROUND6.md): a resting status shows only on a folded box. Part 5 (Nik, 6 Nov 16:14): Ready
   and Saved are gone altogether, open or folded; saving shows in the Saved pop-up. */
test.describe("round 6: quiet statuses", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));

  test("no box says Ready or Saved, open or folded", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    for (const name of ["Used in", "Tracks", "Details"]) {
      const box = page.getByRole("region", { name, exact: true });
      await expect(box.getByText(/^(Ready|Saved)$/)).toHaveCount(0);
      await box.getByRole("button", { name, exact: true }).click();
      await expect(box.getByText(/^(Ready|Saved)$/)).toHaveCount(0);
    }
  });

  test("a playlist's notes save after a pause in typing, with the Saved pop-up", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const notes = page.getByRole("textbox", { name: "Notes" });
    await notes.fill("Only after the bell");
    await expect(page.getByRole("status").filter({ hasText: "Saved: The Abbess notes" })).toBeVisible();
    await expect(notes).toBeFocused();
  });
});

/* Round 5, volume normalisation (design/prototype/ROUND5.md "Volume normalisation (PLY-15, DAT-15)"): built in wave 4. */
test.describe("round 5: volume normalisation", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 5"));

  test("PLY-15: a playlist's Details choose Normalise volume for its tracks, and a track's own choice comes first", async ({ page }) => {
    await openRoute(page, "playlist/p-ashen");
    const details = page.getByRole("region", { name: "Details", exact: true });
    const norm = details.getByRole("group", { name: "Normalise volume" });
    await expect(norm.getByRole("button")).toHaveText(["Library setting", "On", "Off"]);
    await expect(norm.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    // Ominous song (t26) is set to Off on its own, so it plays as it is here too.
    await expect(norm).toHaveAccessibleDescription("Its tracks get -2.2 dB to +2.7 dB here; 1 plays as it is");
    await expect(details.getByTitle("A track's own choice still comes first.")).toBeVisible();
    await norm.getByRole("button", { name: "Library setting" }).click();
    await expect(norm).toHaveAccessibleDescription("Its tracks play as they are");
    await expect(details.getByTitle("Follows the library (Off). A track's own choice comes first.")).toBeVisible();
  });
});

/* Round 7 (design/prototype/ROUND7.md): folders and dividers (ORG-4), and adding tracks to other lists by dragging
   or with Add to… (ORG-5). */
test.describe("round 7: folders", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 7"));

  async function newFolder(page: Page, name: string) {
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Add folder" }).click();
  }
  const folder = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^Folder ${name}`) });

  test("New folder, then Move to folder… from a playlist's ⋯ puts it inside; folding the folder hides it", async ({ page }) => {
    await openRoute(page, "playlists");
    await newFolder(page, "The abbey");
    await expect(folder(page, "The abbey")).toBeVisible();
    await page.getByRole("button", { name: "More for The Abbess" }).click();
    await page.getByRole("menuitem", { name: "Move to folder…" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "The abbey" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
    await expect(page.getByRole("list", { name: "In The abbey" }).getByRole("link", { name: /^The Abbess / })).toBeVisible();
    await folder(page, "The abbey").click();
    await expect(folder(page, "The abbey")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: /^The Abbess / })).toBeHidden();
  });

  test("folders nest, and deleting a folder keeps its playlists (they move up a level)", async ({ page }) => {
    await openRoute(page, "playlists");
    await newFolder(page, "Sunken Crown");
    await page.getByRole("button", { name: "More for the folder Sunken Crown" }).click();
    await page.getByRole("menuitem", { name: "New folder inside…" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Villains");
    await page.getByRole("dialog").getByRole("button", { name: "Add folder" }).click();
    await expect(page.getByRole("list", { name: "In Sunken Crown" }).getByRole("button", { name: /^Folder Villains/ })).toBeVisible();
    await page.getByRole("button", { name: "More for Ashen King" }).click();
    await page.getByRole("menuitem", { name: "Move to folder…" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Sunken Crown › Villains" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
    await page.getByRole("button", { name: "More for the folder Villains" }).click();
    await page.getByRole("menuitem", { name: "Delete folder" }).click();
    await expect(page.getByRole("list", { name: "In Sunken Crown" }).getByRole("link", { name: /^Ashen King / })).toBeVisible();
  });

  test("a playlist can be dragged onto a folder", async ({ page }) => {
    await openRoute(page, "playlists");
    await newFolder(page, "Travel");
    await page.getByRole("link", { name: /^Coast road travel / }).dragTo(folder(page, "Travel"));
    await expect(page.getByRole("list", { name: "In Travel" }).getByRole("link", { name: /^Coast road travel / })).toBeVisible();
  });
});

test.describe("round 7: dividers inside a playlist", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 7"));

  test("a divider goes above a track, names a section, and is not a track", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Lullaby, sad/ }).click();
    await page.getByRole("menuitem", { name: "Add a divider above" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("After the font");
    await page.getByRole("dialog").getByRole("button", { name: "Add divider" }).click();
    const items = page.getByRole("list", { name: "Tracks in order" }).getByRole("listitem");
    await expect(items.nth(3)).toHaveAccessibleName("Divider: After the font");
    await expect(items.nth(4)).toContainText("Lullaby, sad");
    await expect(page.getByRole("region", { name: "Tracks", exact: true })).toHaveAccessibleDescription(/5 tracks/);
  });
});

test.describe("round 7: adding to other lists", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 7"));
  const trackRow = (page: Page, start: string) => page.getByRole("list", { name: "Tracks in order" }).getByRole("listitem").filter({ hasText: start });
  // The places to drop show only once a drag has started, so the drag is done step by step.
  async function dragOnto(page: Page, start: string, target: string, shift = false) {
    const box = await trackRow(page, start).boundingBox();
    await page.mouse.move(box!.x + 40, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 80, box!.y + 60, { steps: 5 });
    // Shift is held once the drag has started, as a person does when they decide to move it.
    if (shift) await page.keyboard.down("Shift");
    const to = page.getByRole("region", { name: "Drop on" }).getByRole("button", { name: target, exact: true });
    const t = await to.boundingBox();
    await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2, { steps: 5 });
    await page.mouse.up();
  }

  test("dragging a track shows where it can go; dropping it on another playlist copies it there", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const tray = page.getByRole("region", { name: "Drop on" });
    await expect(tray).toHaveCount(0);
    await dragOnto(page, "Alien, unknowable", "Ashen King");
    await expect(page.getByRole("status").filter({ hasText: /^Saved: Ashen King · Alien, unknowable/ })).toBeVisible();
    await expect(trackRow(page, "Alien, unknowable")).toHaveCount(1);
    await expect(tray).toHaveCount(0);
  });

  test("with Shift held the track moves: it leaves this playlist", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await dragOnto(page, "Alien, unknowable", "Ashen King", true);
    await page.keyboard.up("Shift");
    await expect(page.getByRole("status").filter({ hasText: /Moved to Ashen King/ })).toBeVisible();
    await expect(trackRow(page, "Alien, unknowable")).toHaveCount(0);
  });

  test("Esc while dragging puts everything back", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    const box = await trackRow(page, "Alien, unknowable").boundingBox();
    await page.mouse.move(box!.x + 40, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 80, box!.y + 120, { steps: 5 });
    await expect(page.getByRole("region", { name: "Drop on" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Drop on" })).toHaveCount(0);
    await page.mouse.up();
    await expect(trackRow(page, "Alien, unknowable")).toHaveCount(1);
  });

  test("Add to… does the same from the keyboard: a playlist, a scene or Up next", async ({ page }) => {
    await openRoute(page, "playlist/p-abbess");
    await page.getByRole("list", { name: "Tracks in order" }).getByRole("button", { name: /^More for Alien, unknowable/ }).click();
    await page.getByRole("menuitem", { name: "Add to…" }).click();
    const d = page.getByRole("dialog", { name: /^Add .* to$/ });
    await expect(d.getByRole("radio", { name: "Up next in Table" })).toBeVisible();
    await d.getByRole("radio", { name: "Session 14 › The abbey ruins" }).check();
    await d.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved: The abbey ruins music · Alien, unknowable/ })).toBeVisible();
  });
});
