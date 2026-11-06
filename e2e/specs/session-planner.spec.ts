/**
 * Session planner: preparing a session's scenes (design/prototype/tools/cp-tab.js, cp-drop.js, src/views/campaigns.js).
 * Opened at the session "Session 14: The Drowned Abbey" of The Sunken Crown; its scene 3, "The abbey ruins",
 * has mixed music (track, playlist, track, playlist), an ambience playlist and two pad boards.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test, expectFailureUntilBuilt } from "./support/test";
import { openRoute } from "./support/target";
import { dropFiles } from "./support/drop";

const dialog = (page: Page) => page.getByRole("dialog");
const scene = (page: Page, name: string) => page.getByRole("listitem", { name: new RegExp(`^Scene \\d+: ${name}$`) });
const abbey = (page: Page) => scene(page, "The abbey ruins");
const musicOf = (box: Locator) => box.getByRole("group", { name: "Music", exact: true }).getByRole("list", { name: "Music in order" });
/** The names in order of a list of items: each item's first link, without the "(Track)" / "(Playlist · …)" suffix. */
const linkNames = async (list: Locator) =>
  (await list.getByRole("listitem").evaluateAll((rows) => rows.map((r) => (r.querySelector("a")?.getAttribute("aria-label") ?? r.querySelector("a")?.textContent ?? "").trim()))).map((t) =>
    t.replace(/\s*\((Track|Playlist|Pad board)[^)]*\)$/, ""),
  );

async function openAbbey(page: Page) {
  await openRoute(page, "session/crown/s14");
  await page.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
}

test.describe("the session page", () => {
  test("lists the scenes in order, each with its first music and a count of the rest", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    const scenes = page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem");
    await expect(scenes).toHaveCount(6);
    await expect(scenes.nth(1)).toContainText("Greyhollow inn");
    await expect(scenes.nth(2)).toContainText("+3 more");
  });

  test("has a Prep | Live switch and a Run this session button", async ({ page }) => {
    expectFailureUntilBuilt("live"); // it ends on the Live screen
    await openRoute(page, "session/crown/s14");
    await expect(page.getByRole("group", { name: "Prep or live" }).getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Run this session" }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start: / })).toBeVisible();
  });

  test("the Live side of the switch also opens this session in Live", async ({ page }) => {
    expectFailureUntilBuilt("live"); // it ends on the Live screen
    await openRoute(page, "session/crown/s14");
    await page.getByRole("group", { name: "Prep or live" }).getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("button", { name: /The Sunken Crown Session 14/ })).toBeVisible();
  });

  test("name, date and status are editable", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("textbox", { name: "Session name" }).fill("The Flooded Abbey");
    await expect(page.getByRole("heading", { name: "Session 14: The Flooded Abbey", level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Date" })).toHaveValue("2026-11-05");
    await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
  });

  test("session and campaign playlists are listed for the whole evening, closed by default, with Preview and Play on air", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    const session = page.getByRole("region", { name: "Session playlists", exact: true });
    await expect(session.getByRole("list", { name: "Tracks in Wistful with some warmth" })).toHaveCount(0);
    await session.getByRole("button", { name: "Show contents of Wistful with some warmth" }).click();
    await expect(session.getByRole("list", { name: "Tracks in Wistful with some warmth" })).toBeVisible();
    await expect(session.getByRole("button", { name: "Preview Wistful with some warmth" })).toBeVisible();
    await expect(session.getByRole("button", { name: "Play on air: Wistful with some warmth" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Campaign playlists", exact: true }).getByRole("link", { name: "The Company themes" })).toBeVisible();
  });
});

test.describe("a scene's music: tracks and playlists mixed, in order", () => {
  test("shows a track, a playlist, a track and a playlist in the order they play, the first one starting the scene", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    expect(await linkNames(list)).toEqual([
      "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)",
      "Abbey: eerie, low energy",
      "Haunted sea shanty, grey and slow - the drowned bells",
      "The Abbess",
    ]);
    await expect(list.getByRole("listitem").first()).toContainText("Starts the scene");
    await expect(list.getByRole("listitem").nth(1)).toContainText("Playlist · Dynamic");
    await expect(list.getByRole("listitem").nth(2)).toContainText("Track");
  });

  test("a track that has its own audio settings in this scene says so", async ({ page }) => {
    await openAbbey(page);
    await expect(musicOf(abbey(page)).getByRole("listitem").first()).toContainText("Own audio settings in this scene");
  });

  test("an item can be moved up from its menu", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: "More for The Abbess" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    expect((await linkNames(list)).slice(2)).toEqual(["The Abbess", "Haunted sea shanty, grey and slow - the drowned bells"]);
  });

  test("an item can be made to start the scene from its menu", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: "More for The Abbess" }).click();
    await page.getByRole("menuitem", { name: "Start the scene with it" }).click();
    expect((await linkNames(list))[0]).toBe("The Abbess");
    await expect(list.getByRole("listitem").first()).toContainText("Starts the scene");
  });

  test("an item can be removed from the scene, and stays in the library", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }).click();
    await page.getByRole("menuitem", { name: "Remove from this scene" }).click();
    expect(await linkNames(list)).toHaveLength(3);
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect(page.getByText("Haunted sea shanty, grey and slow - the drowned bells").first()).toBeVisible();
  });

  test("a playlist in the scene opens to show its tracks, and starts closed", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await expect(list.getByRole("list", { name: "Tracks in The Abbess" })).toHaveCount(0);
    await list.getByRole("button", { name: "Show contents of The Abbess" }).click();
    await expect(list.getByRole("list", { name: "Tracks in The Abbess" }).getByRole("listitem")).toHaveCount(5);
  });

  test("every item can be listened to with Preview, without the players hearing it", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: "Preview The Abbess" }).click();
    await expect(list.getByRole("button", { name: "Stop preview of The Abbess" })).toHaveAttribute("aria-pressed", "true");
    await list.getByRole("button", { name: /^Preview Haunted sea shanty/ }).click();
    await expect(list.getByRole("button", { name: "Stop preview of The Abbess" })).toHaveCount(0);
    await expect(list.getByRole("button", { name: /^Stop preview of Haunted sea shanty/ })).toBeVisible();
  });

  test("Add tracks or playlists… adds a ticked track and then a ticked playlist in the order they were ticked", async ({ page }) => {
    await openAbbey(page);
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    const sheet = dialog(page);
    await expect(sheet).toHaveAccessibleName(/Music for "The abbey ruins"/);
    await sheet.getByRole("checkbox", { name: /^Quiet grief, solo voice/ }).check();
    await sheet.getByRole("checkbox", { name: /^Coast road travel/ }).check();
    await sheet.getByRole("button", { name: "Done" }).click();
    const names = await linkNames(musicOf(abbey(page)));
    expect(names.slice(-2)).toEqual(["Quiet grief, solo voice - a fallen companion", "Coast road travel"]);
    expect(names).toHaveLength(6);
  });

  test("the music picker offers All, Playlists, Tracks and FX, and a search", async ({ page }) => {
    await openAbbey(page);
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    const sheet = dialog(page);
    const show = sheet.getByRole("group", { name: "Show" });
    await expect(show.getByRole("button")).toHaveText(["All", "Playlists", "Tracks", "FX"]);
    await show.getByRole("button", { name: "Tracks" }).click();
    await expect(sheet.getByRole("checkbox", { name: /^Coast road travel/ })).toHaveCount(0);
    await expect(sheet.getByRole("checkbox", { name: /^Quiet grief/ })).toBeVisible();
    await show.getByRole("button", { name: "Playlists" }).click();
    await expect(sheet.getByRole("checkbox", { name: /^Coast road travel/ })).toBeVisible();
    await sheet.getByRole("searchbox", { name: "Search the list" }).fill("Aftermath");
    await expect(sheet.getByRole("checkbox", { name: /^Aftermath/ })).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: /^Coast road travel/ })).toHaveCount(0);
  });

  test("in the picker, every playlist and track has Preview, and a playlist's tracks stay hidden until its expander is opened", async ({ page }) => {
    await openAbbey(page);
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    const sheet = dialog(page);
    await expect(sheet.getByRole("button", { name: "Show contents of Coast road travel" })).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Tracks in Coast road travel" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Preview Coast road travel" }).click();
    await expect(sheet.getByRole("button", { name: "Stop preview of Coast road travel" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Preview Quiet grief, solo voice - a fallen companion" }).click();
    await expect(sheet.getByRole("button", { name: "Stop preview of Quiet grief, solo voice - a fallen companion" })).toBeVisible();
    await sheet.getByRole("button", { name: "Show contents of Coast road travel" }).click();
    await expect(sheet.getByRole("list", { name: "Tracks in Coast road travel" })).toBeVisible();
  });

  test("Cancel in the picker changes nothing", async ({ page }) => {
    await openAbbey(page);
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    await dialog(page).getByRole("checkbox", { name: /^Coast road travel/ }).check();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    expect(await linkNames(musicOf(abbey(page)))).toHaveLength(4);
  });

  test("files dropped on a scene's music are added to the Library and to the scene, and other files are ignored", async ({ page }) => {
    await openAbbey(page);
    const music = abbey(page).getByRole("group", { name: "Music", exact: true });
    await dropFiles(music, ["01 New theme.flac", "notes.txt", "02 Second.mp3"]);
    // The app imports the files before they join the scene; wait for them (the prototype adds them at once).
    await expect(musicOf(abbey(page)).getByRole("listitem")).toHaveCount(6);
    const names = await linkNames(musicOf(abbey(page)));
    expect(names).toContain("New theme");
    expect(names).toContain("Second");
    expect(names.indexOf("New theme") + 1).toBe(names.indexOf("Second"));
    expect(names).toHaveLength(6);
    await expect(page.getByText(/2 new tracks added to the Library/)).toBeVisible();
  });

  test("something that is not a file dragged over the music is ignored", async ({ page }) => {
    await openAbbey(page);
    const music = abbey(page).getByRole("group", { name: "Music", exact: true });
    const before = await musicOf(abbey(page)).getByRole("listitem").count();
    // Dragged text adds nothing. (Whether the dragover is cancelled is not checked: in the app the page's drop guard
    // cancels every dragover at the document, so that nothing dropped can replace the page; SEC-7.)
    await music.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "hi");
      for (const type of ["dragenter", "dragover", "drop"]) {
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      }
    });
    await expect(musicOf(abbey(page)).getByRole("listitem")).toHaveCount(before);
    await expect(page.getByText(/added to the Library/)).toHaveCount(0);
  });
});

test.describe("a scene's ambience", () => {
  test("is one track or one ambience playlist, changed through a picker with Preview and expanders", async ({ page }) => {
    await openAbbey(page);
    const ambience = abbey(page).getByRole("group", { name: "Ambience", exact: true });
    await expect(ambience.getByRole("link", { name: "Abbey ambience" })).toBeVisible();
    await ambience.getByRole("button", { name: "Change…" }).click();
    const sheet = dialog(page);
    await expect(sheet.getByRole("radio", { name: /^Abbey ambience/ })).toBeChecked();
    await expect(sheet.getByRole("list", { name: "Tracks in Inn and hearth" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Show contents of Inn and hearth" }).click();
    await expect(sheet.getByRole("list", { name: "Tracks in Inn and hearth" })).toBeVisible();
    await sheet.getByRole("radio", { name: /^Wind over open moor, gusting/ }).check();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(ambience.getByRole("link", { name: /Wind over open moor, gusting/ })).toBeVisible();
  });

  test("an ambience item can be listened to with Preview and Play on air", async ({ page }) => {
    await openAbbey(page);
    const ambience = abbey(page).getByRole("group", { name: "Ambience", exact: true });
    await expect(ambience.getByRole("button", { name: "Preview Abbey ambience" })).toBeVisible();
    await expect(ambience.getByRole("button", { name: "Play on air: Abbey ambience" })).toBeVisible();
    await ambience.getByRole("button", { name: "Show contents of Abbey ambience" }).click();
    await expect(ambience.getByRole("list", { name: "Tracks in Abbey ambience" })).toBeVisible();
  });
});

test.describe("a scene's pad boards", () => {
  test("a scene can have several pad boards, the first shown when the scene starts", async ({ page }) => {
    await openAbbey(page);
    const boards = abbey(page).getByRole("group", { name: "Pad boards", exact: true }).getByRole("list", { name: "Pad boards in order" });
    expect(await linkNames(boards)).toEqual(["Drowned Abbey", "Weather and places"]);
    await expect(boards.getByRole("listitem").first()).toContainText("Shown first");
  });

  test("Add pad boards… adds another board, and the order can be changed", async ({ page }) => {
    await openAbbey(page);
    const group = abbey(page).getByRole("group", { name: "Pad boards", exact: true });
    await group.getByRole("button", { name: "Add pad boards…" }).click();
    await dialog(page).getByRole("checkbox", { name: /^Combat/ }).check();
    await dialog(page).getByRole("button", { name: "Done" }).click();
    const boards = group.getByRole("list", { name: "Pad boards in order" });
    expect(await linkNames(boards)).toEqual(["Drowned Abbey", "Weather and places", "Combat"]);
    await boards.getByRole("button", { name: "More for Drowned Abbey" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    expect(await linkNames(boards)).toEqual(["Weather and places", "Drowned Abbey", "Combat"]);
    await expect(boards.getByRole("listitem").first()).toContainText("Shown first");
  });

  test("a board's pads are hidden until its expander is opened, and each board has a Preview of its first pad", async ({ page }) => {
    await openAbbey(page);
    const boards = abbey(page).getByRole("group", { name: "Pad boards", exact: true });
    await expect(boards.getByRole("button", { name: "Preview the first pad of Drowned Abbey" })).toBeVisible();
    await boards.getByRole("button", { name: "Show contents of Drowned Abbey" }).click();
    await expect(boards.getByRole("button", { name: "Hide contents of Drowned Abbey" })).toBeVisible();
  });

  test("a board can be taken off the scene, and stays in the library", async ({ page }) => {
    await openAbbey(page);
    const boards = abbey(page).getByRole("group", { name: "Pad boards", exact: true }).getByRole("list", { name: "Pad boards in order" });
    await boards.getByRole("button", { name: "More for Weather and places" }).click();
    await page.getByRole("menuitem", { name: /^Remove from this scene/ }).click();
    expect(await linkNames(boards)).toEqual(["Drowned Abbey"]);
  });
});

test.describe("scenes", () => {
  test("a scene opens to its name, Starts when line and notes", async ({ page }) => {
    await openAbbey(page);
    await expect(abbey(page).getByRole("textbox", { name: "Starts when" })).toHaveValue("They crest the cliff path");
    await expect(abbey(page).getByRole("textbox", { name: "Notes" })).toHaveValue(/Rain all the way/);
    await abbey(page).getByRole("textbox", { name: "Name" }).fill("The abbey in the rain");
    await expect(page.getByRole("listitem", { name: /Scene 3: The abbey in the rain/ })).toBeVisible();
  });

  test("a scene can be moved down from its menu", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "More for The abbey ruins" }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem").nth(2)).toHaveAccessibleName("Scene 3: Crypt ambush");
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem").nth(3)).toHaveAccessibleName("Scene 4: The abbey ruins");
  });

  test("a scene can be dragged below another by its handle", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    const rows = page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem");
    const first = rows.nth(0);
    const third = rows.nth(2);
    const box = (await third.boundingBox())!;
    await first.getByTitle("Drag to reorder").dragTo(third, { targetPosition: { x: 40, y: box.height - 6 } });
    await expect(rows.nth(2)).toHaveAccessibleName("Scene 3: Recap and the coast road");
  });

  test("Add scene adds a scene after the current one and puts the cursor in its name", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "Add scene" }).click();
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem")).toHaveCount(7);
    await page.keyboard.type("Bells at midnight");
    await expect(page.getByRole("listitem", { name: /Bells at midnight/ })).toBeVisible();
  });

  test("a scene can be duplicated", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "More for The Abbess" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem")).toHaveCount(7);
  });

  test("deleting a scene asks first, says its tracks stay in the library, and Keep it changes nothing", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "More for Aftermath" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    const sheet = dialog(page);
    await expect(sheet).toHaveAccessibleName("Delete this scene?");
    await expect(sheet).toContainText("stay in your library");
    await sheet.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem")).toHaveCount(6);
    await page.getByRole("button", { name: "More for Aftermath" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await dialog(page).getByRole("button", { name: "Delete scene" }).click();
    await expect(page.getByRole("list", { name: "Scenes in order" }).getByRole("listitem")).toHaveCount(5);
  });
});

/* Round 5 (design/prototype/ROUND5.md): built in wave 4, so each check waits for "round 5" in the app. */
test.describe("round 5: play order, single tracks, tags, names in scenes and audio settings from the scene", () => {
  // Built (w4-prep-b). Two checks end on screens the Library stream builds (the Playlists page's play order button, a
  // track's Names in scenes), so they wait for "round 5" until that stream is merged too.
  const endsOnTheLibrarysScreens = () => expectFailureUntilBuilt("round 5");

  test("PLY-13: a playlist in a scene has a play order that applies only in that scene", async ({ page }) => {
    endsOnTheLibrarysScreens();
    await openAbbey(page);
    const list = musicOf(abbey(page));
    const order = list.getByRole("button", { name: /^Play order of Abbey: eerie, low energy: / });
    await expect(order).toHaveAccessibleName("Play order of Abbey: eerie, low energy: Shuffle, no repeat");
    await order.click();
    const menu = page.getByRole("menu", { name: "Play order" });
    await expect(menu).toContainText("Play order in the scene The abbey ruins");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Shuffle" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: /^Repeat one/ }).click();
    await expect(order).toHaveAccessibleName("Play order of Abbey: eerie, low energy: Shuffle, repeat one");
    await expect(menu.getByText(/Only in the scene The abbey ruins\. Elsewhere: In order, repeat all\./)).toBeVisible();
    await page.keyboard.press("Escape");
    // Elsewhere the playlist keeps its own order.
    await page.getByRole("link", { name: "Playlists" }).first().click();
    await expect(page.getByRole("button", { name: "Play order of Abbey: eerie, low energy: In order, repeat all" })).toBeVisible();
  });

  test("PLY-13: the scene's choice can be taken away, so the playlist's own order applies there too", async ({ page }) => {
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: /^Play order of Abbey: eerie, low energy: / }).click();
    await page.getByRole("menuitem", { name: "Use the playlist's own order here" }).click();
    await expect(list.getByRole("button", { name: /^Play order of Abbey: eerie, low energy: / })).toHaveAccessibleName("Play order of Abbey: eerie, low energy: In order, no repeat");
  });

  test("PLY-13: session playlists have a play order for the session", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    const session = page.getByRole("region", { name: "Session playlists", exact: true });
    await expect(session.getByRole("button", { name: "Play order of Wistful with some warmth: Shuffle, repeat all" })).toBeVisible();
  });

  test("ORG-10: an open playlist in Add tracks or playlists… has a box per track, to add just that track", async ({ page }) => {
    await openAbbey(page);
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    const sheet = dialog(page);
    await sheet.getByRole("searchbox", { name: "Search the list" }).fill("Ashen King");
    await sheet.getByRole("button", { name: "Show contents of Ashen King" }).click();
    const inside = sheet.getByRole("list", { name: "Tracks in Ashen King" });
    await inside.getByRole("checkbox", { name: "Gothic menace, pounding low brass - villain reveal" }).check();
    await expect(sheet.getByRole("checkbox", { name: /^Ashen King/ })).not.toBeChecked();
    await sheet.getByRole("button", { name: "Done" }).click();
    const names = await linkNames(musicOf(abbey(page)));
    expect(names).toContain("Gothic menace, pounding low brass - villain reveal");
    expect(names).not.toContain("Ashen King");
  });

  test("ORG-11: tracks in a scene's music show their tags, and so does the music picker", async ({ page }) => {
    // Built; the real library lists a track's tags in tag order (Eerie, Dread), the design in the track's own order.
    expectFailureUntilBuilt("round 5");
    await openAbbey(page);
    const first = musicOf(abbey(page)).getByRole("listitem").first();
    await expect(first).toContainText("Tags: Dread, Eerie, Drowned Abbess, Exploration");
    await expect(first).toContainText("+1");
    await abbey(page).getByRole("button", { name: "Add tracks or playlists…" }).click();
    await dialog(page).getByRole("searchbox", { name: "Search the list" }).fill("Bridge of Death");
    await expect(dialog(page)).toContainText("Tags: Dread, Eerie, Drowned Abbess, Exploration");
  });

  test("DAT-14: a track shows its name in this scene, with its own name kept beside it", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "Scene 6: Aftermath" }).click();
    const list = musicOf(scene(page, "Aftermath"));
    expect((await linkNames(list))[0]).toBe("Dawn over the abbey");
    await expect(list.getByRole("listitem").first()).toContainText("Release after loss, ethereal voice, resolves - end of session or death of an NPC");
    // Folded, the scene's chip uses the scene's name too.
    await expect(scene(page, "Crypt ambush")).toContainText("The wight rises");
  });

  test("DAT-14: Name in this scene… names a track for one scene only", async ({ page }) => {
    endsOnTheLibrarysScreens();
    await openAbbey(page);
    const list = musicOf(abbey(page));
    await list.getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }).click();
    await page.getByRole("menuitem", { name: "Name in this scene…" }).click();
    await dialog(page).getByRole("textbox", { name: 'Name in "The abbey ruins"' }).fill("The drowned bells");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    expect((await linkNames(list))[2]).toBe("The drowned bells");
    await page.getByRole("link", { name: "Library" }).first().click();
    await page.getByRole("searchbox", { name: "Search tracks" }).fill("Hoist the Colours");
    await page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select Haunted sea shanty/ }).getByRole("gridcell").nth(1).click();
    await expect(page.getByRole("region", { name: "Details", exact: true })).toContainText(/Names in scenes\s*The drowned bells\s*in The abbey ruins \(Session 14\)/);
  });

  test("PLY-14: a track in a scene opens its waveform, end and fades for that scene, and Back returns to the scene", async ({ page }) => {
    await openAbbey(page);
    await musicOf(abbey(page)).getByRole("link", { name: /^Waveform, end and fades in this scene: Eerie dread/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Eerie dread, low cello and choir");
    await expect(page.getByRole("combobox", { name: "Settings for" })).toHaveValue("sc:crown:s14:sc3");
    await expect(page.getByText(/Editing own settings for the scene The abbey ruins/)).toBeVisible();
    await page.getByRole("button", { name: "Back to The abbey ruins" }).click();
    await expect(page.getByRole("button", { name: "Scene 3: The abbey ruins" })).toHaveAttribute("aria-expanded", "true");
  });

  test("ORG-12: Use in… on a scene's track keeps it on hand for the whole session", async ({ page }) => {
    await openAbbey(page);
    await musicOf(abbey(page)).getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }).click();
    await page.getByRole("menuitem", { name: "Use in…" }).click();
    const sheet = dialog(page);
    await expect(sheet.getByRole("heading", { name: 'Use "Haunted sea shanty, grey and slow - the drowned bells" in…' })).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: /^Scene: The abbey ruins/ })).toBeChecked();
    await sheet.getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ }).check();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: "Session playlists", exact: true }).getByRole("link", { name: /^Haunted sea shanty, grey and slow - the drowned bells \(single track\)/ })).toBeVisible();
  });
});
