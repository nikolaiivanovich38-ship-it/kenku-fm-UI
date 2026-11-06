/**
 * Live: running the game. Each test is one behaviour Nik approved in the prototype (design/prototype/tools/lv-keys.js).
 * Elements are found by role, accessible name and visible text only.
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { joinRoom, leaveAllRooms, openRoute } from "./support/target";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** Round 6 part 3: the running scene's box is Current scene (before: Scene music, then Current scene music). */
const sceneMusic = (page: Page) => page.getByRole("region", { name: /^(Current scene|Current scene music|Scene music)$/ });
/** Round 6 part 3: one On air box along the bottom, with a part per room (before: an On air box per room). */
const room = (page: Page, name: string) => region(page, "On air").getByRole("group", { name, exact: true });
/** Round 6 part 3: Find a track is a field in the top strip (it was the Off script box); its results open under it. */
const findField = (page: Page) => page.getByRole("searchbox", { name: /^Find a track/ });
const found = (page: Page) => region(page, "Find a track");
const openFind = async (page: Page) => {
  await findField(page).click();
  await expect(found(page)).toBeVisible();
};
/** Click on empty page: focus is on no control, so the single-key shortcuts apply. */
const clickAway = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const startFirstScene = (page: Page) => page.getByRole("button", { name: "Start: Recap and the coast road" }).click();
const startAbbey = (page: Page) => page.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
/** Round 6 part 3: the session's playlists have their own box; it plays in the room its To: names. */
const sessionPlaylists = (page: Page) => region(page, "Session playlists");
const toSideRoom = async (page: Page, box: ReturnType<typeof region>) => {
  await box.getByRole("button", { name: /choose a room/i }).click();
  await page.getByRole("menuitemradio", { name: "Side room" }).click();
};
const addSideRoom = async (page: Page) => {
  await page.getByRole("button", { name: "Add a room" }).click();
  await page.getByRole("menuitemradio", { name: /Side room/ }).click();
  await expect(room(page, "Side room")).toBeVisible();
};

test.describe("scenes and undo", () => {
  test("Space starts the next scene and the Next scene button keeps focus", async ({ page }) => {
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("Space");
    await expect(region(page, "Scenes").getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next scene: Greyhollow inn" })).toBeFocused();
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
  });

  test("Space on a button reached with Tab presses that button instead of starting a scene", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Stop all" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Keys" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("group", { name: "Keys on the live screen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start: Recap and the coast road" })).toBeVisible();
  });

  test("a strip offers Undo after a scene change, and Ctrl+Z puts back the previous scene", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await page.getByRole("button", { name: "Next scene: Crypt ambush" }).click();
    await expect(region(page, "Scenes").getByRole("status")).toContainText("Started Crypt ambush");
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await clickAway(page);
    await page.keyboard.press("Control+z");
    await expect(page.getByRole("button", { name: "Next scene: Crypt ambush" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeVisible();
  });

  test("the Undo button puts back the previous scene", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await page.getByRole("button", { name: "Next scene: Greyhollow inn" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Next scene: Greyhollow inn" })).toBeVisible();
    await expect(region(page, "Scenes").getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
  });

  test("the Undo strip goes away after about 8 seconds", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeHidden({ timeout: 12_000 });
  });

  test("Esc on its own does not fade anything, Shift+Esc fades everything out", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await clickAway(page);
    await page.keyboard.press("Escape");
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    await page.keyboard.press("Shift+Escape");
    await expect(room(page, "Table").getByText("Silent")).toBeVisible({ timeout: 10_000 });
  });

  test("the Prep | Live switch sits in the top strip with Live pressed", async ({ page }) => {
    await openRoute(page, "live");
    const modes = page.getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Prep" }).click();
    await expect(page.getByRole("heading", { name: /Session 14/, level: 1 })).toBeVisible();
  });

  test("the session menu loads another campaign's session in its own table", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: /The Sunken Crown Session 14/ }).click();
    await page.getByRole("menuitemradio", { name: /Session 4: Frost fair/ }).click();
    await expect(page.getByRole("button", { name: /The Sixth Year Session 4/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Start: / })).toBeVisible();
  });

  test("opened from another page, Live waits on standby with nothing playing", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.getByRole("link", { name: /^Live/ }).click();
    await expect(page.getByRole("button", { name: /^Start: / })).toBeVisible();
    await expect(room(page, "Table").getByText("Silent")).toBeVisible();
  });
});

test.describe("single-key shortcuts", () => {
  test("the Keys button opens a list of keys with a switch for single-key shortcuts, and Esc closes it", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Keys" }).click();
    await expect(page.getByRole("switch", { name: /Single-key shortcuts/ })).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Keys on the live screen" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Keys" })).toBeFocused();
  });

  test("with single-key shortcuts off, Space, / and pad keys do nothing", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Keys" }).click();
    await page.getByRole("switch", { name: /Single-key shortcuts/ }).click();
    await expect(page.getByRole("switch", { name: /Single-key shortcuts/ })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await clickAway(page);
    await page.keyboard.press("Space");
    await page.keyboard.press("/");
    await page.keyboard.press("1");
    await expect(page.getByRole("button", { name: "Start: Recap and the coast road" })).toBeVisible();
    await expect(page.getByRole("searchbox")).not.toBeFocused();
    await expect(room(page, "Table")).toContainText(/Silent/);
  });

  test("/ jumps to Find a track (round 6: was Off script), typing finds tracks, and Esc in the box clears it", async ({ page }) => {
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("/");
    const search = findField(page);
    await expect(search).toBeFocused();
    await page.keyboard.type("bells");
    await expect(found(page).getByText(/\d+ found/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
  });

  test("a pad key is ignored while typing in a box", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.press("/");
    await page.keyboard.type("q");
    await expect(findField(page)).toHaveValue("q");
    await expect(room(page, "Table")).not.toContainText("sounding");
  });

  test("a pad key starts that pad's sound", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.press("q");
    await expect(room(page, "Table")).toContainText(/1 sounding/);
  });
});

test.describe("choosing what plays", () => {
  test("a hold pad plays while its key is down and stops when it comes up", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.down("4");
    await expect(room(page, "Table")).toContainText(/sounding/);
    await page.keyboard.up("4");
    await expect(room(page, "Table")).not.toContainText(/sounding/);
  });

  test("Scene music (round 6: Current scene) sits above the On air box", async ({ page }) => {
    await openRoute(page, "live");
    const music = (await sceneMusic(page).boundingBox())!;
    const onAir = (await region(page, "On air").boundingBox())!;
    expect(music.y + music.height).toBeLessThanOrEqual(onAir.y + 1);
  });

  test("Play next (round 6: Add to queue) queues a track and Next music then plays it", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const queued = "Haunted sea shanty, grey and slow - the drowned bells";
    await sceneMusic(page).getByRole("button", { name: `Play next: ${queued}`, exact: true }).click();
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(room(page, "Table").getByText(queued)).toBeVisible();
  });

  test("Scene music lists the scene's tracks and playlists in order and marks the one on air", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const items = sceneMusic(page).getByRole("list", { name: /music in the order it plays/ }).getByRole("listitem");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("On air");
    await expect(items.nth(1)).toContainText("Abbey: eerie, low energy");
    await expect(items.nth(2)).toContainText("Haunted sea shanty");
    await expect(items.nth(3)).toContainText("The Abbess");
  });

  test("Next follows the scene's order into the playlist after the track, and up next is never the track already playing", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const onAir = room(page, "Table");
    await expect(onAir).toContainText("Item 1 of 4");
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(onAir).toContainText("Item 2 of 4");
    await expect(onAir).toContainText("Abbey: eerie, low energy");
    // Round 6 part 3: what comes next is the room's Up next list; its first entry is never the track on air.
    const playing = (await onAir.getByRole("group", { name: "Music in Table" }).locator("..").textContent()) ?? "";
    const first = (await onAir.getByRole("list", { name: "Up next" }).getByRole("listitem").first().textContent()) ?? "";
    expect(playing.includes(first.trim())).toBe(false);
  });

  test("a row shows the length that will play with the scene's own end point, with the end rule as a tooltip", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(sceneMusic(page).getByRole("listitem").first()).toContainText("3:10");
    await expect(room(page, "Table").getByTitle(/Ends 3:10, then next/)).toBeVisible();
  });

  test("a track's title opens its details with a link to the Audio profile for this scene, and does not play it", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Haunted sea shanty, grey and slow - the drowned bells", exact: true }).click();
    await expect(room(page, "Table")).not.toContainText("Item 3 of 4");
    await sceneMusic(page).getByRole("button", { name: /^Eerie dread, low cello/, includeHidden: false }).first().click();
    await expect(sceneMusic(page).getByRole("link", { name: /profile/i })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
  });

  test("row actions read Preview, Play next, Add to queue (round 6), Play on air, in that order", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const row = sceneMusic(page).getByRole("listitem").first();
    const names = await row.getByRole("button").evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0]));
    expect(names.filter((n) => /^(Preview|Play next|Add to queue|Play on air)$/.test(n))).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
  });

  test("a playlist in Scene music opens to show its tracks, and the box grows with it instead of scrolling inside", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const box = sceneMusic(page);
    const before = (await box.boundingBox())!.height;
    await box.getByRole("button", { name: "Show contents of The Abbess" }).click();
    await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(before + 60);
  });

  test("the scene's pads (round 6: in Current scene) offer the scene's boards as a switch", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const boards = sceneMusic(page).getByRole("group", { name: "This scene's pad boards" });
    await expect(boards.getByRole("button")).toHaveText(["Drowned Abbey", "Weather and places"]);
  });
});

test.describe("Off script search (round 6: Find a track)", () => {
  test("a tag you pick can be cleared with the X next to the tag list", async ({ page }) => {
    await openRoute(page, "live");
    await openFind(page);
    const moods = page.getByRole("group", { name: "Moods" });
    await moods.getByRole("button", { name: "Tense" }).click();
    await expect(moods.getByRole("button", { name: "Tense" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Clear selected tags" }).click();
    await expect(page.getByRole("button", { name: "Clear selected tags" })).toHaveCount(0);
    await expect(moods.getByRole("button", { name: "Tense" })).not.toHaveAttribute("aria-pressed", "true");
  });

  test("the Music, Ambience and FX filter narrows the results, and playing an effect layers it over the music", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await openFind(page);
    const off = found(page);
    await off.getByRole("group", { name: "Show" }).getByRole("button", { name: "FX", exact: true }).click();
    await findField(page).fill("door");
    await expect(off.getByText("2 found").first()).toBeVisible();
    await off.getByRole("list", { name: "Found tracks" }).getByRole("button", { name: "Play on air: Heavy door slams" }).click();
    const onAir = room(page, "Table");
    await expect(onAir.getByText("Heavy door slams")).toBeVisible();
    await expect(onAir.getByText(/Open road, wonder/)).toBeVisible();
  });
});

test.describe("rooms", () => {
  test("with no room joined On air (before: the top strip) warns that players hear nothing and offers Join Table", async ({ page }) => {
    await openRoute(page, "live");
    await leaveAllRooms(page);
    await expect(page.getByText(/players hear nothing/)).toBeVisible();
    await page.getByRole("button", { name: /Join Table/ }).click();
    await expect(room(page, "Table")).toBeVisible();
    await expect(page.getByText(/players hear nothing/)).toHaveCount(0, { timeout: 5000 });
  });

  test("with one room there is no To: choice anywhere", async ({ page }) => {
    await openRoute(page, "live");
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });

  test("a room's box has Mute, shown as the one status Muted, and a volume slider that works from the keyboard", async ({ page }) => {
    await openRoute(page, "live");
    const table = room(page, "Table");
    await table.getByRole("button", { name: "Mute Table" }).click();
    await expect(table.getByText("Muted")).toBeVisible();
    await table.getByRole("button", { name: "Mute Table" }).click();
    await expect(table.getByText("Muted")).toHaveCount(0);
    const volume = table.getByRole("slider", { name: "Volume in Table" });
    await volume.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(volume).toHaveValue("80");
    await expect(volume).toBeFocused();
  });

  test("Add a room: a second On air box for it appears, saying Silent", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await expect(room(page, "Side room").getByText(/^(Silent|Nobody there)$/)).toBeVisible();
    await expect(room(page, "Side room").getByText("Receiving")).toHaveCount(0);
  });

  test("with two rooms, each box that plays gets a To: Table choice (round 6: Current scene, Session playlists, Find a track)", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await openFind(page);
    for (const box of [sceneMusic(page), sessionPlaylists(page), found(page)]) {
      await expect(box.getByRole("button", { name: /choose a room/i })).toHaveText(/^To:\s*Table$/);
    }
  });

  test("a room that joins from Discord gets its box too", async ({ page }) => {
    await openRoute(page, "live");
    await joinRoom(page, "Lyre Side", "Whispers");
    await expect(room(page, "Whispers")).toBeVisible();
  });

  test("choosing To: Side room sends Play on air from a box (round 6: Session playlists) only to that room, and the row buttons say so", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    const music = sessionPlaylists(page);
    await toSideRoom(page, music);
    await expect(music.getByRole("button", { name: /choose a room/i })).toBeFocused();
    await expect(music.getByRole("button", { name: /choose a room/i })).toHaveText(/^To:\s*Side room$/);
    await music.getByRole("button", { name: /^Play on air in Side room: / }).first().click();
    await expect(room(page, "Side room").getByText(/^(Playing|Nobody there)$/)).toBeVisible();
    await expect(room(page, "Table").getByText("Silent")).toBeVisible();
  });

  test("Off script can send a track to a chosen room too", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await openFind(page);
    const off = found(page);
    await toSideRoom(page, off);
    await findField(page).fill("bells");
    await off.getByRole("list", { name: "Found tracks" }).getByRole("button", { name: /^Play on air in Side room/ }).first().click();
    await expect(room(page, "Side room").getByText(/^(Playing|Nobody there)$/)).toBeVisible();
    await expect(room(page, "Table").getByText("Silent")).toBeVisible();
  });

  test("a pad key plays in the room chosen for the scene's pads (round 6: in Current scene)", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await startFirstScene(page);
    await toSideRoom(page, sceneMusic(page));
    await clickAway(page);
    await page.keyboard.press("w");
    await expect(room(page, "Side room").getByText(/Storm/)).toBeVisible();
    await expect(room(page, "Table")).not.toContainText("Storm");
  });

  test("Next scene always starts in the first room, whatever the Scene music box points to", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await sceneMusic(page).getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await startFirstScene(page);
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    await expect(room(page, "Side room").getByText(/^(Silent|Nobody there)$/)).toBeVisible();
  });

  test("a room's menu offers to copy what another room is playing", async ({ page }) => {
    expectFailureUntilBuilt("round 6"); // OUT-7: the room's ⋯ menu is now its bot button
    await openRoute(page, "live");
    await addSideRoom(page);
    await toSideRoom(page, sessionPlaylists(page));
    await sessionPlaylists(page).getByRole("button", { name: /^Play on air in Side room: / }).first().click();
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    await expect(page.getByRole("menuitem", { name: /Copy what Side room is playing/ })).toBeVisible();
  });

  test("Leave (round 6: Kick) takes the room's box and the To: choices away again", async ({ page }) => {
    expectFailureUntilBuilt("round 6"); // OUT-7: Kick (×) in the room's header instead of Leave in its ⋯ menu
    await openRoute(page, "live");
    await addSideRoom(page);
    await page.getByRole("button", { name: "Kick Lyre Side from Side room" }).click();
    await expect(room(page, "Side room")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });
});

/* Round 5 (design/prototype/ROUND5.md): built in wave 4, so each check waits for "round 5" in the app. */
test.describe("round 5: the Now playing bar, names in scenes, play order and single tracks in Live", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 5"));

  test("UX-16: in Live the room boxes show what each room hears, so the Now playing bar shows only a preview, tagged Only you", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    await expect(region(page, "Now playing")).toHaveCount(0);
    await sceneMusic(page).getByRole("button", { name: /^Preview: / }).first().click();
    const bar = region(page, "Now playing");
    await expect(bar.getByRole("group", { name: "Only you", exact: true })).toContainText("Previewed from Live");
    await expect(bar.getByRole("group", { name: /^On air/ })).toHaveCount(0);
    await bar.getByRole("button", { name: "Stop the preview" }).click();
    await expect(bar).toBeHidden();
  });

  test("UX-16: with two rooms playing, the Now playing bar on a prep screen has a row for each, tagged with the room's name", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    const music = sessionPlaylists(page);
    await toSideRoom(page, music);
    await music.getByRole("button", { name: /^Play on air in Side room: / }).first().click();
    await startAbbey(page); // scenes always start in the first room, Table
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Pad boards" }).click();
    const bar = region(page, "Now playing");
    await expect(bar.getByRole("group", { name: "On air: Table" }).getByTitle("The players hear this in Table")).toHaveText("On air · Table");
    await expect(bar.getByRole("group", { name: "On air: Table" })).toContainText("Eerie dread, low cello and choir");
    await expect(bar.getByRole("group", { name: "On air: Side room" })).toBeVisible();
    await expect(bar.getByRole("slider", { name: "Volume in Side room" })).toBeVisible();
  });

  test("DAT-14: a scene's name for a track shows in its list, its On air box and the bar, with its own name on hover", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Start scene 6: Aftermath" }).click();
    await expect(room(page, "Table")).toContainText("Dawn over the abbey");
    await expect(sceneMusic(page).getByRole("button", { name: "Dawn over the abbey", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    await expect(region(page, "Now playing")).toContainText("Dawn over the abbey");
    await expect(region(page, "Now playing").getByTitle("Its own name: Release after loss, ethereal voice, resolves - end of session or death of an NPC")).toBeVisible();
  });

  test("PLY-13: a playlist in the scene's list has its play order for this scene", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(sceneMusic(page).getByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" })).toBeVisible();
    await expect(sceneMusic(page).getByRole("button", { name: "Play order of The Abbess: In order, no repeat" })).toBeVisible();
  });

  test("ORG-12: the campaign's single tracks are in its list (round 6: Campaign playlists), ready to play on air", async ({ page }) => {
    await openRoute(page, "live");
    const box = region(page, "Campaign playlists");
    await box.getByRole("button", { name: "Campaign Playlists", exact: true }).click();
    await box.getByRole("button", { name: /^Play on air: Ominous song, the villain's calling card/ }).click();
    await expect(room(page, "Table")).toContainText("Ominous song, the villain's calling card");
  });
});

/* Round 6, part 2 (design/prototype/ROUND6.md, "Your notes on 0.4.0", Nik, 6 Nov 10:34). Not built yet. */
test.describe("round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));
  const scenes = (page: Page) => region(page, "Scenes");

  test("SHW-7: clicking a scene's name unfolds its music in play order, ambience and pad boards, and changes nothing on air", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    const name = scenes(page).getByRole("button", { name: "Scene 3: The abbey ruins", exact: true });
    await name.click();
    await expect(name).toHaveAttribute("aria-expanded", "true");
    const music = scenes(page).getByRole("list", { name: "The abbey ruins: music in play order" });
    await expect(music.getByRole("listitem").first()).toContainText("Eerie dread, low cello and choir");
    await expect(music.getByRole("button", { name: /^Preview: Eerie dread/ }).first()).toBeVisible();
    const abbeyRow = scenes(page).getByRole("listitem").filter({ has: page.getByRole("list", { name: "The abbey ruins: music in play order" }) });
    await expect(abbeyRow).toContainText(/Ambience: \S/);
    await expect(abbeyRow).toContainText(/Pad boards: \S/);
    await expect(scenes(page).getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
    await expect(room(page, "Table")).not.toContainText("Eerie dread");
    await expect(scenes(page).getByRole("button", { name: "Start scene 3: The abbey ruins" })).toBeVisible();
  });

  test("SHW-7: Right unfolds a scene from the keyboard and Left folds it", async ({ page }) => {
    await openRoute(page, "live");
    const name = scenes(page).getByRole("button", { name: "Scene 4: Crypt ambush", exact: true });
    await name.focus();
    await page.keyboard.press("ArrowRight");
    await expect(name).toHaveAttribute("aria-expanded", "true");
    await expect(name).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(name).toHaveAttribute("aria-expanded", "false");
  });

  test("SHW-7: the music box is Current scene (round 6 part 3); before a scene starts it shows no scene", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "Run this session" }).click();
    const music = region(page, "Current scene");
    await expect(music.getByText("No scene yet")).toBeVisible();
    await expect(music.getByRole("list", { name: /music in the order it plays/ })).toHaveCount(0);
    await startFirstScene(page);
    await expect(music.getByRole("list", { name: "Recap and the coast road: music in the order it plays" })).toBeVisible();
  });

  test("PLY-16: Add to queue on a track puts it at the bottom of the room's Up next, where × takes it out", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const track = "Haunted sea shanty, grey and slow - the drowned bells";
    await sceneMusic(page).getByRole("button", { name: `Add to queue: ${track}` }).click();
    const upNext = room(page, "Table").getByRole("list", { name: "Up next" });
    const added = upNext.getByRole("listitem").filter({ hasText: `Added: ${track}` });
    await expect(added).toHaveCount(1);
    await expect(upNext.getByRole("listitem").last()).toContainText(`Added: ${track}`);
    await added.getByRole("button", { name: `Remove ${track} from Up next` }).click();
    await expect(upNext.getByRole("listitem").filter({ hasText: `Added: ${track}` })).toHaveCount(0);
  });

  test("PLY-16: Add to queue on a playlist queues all of it, and Undo (or Ctrl+Z) takes it back", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Add to queue: The Abbess" }).click();
    const table = room(page, "Table");
    await expect(table.getByRole("list", { name: "Up next" })).toContainText("Added: The Abbess");
    await expect(table.getByRole("status").filter({ hasText: "Added to the queue: The Abbess" })).toBeVisible();
    await clickAway(page);
    await page.keyboard.press("Control+z");
    await expect(table.getByRole("list", { name: "Up next" })).not.toContainText("Added: The Abbess");
    await expect(scenes(page).getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeVisible();
  });

  test("PLY-16: a track in an unfolded scene can be added to the queue before that scene starts", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await scenes(page).getByRole("button", { name: "Scene 6: Aftermath", exact: true }).click();
    await scenes(page).getByRole("list", { name: "Aftermath: music in play order" }).getByRole("button", { name: /^Add to queue: / }).first().click();
    // DAT-14: Up next shows the track by the scene's name for it.
    await expect(room(page, "Table").getByRole("list", { name: "Up next" })).toContainText("Added: Dawn over the abbey");
  });

  test("PLY-17: the room's music has Repeat, pressed while on, going off, all, one", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await page.getByRole("button", { name: "Next music track" }).click(); // into the playlist Abbey: eerie
    const table = room(page, "Table");
    const repeat = table.getByRole("button", { name: /^Repeat: / });
    await expect(repeat).toHaveAccessibleName("Repeat: off");
    await expect(repeat).toHaveAttribute("aria-pressed", "false");
    await repeat.click();
    await expect(repeat).toHaveAccessibleName("Repeat: all");
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    await repeat.click();
    await expect(repeat).toHaveAccessibleName("Repeat: one");
    // Round 6 part 3 (Nik, 6 Nov 12:24): the room's Repeat is for this play; the scene's play order is not changed.
    await expect(sceneMusic(page).getByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" })).toBeVisible();
  });

  test("PLY-17: each track of Current scene music has Repeat one, pressed while on", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const one = sceneMusic(page).getByRole("button", { name: "Repeat one: Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)" });
    await expect(one).toHaveAttribute("aria-pressed", "false");
    await one.click();
    await expect(one).toHaveAttribute("aria-pressed", "true");
    await expect(one).toBeVisible();
  });

  test("OUT-7: each room box shows its bot; the bot button changes the channel on the page", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    const menu = page.getByRole("menu", { name: "Room Table" });
    await expect(menu).toContainText("Lyre Table plays in");
    await menu.getByRole("menuitemradio", { name: /^Whispers/ }).click();
    await expect(room(page, "Whispers")).toBeVisible();
    await expect(room(page, "Table")).toHaveCount(0);
  });

  test("OUT-7: Kick takes the bot out at once; if the players were hearing it, Undo puts it back", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await page.getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(room(page, "Table")).toHaveCount(0);
    await page.getByRole("status").filter({ hasText: "Lyre Table left Table" }).getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table").getByText("Playing")).toBeVisible({ timeout: 5000 });
  });

  test("UX-18: Live opened from the session planner has Back to the session; Alt+Left goes there too", async ({ page }) => {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("group", { name: "Prep or live" }).getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("button", { name: "Back to Session 14" })).toBeVisible();
    await clickAway(page);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Session 14");
  });
});

/* Round 6, part 3 (design/prototype/ROUND6.md "Part 3: Live", Nik, 6 Nov 12:14, 12:24 and 12:30). Not built yet. */
test.describe("round 6, part 3: Live in seven boxes, Play next and Add to queue, Repeat per room, Repeat one saved", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));
  const BOXES = ["Scenes", "Current scene", "On air", "Session playlists", "Session pads", "Campaign playlists", "Campaign pads"];

  test("Live has seven boxes, each a region with a heading of its own name", async ({ page }) => {
    await openRoute(page, "live");
    for (const name of BOXES) {
      const box = region(page, name);
      await expect(box).toBeVisible();
      await expect(box.getByRole("heading", { level: 2 })).toHaveText(new RegExp(name.split(" ").join("\\s*"), "i"));
    }
    await expect(region(page, "Off script")).toHaveCount(0);
  });

  test("Session pads and Campaign pads (and Campaign playlists) start folded; Session playlists and the scene's pads are open", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    for (const name of ["Session pads", "Campaign pads", "Campaign playlists"]) {
      await expect(region(page, name).getByRole("button", { expanded: false }).first()).toBeVisible();
      await expect(region(page, name).getByRole("listitem")).toHaveCount(0);
    }
    await expect(sessionPlaylists(page).getByRole("listitem")).not.toHaveCount(0);
    await expect(sceneMusic(page).getByRole("group", { name: "Pads on Drowned Abbey" })).toBeVisible();
  });

  test("Alt+2 goes to Current scene and F6 to the next box, On air", async ({ page }) => {
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("Alt+2");
    await expect(sceneMusic(page).getByRole("button", { name: /Current scene/ }).first()).toBeFocused();
    await page.keyboard.press("F6");
    await expect(region(page, "On air").getByRole("button", { name: /On air/ }).first()).toBeFocused();
  });

  test("Play next goes right after the current track, Add to queue to the bottom of Up next", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Add to queue: The Abbess" }).click();
    await sceneMusic(page).getByRole("button", { name: "Play next: Haunted sea shanty, grey and slow - the drowned bells", exact: true }).click();
    const items = room(page, "Table").getByRole("list", { name: "Up next" }).getByRole("listitem");
    await expect(items.first()).toContainText("Play next: Haunted sea shanty");
    await expect(items.last()).toContainText("Added: The Abbess");
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(room(page, "Table").getByRole("group", { name: "Music in Table" }).locator("xpath=..")).toContainText("Haunted sea shanty");
  });

  test("Repeat in On air is for what plays now: after the music stops it is off again", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const repeat = room(page, "Table").getByRole("button", { name: /^Repeat: / });
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Stop all" }).click();
    await page.getByRole("button", { name: "Restart scene 3: The abbey ruins" }).click();
    await expect(room(page, "Table").getByRole("button", { name: /^Repeat: / })).toHaveAccessibleName("Repeat: off");
  });

  test("Repeat one on a scene's track is saved with the scene and shows on that track in the planner", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const name = "Repeat one: Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)";
    await sceneMusic(page).getByRole("button", { name }).click();
    await expect(room(page, "Table").getByRole("button", { name: /^Repeat: / })).toHaveAccessibleName("Repeat: one");
    await page.getByRole("group", { name: "Prep or live" }).getByRole("button", { name: "Prep" }).click();
    await page.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
    await expect(page.getByRole("button", { name }).first()).toHaveAttribute("aria-pressed", "true");
  });

  test("Find a track opens its results under the field; Esc closes them and the boxes stay where they were", async ({ page }) => {
    await openRoute(page, "live");
    const before = (await sceneMusic(page).boundingBox())!;
    await openFind(page);
    await findField(page).fill("bells");
    await expect(found(page).getByRole("list", { name: "Found tracks" }).getByRole("listitem").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(found(page)).toHaveCount(0);
    expect((await sceneMusic(page).boundingBox())!.y).toBe(before.y);
  });
});

/* Round 6, part 4: the independent review's fixes (reviews/r6-ux.md; design/prototype/ROUND6.md "Part 4: review
   fixes") and Nik's answers of 6 Nov 13:55. Not built yet. */
test.describe("round 6, part 4: the review's fixes in Live", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));
  const scenes = (page: Page) => region(page, "Scenes");
  const shanty = "Haunted sea shanty, grey and slow - the drowned bells";

  test("Must 1: Ctrl+Z takes back only the last action: after a pause it leaves the scene change alone", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await room(page, "Table").getByRole("button", { name: "Pause music" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await clickAway(page);
    await page.keyboard.press("Control+z");
    await expect(scenes(page).getByRole("listitem").filter({ hasText: "Now" })).toContainText("The abbey ruins");
  });

  test("Must 2: a bot moved to a channel with nobody in it says Nobody there, offers Move to Table, and has Undo", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    const menu = page.getByRole("menu", { name: "Room Table" });
    await expect(menu.getByRole("menuitemradio", { name: /^Side room\s*empty$/ })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /players/ })).toHaveCount(1);
    await menu.getByRole("menuitemradio", { name: /^Side room/ }).click();
    await expect(room(page, "Side room").getByText("Nobody there", { exact: true })).toBeVisible();
    await expect(room(page, "Side room").getByRole("button", { name: "Move to Table" })).toBeVisible();
    await room(page, "Side room").getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table")).toBeVisible();
  });

  test("Must 4: at 320 px Live does not scroll sideways and Find a track, Fade all, Stop all and Keys are on screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openRoute(page, "live");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    for (const control of [findField(page), page.getByRole("button", { name: "Fade all" }), page.getByRole("button", { name: "Stop all" }), page.getByRole("button", { name: "Keys" })]) {
      await expect(control).toBeInViewport();
    }
  });

  test("Must 4: in a window 400 px high each room is one line, and opens to show everything", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await openRoute(page, "live");
    await startFirstScene(page);
    const open = room(page, "Table").getByRole("button", { name: "Show everything in Table" });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await expect(room(page, "Table").getByRole("button", { name: "Pause music" })).toBeVisible();
    await open.click();
    await expect(room(page, "Table").getByRole("button", { name: /^Kick / })).toBeVisible();
  });

  test("Should 6: the session's and the campaign's boxes sit under This session and Whole campaign", async ({ page }) => {
    await openRoute(page, "live");
    const first = await page.getByRole("main").getByText("This session", { exact: true }).boundingBox();
    const second = await page.getByRole("main").getByText("Whole campaign", { exact: true }).boundingBox();
    const ssp = await sessionPlaylists(page).boundingBox();
    const cpp = await region(page, "Campaign playlists").boundingBox();
    expect(first!.y).toBeLessThan(ssp!.y);
    expect(second!.y).toBeGreaterThan(ssp!.y);
    expect(second!.y).toBeLessThan(cpp!.y);
  });

  test("Should 7: in three columns a box keeps its place when a list in the box above grows", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openRoute(page, "live");
    const before = (await region(page, "Session pads").boundingBox())!;
    await sessionPlaylists(page).getByRole("button", { name: /^Show contents of / }).first().click();
    expect((await region(page, "Session pads").boundingBox())!.y).toBe(before.y);
  });

  test("Should 8 (Nik, 6 Nov 13:55): Preview, Play next and Add to queue show on every row at rest", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    for (const name of ["Preview: The Abbess", "Play next: The Abbess", "Add to queue: The Abbess"]) {
      const button = sceneMusic(page).getByRole("button", { name, exact: true });
      expect(await button.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    }
  });

  test("Should 9: Kick shows its word from 1280 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoute(page, "live");
    await expect(page.getByRole("button", { name: "Kick Lyre Table from Table" })).toHaveText("Kick");
  });

  test("Should 10: with no bot in a voice channel, the row on air says On air · no room", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await leaveAllRooms(page);
    await sceneMusic(page).getByRole("button", { name: /^Play on air: / }).first().click();
    await expect(sceneMusic(page).getByText("On air · no room")).toBeVisible();
  });

  test("Should 11: the pads' names in Current scene are not cut at 1280 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoute(page, "live");
    await startAbbey(page);
    const pads = sceneMusic(page).getByRole("group", { name: "Pads on Drowned Abbey" }).getByRole("button");
    for (const pad of await pads.all()) {
      const cut = await pad.evaluate((el) => Array.from(el.querySelectorAll("span")).some((s) => s.children.length === 0 && s.clientWidth > 1 && s.textContent!.trim().length > 1 && (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1)));
      expect(cut, await pad.getAttribute("title")).toBe(false);
    }
  });

  test("Should 12: Help is at the foot of Live's Keys, and F1 opens it anywhere", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Keys" }).click();
    await page.getByRole("group", { name: "Keys on the live screen" }).getByRole("button", { name: "Help" }).click();
    await expect(page.getByRole("complementary", { name: "Help" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run a session in Live" })).toBeVisible();
  });

  test("Nik, 6 Nov 13:55: a new scene clears what was added; its Undo brings it back", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Add to queue: The Abbess" }).click();
    const upNext = room(page, "Table").getByRole("list", { name: "Up next" });
    await expect(upNext).toContainText("Added: The Abbess");
    await page.getByRole("button", { name: /^Next scene: / }).click();
    await expect(upNext).not.toContainText("Added:");
    await scenes(page).getByRole("button", { name: "Undo" }).click();
    await expect(upNext).toContainText("Added: The Abbess");
  });

  test("Play next of the track the scene plays next lists it once in Up next", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Play next: " + shanty, exact: true }).click();
    await expect(room(page, "Table").getByRole("list", { name: "Up next" }).getByRole("listitem").filter({ hasText: shanty })).toHaveCount(1);
  });

  test("Could 15: Back from the planner opened in Current scene's ⋯ puts focus back on that ⋯", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "More for The abbey ruins" }).click();
    await page.getByRole("menuitem", { name: "Open in the session planner" }).click();
    await page.getByRole("button", { name: "Back to Live" }).click();
    await expect(sceneMusic(page).getByRole("button", { name: "More for The abbey ruins" })).toBeFocused();
  });

  test("Could 21: the next scene's cue reads Starts when: and its words", async ({ page }) => {
    await openRoute(page, "live");
    await expect(scenes(page)).toContainText("Starts when: As the recap starts");
  });
});

/* Round 6, part 5 (design/prototype/ROUND6.md "Part 5: the Saved pop-up"; Nik, 6 Nov 16:14: "Let's kill ready, seems
   dumb. Kill the scene count, unnecessary."). Not built yet. */
test.describe("round 6, part 5: Live's Scenes box and the Saved pop-up", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));
  const scenes = (page: Page) => region(page, "Scenes");

  test("the Scenes box says neither Ready nor a scene count, before or after a scene starts, open or folded", async ({ page }) => {
    await openRoute(page, "live");
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
    await startAbbey(page);
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
    await scenes(page).getByRole("button", { name: "Scenes", exact: true }).click();
    await expect(scenes(page)).toContainText("Now: The abbey ruins");
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
  });

  test("Repeat one saved with a scene shows the Saved pop-up under the top strip, clear of On air", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const repeat = sceneMusic(page).getByRole("button", { name: /^Repeat one: / }).first();
    await repeat.click();
    const saved = page.getByRole("status").filter({ hasText: "Saved: Repeat one in The abbey ruins" });
    await expect(saved).toBeVisible();
    await expect(repeat).toBeFocused();
    const pop = await saved.boundingBox();
    const onAir = await region(page, "On air").boundingBox();
    const strip = await page.getByRole("searchbox", { name: /^Find a track/ }).boundingBox();
    if (!pop || !onAir || !strip) throw new Error("not on screen");
    expect(pop.y + pop.height).toBeLessThanOrEqual(onAir.y);
    expect(pop.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  });
});
