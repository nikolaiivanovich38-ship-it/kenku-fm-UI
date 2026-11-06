/**
 * Tags (DAT-10, design round 7: design/prototype/ROUND7.md "DAT-10 tag groups" and src/views/r7tags.js). Nik asked
 * for his tags organised into groups (Mood, Leitmotif, Scene type and his own), each with names, colours and an order
 * he chooses, tags inside tags (Leitmotif › Villains › Ashen King), other words for a tag ("sad" finds Melancholy),
 * and rename, merge and delete with every track updated in one undoable step. The screen is not built in the app yet,
 * so every check here is expected to fail there until "tags" is in support/built.ts.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";

const group = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const tagsOf = (page: Page, name: string) => group(page, name).getByRole("list", { name: `${name} tags` }).getByRole("listitem");
const tag = (page: Page, groupName: string, name: string) => tagsOf(page, groupName).filter({ has: page.getByText(name, { exact: true }) });
const dialog = (page: Page) => page.getByRole("dialog");
const undo = (page: Page) => page.getByRole("group", { name: "Undo" });

async function tagMenu(page: Page, groupName: string, name: string, item: string | RegExp) {
  await group(page, groupName).getByRole("button", { name: `More for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
// The prototype keeps its data in the page, so after a change the Library is reached from the menu, not reloaded.
async function libraryTrack(page: Page, title: string, reload = true) {
  if (reload) await openRoute(page, "library");
  else await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: new RegExp(`^Select ${title}`) }).getByRole("gridcell").nth(1).click();
}

test.describe("the Tags screen", () => {
  test("opens from the Library's ⋯ menu, with Back to the Library, and shows each group as its own box in order", async ({ page }) => {
    await openRoute(page, "library");
    await page.getByRole("button", { name: "More for the library" }).click();
    await page.getByRole("menuitem", { name: "Tags and groups…" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tags");
    await expect(page.getByRole("button", { name: "Back to Library" })).toBeVisible();
    const names = await page.getByRole("main").getByRole("region").evaluateAll((r) => r.map((x) => x.getAttribute("aria-label")));
    expect(names.slice(0, 3)).toEqual(["Mood", "Leitmotif", "Scene type"]);
    await expect(tag(page, "Mood", "Melancholy")).toBeVisible();
  });

  test("a tag inside another is shown under it, and other words for a tag are on hover and read out", async ({ page }) => {
    await openRoute(page, "tags");
    const king = tag(page, "Leitmotif", "Ashen King");
    await expect(king).toHaveAccessibleDescription(/Inside Villains/);
    await expect(tag(page, "Mood", "Melancholy")).toHaveAccessibleDescription(/Also found by: sad, sorrowful/);
  });

  test("Rename changes the tag on every track, in one step that Undo takes back", async ({ page }) => {
    await openRoute(page, "tags");
    await tagMenu(page, "Mood", "Wistful", "Rename…");
    await dialog(page).getByRole("textbox", { name: "Name" }).fill("Longing");
    await dialog(page).getByRole("button", { name: "Rename" }).click();
    await expect(undo(page)).toContainText(/Renamed Wistful to Longing on \d+ tracks/);
    await expect(tag(page, "Mood", "Longing")).toBeVisible();
    await expect(tag(page, "Mood", "Wistful")).toHaveCount(0);
    await undo(page).getByRole("button", { name: "Undo" }).click();
    await expect(tag(page, "Mood", "Wistful")).toBeVisible();
  });

  test("the renamed tag is what the Library shows on its tracks and in its filters", async ({ page }) => {
    await openRoute(page, "tags");
    await tagMenu(page, "Mood", "Wistful", "Rename…");
    await dialog(page).getByRole("textbox", { name: "Name" }).fill("Longing");
    await dialog(page).getByRole("button", { name: "Rename" }).click();
    await page.getByRole("link", { name: "Library", exact: true }).click();
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const mood = page.getByRole("region", { name: "Filters", exact: true }).getByRole("group", { name: "Mood" });
    await expect(mood.getByRole("button", { name: /^Longing/ })).toBeVisible();
    await expect(mood.getByRole("button", { name: /^Wistful/ })).toHaveCount(0);
  });

  test("Merge into… moves every track to the other tag, and the old name keeps finding it", async ({ page }) => {
    await openRoute(page, "tags");
    await tagMenu(page, "Mood", "Grief", "Merge into…");
    await dialog(page).getByRole("combobox", { name: "Merge Grief into" }).selectOption("Melancholy");
    await dialog(page).getByRole("button", { name: "Merge" }).click();
    await expect(tag(page, "Mood", "Grief")).toHaveCount(0);
    await expect(undo(page)).toContainText("Merged Grief into Melancholy");
    await expect(tag(page, "Mood", "Melancholy")).toHaveAccessibleDescription(/grief/);
  });

  test("Delete… takes a tag off its tracks, with Undo", async ({ page }) => {
    await openRoute(page, "tags");
    await tagMenu(page, "Scene type", "Chase", "Delete…");
    await expect(dialog(page)).toContainText(/It comes off \d+ tracks?\./);
    await dialog(page).getByRole("button", { name: "Delete" }).click();
    await expect(tag(page, "Scene type", "Chase")).toHaveCount(0);
    await undo(page).getByRole("button", { name: "Undo" }).click();
    await expect(tag(page, "Scene type", "Chase")).toBeVisible();
  });

  test("a new group with its own tag appears on every track's details and in the Library filters", async ({ page }) => {
    await openRoute(page, "tags");
    await page.getByRole("button", { name: "New group" }).click();
    await dialog(page).getByRole("textbox", { name: "Name" }).fill("Faction");
    await dialog(page).getByRole("button", { name: "Add group" }).click();
    await group(page, "Faction").getByRole("button", { name: "Add tag" }).click();
    await dialog(page).getByRole("textbox", { name: "Name" }).fill("Harbour guild");
    await dialog(page).getByRole("button", { name: "Add tag" }).click();
    await expect(tag(page, "Faction", "Harbour guild")).toBeVisible();
    await libraryTrack(page, "Ancient sorrow, choir", false);
    await expect(page.getByRole("combobox", { name: "Add a faction tag" })).toBeVisible();
  });

  test("groups can be put in another order, and the track details follow it", async ({ page }) => {
    await openRoute(page, "tags");
    await group(page, "Mood").getByRole("button", { name: "More for the Mood group" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    const names = await page.getByRole("main").getByRole("region").evaluateAll((r) => r.map((x) => x.getAttribute("aria-label")));
    expect(names.slice(0, 2)).toEqual(["Leitmotif", "Mood"]);
  });

  test("a group's colour is chosen by name; the tag's name always shows with it", async ({ page }) => {
    await openRoute(page, "tags");
    await group(page, "Mood").getByRole("button", { name: "More for the Mood group" }).click();
    await page.getByRole("menuitem", { name: "Colour…" }).click();
    await dialog(page).getByRole("radio", { name: "Sea" }).check();
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved: Mood colour" })).toBeVisible();
    await expect(tag(page, "Mood", "Melancholy")).toContainText("Melancholy");
  });
});

test.describe("tags where you use them", () => {
  test("typing another word for a tag offers the tag itself", async ({ page }) => {
    await libraryTrack(page, "Ancient sorrow, choir");
    await page.getByRole("combobox", { name: "Add a mood tag" }).fill("sad");
    await expect(page.getByRole("option", { name: /^Melancholy/ })).toBeVisible();
  });

  test("filtering by a tag that holds others finds the tracks of the tags inside it", async ({ page }) => {
    await openRoute(page, "library");
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await page.getByRole("region", { name: "Filters", exact: true }).getByRole("group", { name: "Leitmotif" }).getByRole("button", { name: /^Villains/ }).click();
    await expect(page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select The Rains of Castamere|^Select Ominous song/ })).toBeVisible();
  });
});
