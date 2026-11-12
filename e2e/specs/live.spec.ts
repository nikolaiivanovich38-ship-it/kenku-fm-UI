/**
 * Live: running the game. Each test is one behaviour Nik approved in the prototype (design/prototype/tools/lv-keys.js).
 * Elements are found by role, accessible name and visible text only.
 */
import type { Page } from "@playwright/test";
import { appOnly, expect, expectFailureUntilBuilt, metByTheAppAlready, test } from "./support/test";
import { joinRoom, leaveAllRooms, openRoute } from "./support/target";

/* The app's Live is still 0.4.1's (an On air box per room, Off script, the Pads box). A check written for round 6
   part 3's Live (one On air box with a part per room, Find a track in the top strip, the scene's pads and row buttons
   in Current scene) is marked `expectFailureUntilBuilt("live")` (and any other stream it needs) with what it reads;
   e2e/specs/BUILD-LIST.md lists them for the Live stream. */
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** Round 6 part 3: the running scene's box is Current scene (before: Scene music, then Current scene music). */
const sceneMusic = (page: Page) => page.getByRole("region", { name: /^(Current scene|Current scene music|Scene music)$/ });
/** Round 6 part 3: one On air box along the bottom, with a part per room (before: an On air box per room). */
const room = (page: Page, name: string) => region(page, "On air").getByRole("group", { name, exact: true });
/** Round 6 part 3: Find a track is a field in the top strip (it was the Off script box); its results open under it. */
const findField = (page: Page) => page.getByRole("searchbox", { name: /^Find a track/ });
/** Round 6 part 6 (Nik, 17:14: "The search bar should be able to find a track or a playlist"): the results are the
 *  region "Find a track or playlist" (before: "Find a track"), with a list of Playlists, then one of Tracks. */
const found = (page: Page) => page.getByRole("region", { name: /^Find a track( or playlist)?$/ });
const foundTracks = (page: Page) => found(page).getByRole("list", { name: /^(Tracks|Found tracks)$/ });
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
/** Round 6 part 6: Session playlists (and the other trays' boxes) start folded; this unfolds a box that is folded. */
const unfold = async (box: ReturnType<typeof region>) => {
  const toggle = box.getByRole("heading", { level: 2 }).getByRole("button");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
};
const toSideRoom = async (page: Page, box: ReturnType<typeof region>) => {
  await unfold(box);
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    // UX-R6 (0.5.0 review): the strip is a group named Undo; only the hidden live region reads the change out.
    await expect(region(page, "Scenes").getByRole("group", { name: "Undo" })).toContainText("Started Crypt ambush");
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: Find a track is a field in the top strip
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
    expectFailureUntilBuilt("live"); // round 6 part 3: Find a track is a field in the top strip
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.press("/");
    // R: Stone door grinds, a pad whose sound is a library track in the app's seeded library too (not every pad's is),
    // so the check would see it sound if the key reached the pads.
    await page.keyboard.type("r");
    await expect(findField(page)).toHaveValue("r");
    await expect(room(page, "Table")).not.toContainText("sounding");
  });

  test("a pad key starts that pad's sound", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    // R: Stone door grinds, a pad whose sound is a library track in the app's seeded library too (not every pad's is).
    await page.keyboard.press("r");
    await expect(room(page, "Table")).toContainText(/1 sounding/);
  });
});

test.describe("BUG-21: renaming the session in the top strip", () => {
  test("F2 on the session, or Rename session in its menu, renames it in place; Enter saves, Esc cancels", async ({ page }) => {
    await openRoute(page, "live");
    // Round 6 keeps the session's name for screen readers only, so its name can read "Session 14 : …" (a prototype fault
    // the lead has been told of); the check is of renaming, not of that space.
    const session = (name: string) => page.getByRole("button", { name: new RegExp(`^The Sunken Crown Session 14 ?: ${name}$`) });
    await session("The Drowned Abbey").focus();
    await page.keyboard.press("F2");
    const box = page.getByRole("textbox", { name: "Name of Session 14" });
    await expect(box).toBeFocused();
    await box.fill("The Flooded Abbey");
    await box.press("Enter");
    await expect(session("The Flooded Abbey")).toBeFocused();
    await session("The Flooded Abbey").click();
    await page.getByRole("menuitem", { name: "Rename session" }).click();
    await expect(box).toBeFocused();
    await box.fill("Something else");
    await box.press("Escape");
    await expect(session("The Flooded Abbey")).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Name of Session 14" })).toHaveCount(0);
  });
});

/* Round 6 (part 3): the scene's pads are in Current scene, open, with Stop pads beside them while a pad sounds; what
   sounds shows in the room's part of On air ("1 sounding: …"), and nothing there when no pad sounds. */
test.describe("BUG-20: stopping pads", () => {
  const abbeyPads = (page: Page) => sceneMusic(page).getByRole("group", { name: "Pads on Drowned Abbey" });
  test("a pad that plays says so, and pressing it again stops it, whatever its play mode", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: the running scene's pads are in Current scene
    await openRoute(page, "live");
    await startAbbey(page);
    // Stone door grinds: a one-shot, whose sound is a library track in the app's seeded library too.
    const door = abbeyPads(page).getByRole("button", { name: /^Stone door grinds/ });
    await expect(door).toHaveAttribute("aria-pressed", "false");
    await door.click();
    await expect(door).toHaveAttribute("aria-pressed", "true");
    await expect(door).toHaveAccessibleName(/\bOn$/);
    await door.click();
    await expect(door).toHaveAttribute("aria-pressed", "false");
    await expect(room(page, "Table")).not.toContainText("sounding");
  });

  test("Stop pads beside the scene's pads stops every pad and leaves the music and ambience playing", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await startAbbey(page);
    const stop = sceneMusic(page).getByRole("button", { name: "Stop pads" });
    // Round 6: Stop pads shows only while a pad sounds (before: shown, and unavailable).
    await expect(stop).toHaveCount(0);
    await clickAway(page);
    // R: Stone door grinds (one-shot); F: Heartbeat, a hold pad, held down.
    await page.keyboard.press("r");
    await page.keyboard.down("f");
    await expect(room(page, "Table")).toContainText("2 sounding");
    await stop.click();
    await expect(room(page, "Table")).not.toContainText("sounding");
    // Stop pads goes with the last sound; focus goes to the first pad, not to the page.
    await expect(abbeyPads(page).getByRole("button", { name: /^Abbey bell/ })).toBeFocused();
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    await expect(room(page, "Table")).toContainText("Eerie dread, low cello and choir");
    await expect(room(page, "Table")).toContainText("Rain on stone and slate");
    await page.keyboard.up("f");
  });
});

test.describe("choosing what plays", () => {
  test("a hold pad plays while its key is down and stops when it comes up", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    // F: Heartbeat, a hold pad whose sound is a library track in the app's seeded library too (4, Organ swell, is not).
    await page.keyboard.down("f");
    await expect(room(page, "Table")).toContainText(/sounding/);
    await page.keyboard.up("f");
    await expect(room(page, "Table")).not.toContainText(/sounding/);
  });

  test("On air sits above Current scene (round 6 part 6: at the top; before: Scene music above On air)", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is a box at the top (part 6)
    await openRoute(page, "live");
    const music = (await sceneMusic(page).boundingBox())!;
    const onAir = (await region(page, "On air").boundingBox())!;
    expect(onAir.y + onAir.height).toBeLessThanOrEqual(music.y + 1);
  });

  test("Play next (round 6: Add to queue) queues a track and Next music then plays it", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(sceneMusic(page).getByRole("listitem").first()).toContainText("3:10");
    await expect(room(page, "Table").getByTitle(/Ends 3:10, then next/)).toBeVisible();
  });

  test("a track's title opens its details with a link to the Audio profile for this scene, and does not play it", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await startFirstScene(page);
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Haunted sea shanty, grey and slow - the drowned bells", exact: true }).click();
    await expect(room(page, "Table")).not.toContainText("Item 3 of 4");
    await sceneMusic(page).getByRole("button", { name: /^Eerie dread, low cello/, includeHidden: false }).first().click();
    await expect(sceneMusic(page).getByRole("link", { name: /profile/i })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
  });

  test("a track's Audio profile in Current scene and in Scenes opens the Audio profile, the music still on air, and Back comes back to Live (Nik, 0.5.0 crash)", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    for (const box of ["Current scene", "Scenes"]) {
      const where = box === "Scenes" ? region(page, "Scenes") : sceneMusic(page);
      if (box === "Scenes") {
        const scene = where.getByRole("button", { name: "Scene 3: The abbey ruins", exact: true });
        if ((await scene.getAttribute("aria-expanded")) !== "true") await scene.click();
      }
      await where.getByRole("button", { name: /^Eerie dread, low cello/, includeHidden: false }).first().click();
      await where.getByRole("link", { name: /Audio profile/ }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Audio profile");
      await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Now playing" }).getByText(/^Eerie dread/).first()).toBeVisible();
      await page.getByRole("button", { name: /^Back/ }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Live" })).toBeVisible();
    }
  });

  test("row actions read Preview, Play next, Add to queue (round 6), Play on air, in that order", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: each row has Add to queue
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
    expectFailureUntilBuilt("live"); // round 6 part 3: the running scene's pads are in Current scene
    await openRoute(page, "live");
    await startAbbey(page);
    const boards = sceneMusic(page).getByRole("group", { name: "This scene's pad boards" });
    await expect(boards.getByRole("button")).toHaveText(["Drowned Abbey", "Weather and places"]);
  });
});

test.describe("Off script search (round 6: Find a track)", () => {
  test("a tag you pick can be cleared with the X next to the tag list", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: Find a track is a field in the top strip
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
    expectFailureUntilBuilt("live"); // round 6 part 3: Find a track is a field in the top strip
    await openRoute(page, "live");
    await startFirstScene(page);
    await openFind(page);
    const off = found(page);
    await off.getByRole("group", { name: "Show" }).getByRole("button", { name: "FX", exact: true }).click();
    await findField(page).fill("door");
    await expect(off.getByText("2 found").first()).toBeVisible();
    await foundTracks(page).getByRole("button", { name: "Play on air: Heavy door slams" }).click();
    const onAir = room(page, "Table");
    await expect(onAir.getByText("Heavy door slams")).toBeVisible();
    await expect(onAir.getByText(/Open road, wonder/)).toBeVisible();
  });
});

test.describe("rooms", () => {
  test("with no room joined On air (before: the top strip) warns that players hear nothing and offers Join Table", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await leaveAllRooms(page);
    await expect(page.getByText(/players hear nothing/)).toBeVisible();
    await page.getByRole("button", { name: /Join Table/ }).click();
    await expect(room(page, "Table")).toBeVisible();
    await expect(page.getByText(/players hear nothing/)).toHaveCount(0, { timeout: 5000 });
  });

  test("BUG-19: with no room joined, what plays says nobody hears it, in its On air box and in the Now playing bar", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await leaveAllRooms(page);
    await startFirstScene(page);
    // Round 6 (part 3): one On air box, with a part called No room while no bot is in a voice channel.
    await expect(room(page, "No room").getByText("Nobody hears it")).toBeVisible();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    const row = region(page, "Now playing").getByRole("group", { name: "On air: no room" });
    await expect(row).toContainText("No bot is in a voice channel: nobody hears it");
  });

  test("with one room there is no To: choice anywhere", async ({ page }) => {
    await openRoute(page, "live");
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });

  test("a room's box has Mute, shown as the one status Muted, and a volume slider that works from the keyboard", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await addSideRoom(page);
    await expect(room(page, "Side room").getByText(/^(Silent|Nobody there)$/)).toBeVisible();
    await expect(room(page, "Side room").getByText("Receiving")).toHaveCount(0);
  });

  test("with two rooms, each box that plays gets a To: Table choice (round 6: Current scene, Session playlists, Find a track)", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await addSideRoom(page);
    await unfold(sessionPlaylists(page));
    await openFind(page);
    for (const box of [sceneMusic(page), sessionPlaylists(page), found(page)]) {
      await expect(box.getByRole("button", { name: /choose a room/i })).toHaveText(/^To:\s*Table$/);
    }
  });

  test("a room that joins from Discord gets its box too", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await joinRoom(page, "Lyre Side", "Whispers");
    await expect(room(page, "Whispers")).toBeVisible();
  });

  test("choosing To: Side room sends Play on air from a box (round 6: Session playlists) only to that room, and the row buttons say so", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await addSideRoom(page);
    await openFind(page);
    const off = found(page);
    await toSideRoom(page, off);
    await findField(page).fill("bells");
    await foundTracks(page).getByRole("button", { name: /^Play on air in Side room/ }).first().click();
    await expect(room(page, "Side room").getByText(/^(Playing|Nobody there)$/)).toBeVisible();
    await expect(room(page, "Table").getByText("Silent")).toBeVisible();
  });

  test("a pad key plays in the room chosen for the scene's pads (round 6: in Current scene)", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await addSideRoom(page);
    await startFirstScene(page);
    await toSideRoom(page, sceneMusic(page));
    await clickAway(page);
    // 1: Thunder crack on Weather and places, a pad whose sound is a library track in the app's seeded library too
    // (W, Storm, is not).
    await page.keyboard.press("1");
    await expect(room(page, "Side room").getByText(/Thunder/)).toBeVisible();
    await expect(room(page, "Table")).not.toContainText("Thunder");
  });

  test("Next scene always starts in the first room, whatever the Scene music box points to", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
    await openRoute(page, "live");
    await addSideRoom(page);
    await sceneMusic(page).getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await startFirstScene(page);
    await expect(room(page, "Table").getByText("Playing")).toBeVisible();
    await expect(room(page, "Side room").getByText(/^(Silent|Nobody there)$/)).toBeVisible();
  });

  test("a room's menu offers to copy what another room is playing", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings"); // OUT-7: the room's ⋯ menu is now its bot button
    await openRoute(page, "live");
    await addSideRoom(page);
    await toSideRoom(page, sessionPlaylists(page));
    await sessionPlaylists(page).getByRole("button", { name: /^Play on air in Side room: / }).first().click();
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    await expect(page.getByRole("menuitem", { name: /Copy what Side room is playing/ })).toBeVisible();
  });

  test("Leave (round 6: Kick) takes the room's box and the To: choices away again", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings"); // OUT-7: Kick (×) in the room's header instead of Leave in its ⋯ menu
    await openRoute(page, "live");
    await addSideRoom(page);
    await page.getByRole("button", { name: "Kick Lyre Side from Side room" }).click();
    await expect(room(page, "Side room")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });
});

/* Round 5 (design/prototype/ROUND5.md), built in Live in wave 4 (w4-live). */
test.describe("round 5: the Now playing bar, names in scenes, play order and single tracks in Live", () => {
  test("UX-16: in Live the room boxes show what each room hears, so the Now playing bar shows only a preview, tagged Only you", async ({ page }) => {
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: On air is one box with a part per room
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
    expectFailureUntilBuilt("live"); // round 6 part 3: the campaign's playlists are the Campaign playlists box
    await openRoute(page, "live");
    const box = region(page, "Campaign playlists");
    await box.getByRole("button", { name: "Campaign Playlists", exact: true }).click();
    await box.getByRole("button", { name: /^Play on air: Ominous song, the villain's calling card/ }).click();
    await expect(room(page, "Table")).toContainText("Ominous song, the villain's calling card");
  });
});

/* Round 6, part 2 (design/prototype/ROUND6.md, "Your notes on 0.4.0", Nik, 6 Nov 10:34). Not built yet. */
test.describe("round 6: see a scene before it starts, Add to queue, Repeat, and the room's bot", () => {
  const scenes = (page: Page) => region(page, "Scenes");

  test("SHW-7: clicking a scene's name unfolds its music in play order, ambience and pad boards, and changes nothing on air", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: "Run this session" }).click();
    const music = region(page, "Current scene");
    await expect(music.getByText("No scene yet")).toBeVisible();
    await expect(music.getByRole("list", { name: /music in the order it plays/ })).toHaveCount(0);
    await startFirstScene(page);
    await expect(music.getByRole("list", { name: "Recap and the coast road: music in the order it plays" })).toBeVisible();
  });

  test("PLY-16: Add to queue on a track puts it at the bottom of the room's Up next, where × takes it out", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Add to queue: The Abbess" }).click();
    const table = room(page, "Table");
    await expect(table.getByRole("list", { name: "Up next" })).toContainText("Added: The Abbess");
    await expect(table.getByRole("group", { name: "Undo" }).filter({ hasText: "Added to the queue: The Abbess" })).toBeVisible();
    await clickAway(page);
    await page.keyboard.press("Control+z");
    await expect(table.getByRole("list", { name: "Up next" })).not.toContainText("Added: The Abbess");
    await expect(scenes(page).getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeVisible();
  });

  test("PLY-16: a track in an unfolded scene can be added to the queue before that scene starts", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startFirstScene(page);
    await scenes(page).getByRole("button", { name: "Scene 6: Aftermath", exact: true }).click();
    await scenes(page).getByRole("list", { name: "Aftermath: music in play order" }).getByRole("button", { name: /^Add to queue: / }).first().click();
    // DAT-14: Up next shows the track by the scene's name for it.
    await expect(room(page, "Table").getByRole("list", { name: "Up next" })).toContainText("Added: Dawn over the abbey");
  });

  test("PLY-17: the room's music has Repeat, pressed while on, going off, all, one", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    const one = sceneMusic(page).getByRole("button", { name: "Repeat one: Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)" });
    await expect(one).toHaveAttribute("aria-pressed", "false");
    await one.click();
    await expect(one).toHaveAttribute("aria-pressed", "true");
    await expect(one).toBeVisible();
  });

  test("OUT-7: each room box shows its bot; the bot button changes the channel on the page", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings");
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    const menu = page.getByRole("menu", { name: "Room Table" });
    await expect(menu).toContainText("Lyre Table plays in");
    await menu.getByRole("menuitemradio", { name: /^Whispers/ }).click();
    await expect(room(page, "Whispers")).toBeVisible();
    await expect(room(page, "Table")).toHaveCount(0);
  });

  test("OUT-7: Kick takes the bot out at once; if the players were hearing it, Undo puts it back", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings");
    await openRoute(page, "live");
    await startFirstScene(page);
    await page.getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(room(page, "Table")).toHaveCount(0);
    await page.getByRole("group", { name: "Undo" }).filter({ hasText: "Lyre Table left Table" }).getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table").getByText("Playing")).toBeVisible({ timeout: 5000 });
  });

  test("UX-18: Live opened from the session planner has Back to the session; Alt+Left goes there too", async ({ page }) => {
    expectFailureUntilBuilt("shell");
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
  const BOXES = ["Scenes", "Current scene", "On air", "Session playlists", "Session pads", "Campaign playlists", "Campaign pads"];

  test("Live has seven boxes, each a region with a heading of its own name", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    for (const name of BOXES) {
      const box = region(page, name);
      await expect(box).toBeVisible();
      await expect(box.getByRole("heading", { level: 2 })).toHaveText(new RegExp(name.split(" ").join("\\s*"), "i"));
    }
    await expect(region(page, "Off script")).toHaveCount(0);
  });

  test("the session's and the campaign's boxes start folded (part 6: Session playlists too); the scene's pads are open", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    for (const name of ["Session playlists", "Session pads", "Campaign pads", "Campaign playlists"]) {
      await expect(region(page, name).getByRole("button", { expanded: false }).first()).toBeVisible();
      await expect(region(page, name).getByRole("listitem")).toHaveCount(0);
    }
    await expect(sceneMusic(page).getByRole("group", { name: "Pads on Drowned Abbey" })).toBeVisible();
  });

  test("Alt+3 goes to Current scene (part 6: On air is box 1) and F6 to the next box, Session playlists", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("Alt+3");
    await expect(sceneMusic(page).getByRole("button", { name: /Current scene/ }).first()).toBeFocused();
    await page.keyboard.press("F6");
    await expect(sessionPlaylists(page).getByRole("button", { name: /Session\s*playlists/i }).first()).toBeFocused();
    await page.keyboard.press("Alt+1");
    await expect(region(page, "On air").getByRole("button", { name: /On air/ }).first()).toBeFocused();
  });

  test("Play next goes right after the current track, Add to queue to the bottom of Up next", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live", "prep");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    const before = (await sceneMusic(page).boundingBox())!;
    await openFind(page);
    await findField(page).fill("bells");
    await expect(foundTracks(page).getByRole("listitem").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(found(page)).toHaveCount(0);
    // UX-R4 (0.5.0 review): focus stays in the field, not on the page.
    await expect(findField(page)).toBeFocused();
    expect((await sceneMusic(page).boundingBox())!.y).toBe(before.y);
  });
});

/* Round 6, part 4: the independent review's fixes (reviews/r6-ux.md; design/prototype/ROUND6.md "Part 4: review
   fixes") and Nik's answers of 6 Nov 13:55. Not built yet. */
test.describe("round 6, part 4: the review's fixes in Live", () => {
  const scenes = (page: Page) => region(page, "Scenes");
  const shanty = "Haunted sea shanty, grey and slow - the drowned bells";

  test("Must 1: Ctrl+Z takes back only the last action: after a pause it leaves the scene change alone", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await room(page, "Table").getByRole("button", { name: "Pause music" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await clickAway(page);
    await page.keyboard.press("Control+z");
    await expect(scenes(page).getByRole("listitem").filter({ hasText: "Now" })).toContainText("The abbey ruins");
  });

  test("Must 2: a bot moved to a channel with nobody in it says Nobody there, offers Move to Table, and has Undo", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings");
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
    expectFailureUntilBuilt("live");
    await page.setViewportSize({ width: 320, height: 640 });
    await openRoute(page, "live");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    for (const control of [findField(page), page.getByRole("button", { name: "Fade all" }), page.getByRole("button", { name: "Stop all" }), page.getByRole("button", { name: "Keys" })]) {
      await expect(control).toBeInViewport();
    }
  });

  test("Must 4: in a window 400 px high each room is one line, and opens to show everything", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    const first = await page.getByRole("main").getByText("This session", { exact: true }).boundingBox();
    const second = await page.getByRole("main").getByText("Whole campaign", { exact: true }).boundingBox();
    const ssp = await sessionPlaylists(page).boundingBox();
    const cpp = await region(page, "Campaign playlists").boundingBox();
    expect(first!.y).toBeLessThan(ssp!.y);
    expect(second!.y).toBeGreaterThan(ssp!.y);
    expect(second!.y).toBeLessThan(cpp!.y);
  });

  test("Should 7, replaced by Nik's 21:59 (part 7): when a list in a tray grows, the box under it moves down and the page grows", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openRoute(page, "live");
    await sessionPlaylists(page).getByRole("button", { name: /Session\s*playlists/i }).first().click();
    const before = (await region(page, "Session pads").boundingBox())!;
    await sessionPlaylists(page).getByRole("button", { name: /^Show contents of / }).first().click();
    expect((await region(page, "Session pads").boundingBox())!.y).toBeGreaterThan(before.y);
  });

  test("Should 8 (Nik, 6 Nov 13:55): Preview, Play next and Add to queue show on every row at rest", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    for (const name of ["Preview: The Abbess", "Play next: The Abbess", "Add to queue: The Abbess"]) {
      const button = sceneMusic(page).getByRole("button", { name, exact: true });
      expect(await button.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    }
  });

  test("Should 9: Kick shows its word from 1280 px", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings");
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoute(page, "live");
    await expect(page.getByRole("button", { name: "Kick Lyre Table from Table" })).toHaveText("Kick");
  });

  test("Should 10: with no bot in a voice channel, the row on air says On air · no room", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await leaveAllRooms(page);
    await sceneMusic(page).getByRole("button", { name: /^Play on air: / }).first().click();
    await expect(sceneMusic(page).getByText("On air · no room")).toBeVisible();
  });

  test("Should 11: the pads' names in Current scene are not cut at 1280 px", async ({ page }) => {
    metByTheAppAlready("the app's Scene music shows the pads' names whole at 1280 px");
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
    expectFailureUntilBuilt("shell");
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Keys" }).click();
    await page.getByRole("group", { name: "Keys on the live screen" }).getByRole("button", { name: "Help" }).click();
    await expect(page.getByRole("complementary", { name: "Help" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run a session in Live" })).toBeVisible();
  });

  test("Nik, 6 Nov 13:55: a new scene clears what was added; its Undo brings it back", async ({ page }) => {
    expectFailureUntilBuilt("live");
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
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "Play next: " + shanty, exact: true }).click();
    await expect(room(page, "Table").getByRole("list", { name: "Up next" }).getByRole("listitem").filter({ hasText: shanty })).toHaveCount(1);
  });

  test("Could 15: Back from the planner opened in Current scene's ⋯ puts focus back on that ⋯", async ({ page }) => {
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "live");
    await startAbbey(page);
    await sceneMusic(page).getByRole("button", { name: "More for The abbey ruins" }).click();
    await page.getByRole("menuitem", { name: "Open in the session planner" }).click();
    await page.getByRole("button", { name: "Back to Live" }).click();
    await expect(sceneMusic(page).getByRole("button", { name: "More for The abbey ruins" })).toBeFocused();
  });

  test("Could 21: the next scene's cue reads Starts when: and its words", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await expect(scenes(page)).toContainText("Starts when: As the recap starts");
  });
});

/* Round 6, part 5 (design/prototype/ROUND6.md "Part 5: the Saved pop-up"; Nik, 6 Nov 16:14: "Let's kill ready, seems
   dumb. Kill the scene count, unnecessary."). Not built yet. */
test.describe("round 6, part 5: Live's Scenes box and the Saved pop-up", () => {
  const scenes = (page: Page) => region(page, "Scenes");

  test("the Scenes box says neither Ready nor a scene count, before or after a scene starts, open or folded", async ({ page }) => {
    expectFailureUntilBuilt("shell");
    await openRoute(page, "live");
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
    await startAbbey(page);
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
    await scenes(page).getByRole("button", { name: "Scenes", exact: true }).click();
    await expect(scenes(page)).toContainText("Now: The abbey ruins");
    await expect(scenes(page).getByText(/^Ready$|^Scene \d+ of \d+$|^\d+ scenes$/)).toHaveCount(0);
  });

  test("Repeat one saved with a scene shows the Saved pop-up (part 6: at the bottom right), clear of On air", async ({ page }) => {
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "live");
    await startAbbey(page);
    const repeat = sceneMusic(page).getByRole("button", { name: /^Repeat one: / }).first();
    await repeat.click();
    const saved = page.getByRole("status").filter({ hasText: "Saved: Repeat one in The abbey ruins" });
    await expect(saved).toBeVisible();
    await expect(repeat).toBeFocused();
    const pop = await saved.boundingBox();
    const onAir = await region(page, "On air").boundingBox();
    if (!pop || !onAir) throw new Error("not on screen");
    expect(pop.y).toBeGreaterThanOrEqual(onAir.y + onAir.height);
  });
});

/* Round 6, part 6 (design/prototype/ROUND6.md "Part 6"; Nik, 6 Nov 17:14: "let's put the on air box at the top of the
   screen, across the whole screen, beneath the top bar with search in it. Let's let the Scenes and current scene boxes
   adjust their height dynamically based on their contents"). Not built yet. */
test.describe("round 6, part 6: On air at the top, Back and the trail, Find playlists, full rows in Scenes", () => {
  const scenes = (page: Page) => region(page, "Scenes");
  const top = (page: Page) => findField(page);
  const box = async (l: ReturnType<Page["getByRole"]>) => {
    const b = await l.boundingBox();
    if (!b) throw new Error("not on screen");
    return b;
  };
  /** Whether anything inside the box scrolls (a box that takes the height of its contents scrolls nowhere inside). */
  const scrollsInside = (l: ReturnType<Page["getByRole"]>) =>
    l.evaluate((el) => [el, ...Array.from(el.querySelectorAll("*"))].some((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1));
  /** The names of a row's buttons, in order, without what they act on ("Play next: X" is "Play next"). */
  const rowButtons = (row: ReturnType<Page["getByRole"]>) =>
    row.evaluate((el) => Array.from(el.querySelectorAll(":scope > div button")).map((b) => (b.getAttribute("aria-label") || b.textContent || "").split(":")[0].replace(/ in .*$/, "").trim()).filter((n) => /^(Preview|Play next|Add to queue|Play on air)$/.test(n)));

  test("On air is at the top, the whole width, right under the top strip; Scenes and Current scene come under it", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openRoute(page, "live");
    const onAir = await box(region(page, "On air"));
    const strip = await box(top(page));
    const main = await box(page.getByRole("main"));
    expect(onAir.y).toBeGreaterThanOrEqual(strip.y + strip.height);
    expect(onAir.y - (strip.y + strip.height)).toBeLessThanOrEqual(24);
    expect(onAir.width).toBeGreaterThanOrEqual(main.width - 40);
    for (const name of ["Scenes", "Current scene"]) expect((await box(region(page, name))).y).toBeGreaterThanOrEqual(onAir.y + onAir.height);
  });

  for (const [width, height] of [[1280, 800], [960, 1000]]) {
    test(`at ${width}×${height}, with a scene playing, the start of Scenes and of Current scene is in view without scrolling`, async ({ page }) => {
      metByTheAppAlready("the app's Next scene button and the first row of Scene music are in view at this size");
      await page.setViewportSize({ width, height });
      await openRoute(page, "live");
      await startAbbey(page);
      await expect(scenes(page).getByRole("button", { name: /^Next scene: / })).toBeInViewport();
      await expect(sceneMusic(page).getByRole("list", { name: /music in the order it plays/ }).getByRole("listitem").first()).toBeInViewport();
    });
  }

  test("Scenes and Current scene take the height of their contents: nothing scrolls inside them", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openRoute(page, "live");
    await startAbbey(page);
    await scenes(page).getByRole("button", { name: "Scene 4: Crypt ambush", exact: true }).click();
    await scenes(page).getByRole("button", { name: "Scene 6: Aftermath", exact: true }).click();
    expect(await scrollsInside(scenes(page))).toBe(false);
    expect(await scrollsInside(sceneMusic(page))).toBe(false);
  });

  test("the trays grow with their contents: every box in This session and Whole campaign opened, nothing scrolls inside them, the page scrolls (Nik, 21:59)", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await page.setViewportSize({ width: 1280, height: 800 });
    await openRoute(page, "live");
    const boxes = ["Session playlists", "Session pads", "Campaign playlists", "Campaign pads"].map((n) => region(page, n));
    for (const b of boxes) await unfold(b);
    for (const b of boxes) expect(await scrollsInside(b)).toBe(false);
    const last = await box(boxes[3]);
    expect(last.y + last.height).toBeGreaterThan(800);
    await boxes[3].getByRole("heading", { level: 2 }).scrollIntoViewIfNeeded();
    await expect(boxes[3].getByRole("heading", { level: 2 })).toBeInViewport();
  });

  test("Session playlists start folded, and stay open once unfolded, also after leaving Live", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    const toggle = sessionPlaylists(page).getByRole("button", { name: /Session\s*playlists/i }).first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(sessionPlaylists(page).getByRole("listitem").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: /^Live/ }).click();
    await expect(sessionPlaylists(page).getByRole("button", { name: /Session\s*playlists/i }).first()).toHaveAttribute("aria-expanded", "true");
  });

  test("a long Up next (over four lines) folds to one line with how many more, and unfolds", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    const upNext = room(page, "Table").getByRole("list", { name: "Up next" });
    await sceneMusic(page).getByRole("button", { name: "Add to queue: The Abbess", exact: true }).click();
    await expect(upNext).toContainText("Added: The Abbess");
    for (const i of [0, 1, 2]) await sceneMusic(page).getByRole("button", { name: /^Add to queue: / }).nth(i).click();
    await expect(upNext.getByRole("listitem")).toHaveCount(1);
    const more = upNext.getByRole("button", { name: /^\d+ more$/ });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(upNext.getByRole("listitem").filter({ hasText: "Added:" })).toHaveCount(4);
  });

  test("Keys lists the boxes in their new order: Alt+1 is On air, then Scenes and Current scene", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Keys" }).click();
    await expect(page.getByRole("group", { name: "Keys on the live screen" })).toContainText("On air, Scenes, Current scene, Session playlists");
  });

  test("Back is the first thing in Live's top strip; as the first screen it is there, greyed, saying why (part 7)", async ({ page }) => {
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "live");
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toHaveAttribute("aria-disabled", "true");
    await expect(back).toHaveAttribute("title", /nothing to go back to/i);
    const b = await box(back);
    for (const other of [page.getByRole("group", { name: "Prep or live" }), top(page)]) expect((await box(other)).x).toBeGreaterThan(b.x);
    // Playwright will not click an aria-disabled button by itself; a person can, and nothing happens.
    await back.click({ force: true });
    await expect(region(page, "Scenes")).toBeVisible();
  });

  test("the trail in Live is Campaign › Session; Back after Run does not repeat the campaign the trail shows", async ({ page }) => {
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "campaign/crown");
    await page.getByRole("button", { name: /^Run next session/ }).click();
    const trail = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(trail.getByRole("link", { name: "The Sunken Crown" })).toBeVisible();
    const back = page.getByRole("button", { name: "Back to The Sunken Crown" });
    await expect(back).toHaveText("");
    expect((await box(trail)).x).toBeGreaterThan((await box(back)).x);
    await trail.getByRole("link", { name: "The Sunken Crown" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The Sunken Crown");
  });

  test("Find finds playlists and tracks: Playlists first, each with the row's buttons; a playlist unfolds to its tracks", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await expect(page.getByRole("searchbox", { name: /^Find a track or playlist/ })).toBeVisible();
    await openFind(page);
    await findField(page).fill("abbess");
    const lists = found(page).getByRole("list", { name: /^(Playlists|Tracks)$/ });
    await expect(lists.first()).toHaveAccessibleName("Playlists");
    const pl = found(page).getByRole("list", { name: "Playlists" }).getByRole("listitem").filter({ hasText: "The Abbess" }).first();
    expect(await rowButtons(pl)).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    await pl.getByRole("button", { name: /^Show contents of / }).click();
    await expect(pl.getByRole("list", { name: "Tracks in The Abbess" }).getByRole("listitem").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await findField(page).focus();
    await page.keyboard.press("Escape");
    await expect(findField(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(found(page)).toHaveCount(0);
  });

  test("an unfolded scene's tracks and playlists have Preview, Play next, Add to queue and Play on air, as Current scene", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await scenes(page).getByRole("button", { name: "Scene 4: Crypt ambush", exact: true }).click();
    const rows = scenes(page).getByRole("list", { name: "Crypt ambush: music in play order" }).locator(":scope > li");
    expect(await rows.count()).toBe(4);
    for (const row of await rows.all()) expect(await rowButtons(row)).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    const current = sceneMusic(page).getByRole("list", { name: /music in the order it plays/ }).locator(":scope > li").first();
    expect(await rowButtons(current)).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
  });

  test("Play on air in a scene that is not running plays that track in the room and does not start the scene", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await scenes(page).getByRole("button", { name: "Scene 6: Aftermath", exact: true }).click();
    await scenes(page).getByRole("list", { name: "Aftermath: music in play order" }).getByRole("button", { name: /^Play on air: Dawn over the abbey/ }).click();
    await expect(room(page, "Table")).toContainText("Dawn over the abbey");
    await expect(scenes(page).getByRole("listitem").filter({ hasText: "Now" }).first()).toContainText("The abbey ruins");
    await expect(sceneMusic(page).getByRole("list", { name: "The abbey ruins: music in the order it plays" })).toBeVisible();
  });

  test("the ambience of an unfolded scene (Great hall) has the same buttons, and Play on air changes the room's ambience", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await page.getByRole("button", { name: /The Sunken Crown Session 14/ }).click();
    await page.getByRole("menuitemradio", { name: /Session 4: Frost fair/ }).click();
    await scenes(page).getByRole("button", { name: "Scene 1: Breakfast in the great hall", exact: true }).click();
    const hall = scenes(page).getByRole("group", { name: "Ambience: Great hall" });
    expect(await hall.evaluate((el) => Array.from(el.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || "").split(":")[0]))).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    await hall.getByRole("button", { name: "Play on air: Great hall" }).click();
    await expect(room(page, "Table")).toContainText("Great hall at dinner");
    await expect(scenes(page).getByRole("button", { name: /^Start: Breakfast in the great hall/ })).toBeVisible();
  });
});

/* Round 7, part 2 (design/prototype/ROUND7.md, "Round 7, part 2: Live"): what Live needs from round 7. The prototype
   keeps its data in the page, so a change made on a prep screen is taken to Live by the menu, not by openRoute. */
test.describe("round 7, part 2: Live", () => {
  const goLive = (page: Page) => page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: /^Live/ }).click();
  const scenes = (page: Page) => region(page, "Scenes");
  async function sceneSteps(page: Page, scene: string) {
    await openRoute(page, "session/crown/s14");
    await page.getByRole("button", { name: `More for ${scene}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "What it does when it starts…" }).click();
    return page.getByRole("dialog");
  }

  test("What played opens in the room itself, newest first, with Play again and Play next; nothing covers On air", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startAbbey(page);
    await page.getByRole("button", { name: "Next music track" }).click();
    const table = room(page, "Table");
    await table.getByRole("button", { name: "What played" }).click();
    await expect(table.getByRole("button", { name: "What played" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const played = table.getByRole("list", { name: "What played in Table" }).getByRole("listitem");
    await expect(played.nth(1)).toContainText("Eerie dread");
    await played.nth(1).getByRole("button", { name: /^Play again: / }).click();
    await expect(table.getByRole("list", { name: "What played in Table" })).toHaveCount(0);
    await expect(table).toContainText("Eerie dread");
  });

  test("a scene that moves on by itself says so in Scenes, and its own steps run when it starts", async ({ page }) => {
    expectFailureUntilBuilt("live", "prep");
    const d = await sceneSteps(page, "The abbey ruins");
    await d.getByRole("button", { name: "Add a step" }).click();
    await page.getByRole("menuitem", { name: "Fire a pad…" }).click();
    await d.getByRole("list", { name: "Steps" }).getByRole("listitem").nth(3).getByRole("combobox", { name: "Pad" }).selectOption({ label: "Drowned Abbey › Abbey bell" });
    await d.getByRole("combobox", { name: "Then" }).selectOption({ label: "Start the next scene when its music ends" });
    await d.getByRole("button", { name: "Done" }).click();
    await goLive(page);
    const row = scenes(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: "Scene 3: The abbey ruins", exact: true }) });
    await expect(row).toContainText("Moves on by itself");
    await startAbbey(page);
    await expect(sceneMusic(page).getByRole("button", { name: /^Abbey bell/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("a play step set to Play next from a marker waits in Up next, and starts at the marker", async ({ page }) => {
    expectFailureUntilBuilt("live", "prep");
    const d = await sceneSteps(page, "Greyhollow inn");
    await d.getByRole("button", { name: "Add a step" }).click();
    await page.getByRole("menuitem", { name: "Play…" }).click();
    const step = d.getByRole("list", { name: "Steps" }).getByRole("listitem").nth(3);
    await step.getByRole("combobox", { name: "What" }).selectOption({ label: "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)" });
    await step.getByRole("combobox", { name: "Up next" }).selectOption({ label: "Play next" });
    await step.getByRole("combobox", { name: "From" }).selectOption({ label: "Low swell (3:10)" });
    await d.getByRole("button", { name: "Done" }).click();
    await goLive(page);
    await page.getByRole("button", { name: "Start scene 2: Greyhollow inn" }).click();
    const table = room(page, "Table");
    await expect(table.getByRole("list", { name: "Up next" }).getByRole("listitem").first()).toContainText("Eerie dread");
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(table).toContainText(/3:1\d \/ 5:18/);
  });

  test("a pad's own steps run when it is pressed in Live", async ({ page }) => {
    expectFailureUntilBuilt("live", "prep");
    await openRoute(page, "board/weather");
    await page.getByRole("region", { name: "Pad: Thunder crack" }).getByRole("button", { name: "More for this pad" }).click();
    await page.getByRole("menuitem", { name: "What it does…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add a step" }).click();
    await page.getByRole("menuitem", { name: "Fade the music…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await goLive(page);
    await startFirstScene(page);
    await sceneMusic(page).getByRole("button", { name: /^Thunder crack/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Music down to 30% over 2 s" })).toBeVisible();
  });

  test("a board's dividers show above their row of pads in Live", async ({ page }) => {
    expectFailureUntilBuilt("live", "prep");
    await openRoute(page, "board/abbey");
    await page.getByRole("button", { name: "More for this board" }).click();
    await page.getByRole("menuitem", { name: "Add a divider…" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Spirits");
    await page.getByRole("dialog").getByRole("combobox", { name: "Above row" }).selectOption("2");
    await page.getByRole("dialog").getByRole("button", { name: "Add divider" }).click();
    await goLive(page);
    await startAbbey(page);
    await expect(sceneMusic(page).getByRole("group", { name: "Pads on Drowned Abbey" }).getByRole("heading", { name: "Spirits" })).toBeVisible();
  });

  test("Live's keys follow Settings › Keyboard shortcuts", async ({ page }) => {
    expectFailureUntilBuilt("live", "rooms-settings");
    await openRoute(page, "settings");
    const keys = region(page, "Keyboard shortcuts");
    await keys.getByRole("button", { name: "Keyboard shortcuts", exact: true }).click();
    await keys.getByRole("button", { name: "Change the key for Next scene" }).click();
    await page.keyboard.press("n");
    await expect(keys.getByRole("row", { name: /^Next scene/ })).toContainText("N");
    await goLive(page);
    await clickAway(page);
    await page.keyboard.press(" ");
    await expect(page.getByRole("button", { name: "Start: Recap and the coast road" })).toBeVisible();
    await page.keyboard.press("n");
    await expect(page.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeVisible();
  });

  test("a second Next scene within a second is ignored, so a double press never skips a scene", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "live");
    await startFirstScene(page);
    await clickAway(page);
    await page.waitForTimeout(1100);
    await page.keyboard.press(" ");
    await page.keyboard.press(" ");
    await expect(page.getByRole("button", { name: "Restart scene 2: Greyhollow inn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toHaveCount(0);
  });

  test("Ctrl+K opens Find and play in Live too", async ({ page }) => {
    expectFailureUntilBuilt("shell");
    await openRoute(page, "live");
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Find and play" })).toBeVisible();
  });

  test("each room's progress line shows the track's markers", async ({ page }) => {
    expectFailureUntilBuilt("live", "prep");
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(room(page, "Table").getByTitle("Choir enters 1:04")).toHaveCount(1);
  });

  test("with Comfortable and 200 % text, Live still fits: nothing scrolls sideways and On air is in view", async ({ page }) => {
    expectFailureUntilBuilt("shell", "live");
    await openRoute(page, "look");
    const display = region(page, "Display");
    await display.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: "Comfortable" }).check();
    const size = display.getByRole("slider", { name: "Text size" });
    await size.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await openRoute(page, "live");
    await startAbbey(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(region(page, "On air")).toBeInViewport();
  });
});

/* 0.5.1 (design/prototype/ROUND8.md, part 2): Nik's findings from testing 0.5.0, 11 Nov.
   "In live I also need to be able to click in the tracking bar for the currently playing tracking and skip to a certain
   point in the track"; "I need a stop button in the on air view in live on the currently playing track, not just a
   pause button - I need both"; "I also need a shuffle button in the on air live view". */
test.describe("0.5.1: On air has Stop, Shuffle and a position bar to jump in", () => {
  test.beforeEach(() => expectFailureUntilBuilt("feat"));
  const music = (page: Page, name = "Table") => room(page, name).getByRole("group", { name: `Music in ${name}`, exact: true });
  const names = async (group: ReturnType<typeof music>) => group.getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") || (b.textContent ?? "").trim()));

  test("the playing track has Stop beside Pause, both kept; Stop ends that room's music and the ambience goes on", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const order = await names(music(page));
    expect(order).toContain("Pause music");
    expect(order.indexOf("Stop music")).toBe(order.indexOf("Pause music") + 1);
    await expect(room(page, "Table").getByRole("group", { name: "Ambience in Table", exact: true }).getByRole("button", { name: "Stop ambience" })).toBeVisible();
    await music(page).getByRole("button", { name: "Stop music" }).click();
    await expect(music(page)).toHaveCount(0);
    await expect(room(page, "Table").getByRole("group", { name: "Ambience in Table", exact: true })).toBeVisible();
  });

  test("each room has Shuffle beside Repeat; it shuffles the playlist the music comes from, and is greyed for music from no playlist", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    // The abbey ruins starts with a track of its own, not a playlist: nothing to shuffle.
    await expect(music(page).getByRole("button", { name: "Shuffle" })).toBeDisabled();
    await unfold(sessionPlaylists(page));
    await sessionPlaylists(page).getByRole("button", { name: "Play on air: Wistful with some warmth" }).click();
    await expect(music(page).locator("xpath=..")).toContainText("Wistful with some warmth");
    const order = await names(music(page));
    const shuffle = order.indexOf("Shuffle");
    expect(order[shuffle + 1]).toMatch(/^Repeat/);
    const button = music(page).getByRole("button", { name: "Shuffle" });
    await expect(button).toBeEnabled();
    const was = await button.getAttribute("aria-pressed");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true");
  });

  test("with two rooms, each room's music has its own Stop and Shuffle", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await startAbbey(page);
    await toSideRoom(page, sessionPlaylists(page));
    await sessionPlaylists(page).getByRole("button", { name: /^Play on air in Side room: Wistful/ }).click();
    for (const name of ["Table", "Side room"]) {
      await expect(music(page, name).getByRole("button", { name: "Stop music" })).toBeVisible();
      await expect(music(page, name).getByRole("button", { name: "Shuffle" })).toBeVisible();
    }
  });

  test("the playing track's position bar is a slider: click or drag to jump, Left and Right move 5 seconds, Home and End", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await music(page).getByRole("button", { name: "Pause music" }).click();
    const bar = room(page, "Table").getByRole("slider", { name: /^Position in Eerie dread/ });
    await expect(bar).toHaveAttribute("aria-valuetext", /^\d+:\d\d of 3:10$/);
    expect((await bar.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    const now = async () => Number(await bar.getAttribute("aria-valuenow"));
    await bar.focus();
    await page.keyboard.press("Home");
    const start = await now();
    expect(start).toBeLessThan(5);
    await page.keyboard.press("ArrowRight");
    expect(await now()).toBe(start + 5);
    await page.keyboard.press("ArrowLeft");
    expect(await now()).toBe(start);
    await page.keyboard.press("End");
    await expect(bar).toHaveAttribute("aria-valuetext", "3:09 of 3:10");
    const box = (await bar.boundingBox())!;
    await bar.click({ position: { x: box.width / 2, y: box.height / 2 } });
    expect(Math.abs((await now()) - 95)).toBeLessThanOrEqual(6);
    // Dragging moves it as it goes.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(Math.abs((await now()) - 48)).toBeLessThanOrEqual(6);
  });

  test("the ambience's position bar is a slider too, named after its track", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(room(page, "Table").getByRole("slider", { name: /^Position in Rain on stone/ })).toHaveAttribute("aria-valuetext", /^\d+:\d\d of 4:00$/);
  });
});

/* 0.5.1 (ROUND8.md, part 3): more from Nik's test of 0.5.0, 11 Nov 20:33.
   "Let's make the standard for our fade buttons 5 rather than 3 seconds." "I can't choose what channel my bots join
   from the live view - I need to be able to do that, and to add a second bot to the live view, and a channel on the
   table from that view, or more, I don't want to have to tab to the rooms tab." "I don't see an undo button for
   kicking a bot in the live view". */
test.describe("0.5.1: fades of 5 seconds, and Rooms' actions in On air", () => {
  test.beforeEach(() => expectFailureUntilBuilt("feat"));

  test("Fade all and a lane's Fade out take 5 seconds, and say so", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(page.getByRole("button", { name: "Fade all" })).toHaveAttribute("title", /over 5 seconds/);
    await expect(room(page, "Table").getByRole("button", { name: "Fade music out" })).toHaveAttribute("title", /over 5 seconds/);
    await page.getByRole("button", { name: "Keys" }).click();
    await expect(page.getByText("Fade all (5 s)")).toBeVisible();
  });

  test("a room's bot chip chooses its channel in place: the room moves there, without the Rooms screen", async ({ page }) => {
    metByTheAppAlready("0.5.0's bot button in On air already moves the room to the chosen channel in place");
    await openRoute(page, "live");
    await room(page, "Table").getByRole("button", { name: /^Lyre Table in Table: change/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Lyre Table plays in");
    await menu.getByRole("menuitemradio", { name: /^Side room/ }).click();
    await expect(room(page, "Side room")).toBeVisible();
    await expect(room(page, "Table")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeAttached();
  });

  test("Kick is beside the bot's button and in its menu; Undo shows after every Kick, even with nothing playing, and puts the bot back", async ({ page }) => {
    await openRoute(page, "live");
    const onAir = region(page, "On air");
    await room(page, "Table").getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    const undo = onAir.getByRole("group", { name: "Undo" });
    await expect(undo).toContainText("Lyre Table left Table");
    await expect(undo.getByRole("button", { name: "Undo" })).toBeFocused();
    await undo.getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table")).toBeVisible();
    await room(page, "Table").getByRole("button", { name: /^Lyre Table in Table: change/ }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Kick Lyre Table from Table" }).click();
    await expect(onAir.getByRole("group", { name: "Undo" })).toContainText("Lyre Table left Table");
  });

  test("Kick with music playing, then Undo: the music comes back where it was", async ({ page }) => {
    metByTheAppAlready("0.5.0's Kick with Undo already brings the music back when the players were hearing it");
    await openRoute(page, "live");
    await startAbbey(page);
    await room(page, "Table").getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    await region(page, "On air").getByRole("group", { name: "Undo" }).getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table").getByRole("group", { name: "Music in Table", exact: true }).locator("xpath=..")).toContainText("Eerie dread");
  });

  test("Add a room is always in On air; it brings in a free bot, or offers Add a bot… in place", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Add a room" }).click();
    await page.getByRole("menuitemradio", { name: /Side room/ }).click();
    await expect(room(page, "Side room")).toBeVisible();
    // Every bot is in a room now: Add a room stays, and offers a new bot.
    await page.getByRole("button", { name: "Add a room" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Add a bot…" }).click();
    await expect(page.getByRole("dialog")).toContainText("Add a bot");
  });
});

/* 0.5.1: from Nik's test of 0.5.0 (11 Nov), built in the app with no prototype round (support/test.ts appOnly). */
test.describe("0.5.1: Nik's changes from his test of 0.5.0", () => {
  test("On air: the playing track's bar is a seek bar: a click jumps there, the arrow keys 5 s (\"click in the tracking bar … and skip\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "live");
    await startAbbey(page);
    const seek = room(page, "Table").getByRole("slider", { name: /^Position in / }).first();
    await expect(seek).toHaveAttribute("aria-valuetext", /^\d+:\d\d of \d+:\d\d$/);
    const box = (await seek.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(24);
    const max = Number(await seek.getAttribute("aria-valuemax"));
    expect(max).toBeGreaterThan(20);
    await seek.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeGreaterThan(max / 2 - 10);
    const now = Number(await seek.getAttribute("aria-valuenow"));
    await seek.press("Home");
    await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeLessThan(Math.min(now, 5));
    await seek.press("ArrowRight");
    await seek.press("ArrowRight");
    await expect.poll(async () => Number(await seek.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(10);
  });

  test("rooms from Live: a bot's menu chooses its channel, adds a room and kicks; Add a room offers Add a bot… (\"I don't want to have to tab to the rooms tab\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "live");
    await page.getByRole("button", { name: "Lyre Table in Table: change" }).click();
    const menu = page.getByRole("menu", { name: "Room Table" });
    await expect(menu).toContainText("Lyre Table plays in");
    await expect(menu).toContainText("Add a room: Lyre Side joins…");
    await expect(menu.getByRole("menuitem", { name: "Kick Lyre Table from Table" })).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Side room.*Lyre Side joins$/ }).click();
    await expect(room(page, "Side room")).toBeVisible();
    await page.getByRole("button", { name: "Add a room" }).click();
    const add = page.getByRole("menu", { name: "Add a room" });
    await expect(add).toContainText("Every bot is in a room");
    await add.getByRole("menuitem", { name: "Add a bot…" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  });

  test("On air: Stop beside Pause on the playing track, and Shuffle next to Repeat (\"I need both\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "live");
    await startAbbey(page);
    const table = room(page, "Table");
    const pause = table.getByRole("button", { name: "Pause music" });
    const stop = table.getByRole("button", { name: "Stop music" });
    await expect(pause).toBeVisible();
    await expect(stop).toBeVisible();
    for (const b of [stop, table.getByRole("button", { name: "Shuffle" })]) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    const shuffle = table.getByRole("button", { name: "Shuffle" });
    await expect(shuffle).toHaveAttribute("aria-pressed", "false");
    await shuffle.click();
    await expect(shuffle).toHaveAttribute("aria-pressed", "true");
    await stop.click();
    await expect(table.getByRole("button", { name: "Pause music" })).toHaveCount(0);
  });
});
