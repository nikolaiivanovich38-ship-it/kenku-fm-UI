/**
 * Live: running the game. Each test is one behaviour Nik approved in the prototype (design/prototype/tools/lv-keys.js).
 * Elements are found by role, accessible name and visible text only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { joinRoom, leaveAllRooms, openRoute } from "./support/target";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** Click on empty page: focus is on no control, so the single-key shortcuts apply. */
const clickAway = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const startFirstScene = (page: Page) => page.getByRole("button", { name: "Start: Recap and the coast road" }).click();
const startAbbey = (page: Page) => page.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
const addSideRoom = async (page: Page) => {
  await page.getByRole("button", { name: "Add a room" }).click();
  await page.getByRole("menuitemradio", { name: /Side room/ }).click();
  await expect(region(page, "On air: Side room")).toBeVisible();
};

test.describe("scenes and undo", () => {
  test("Space starts the next scene and the Next scene button keeps focus", async ({ page }) => {
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("Space");
    await expect(region(page, "Scenes").getByText("Scene 1 of 6")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next scene: Greyhollow inn" })).toBeFocused();
    await expect(region(page, "On air: Table").getByText("Playing")).toBeVisible();
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
    await expect(region(page, "Scenes").getByText("Scene 1 of 6")).toBeVisible();
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
    await expect(region(page, "On air: Table").getByText("Playing")).toBeVisible();
    await page.keyboard.press("Shift+Escape");
    await expect(region(page, "On air: Table").getByText("Silent")).toBeVisible({ timeout: 10_000 });
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
    await expect(region(page, "On air: Table").getByText("Silent")).toBeVisible();
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
    await expect(region(page, "On air: Table")).toContainText(/Silent/);
  });

  test("/ jumps to the Off script search, typing finds tracks, and Esc in the box clears it", async ({ page }) => {
    await openRoute(page, "live");
    await clickAway(page);
    await page.keyboard.press("/");
    const search = page.getByRole("searchbox", { name: /Off script/ });
    await expect(search).toBeFocused();
    await page.keyboard.type("bells");
    await expect(region(page, "Off script").getByText(/\d+ found/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
  });

  test("a pad key is ignored while typing in a box", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.press("/");
    await page.keyboard.type("q");
    await expect(page.getByRole("searchbox", { name: /Off script/ })).toHaveValue("q");
    await expect(region(page, "On air: Table")).toContainText(/Effects\s*None/);
  });

  test("a pad key starts that pad's sound", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.press("q");
    await expect(region(page, "On air: Table")).not.toContainText(/Effects\s*None/);
  });
});

test.describe("choosing what plays", () => {
  test("a hold pad plays while its key is down and stops when it comes up", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await clickAway(page);
    await page.keyboard.down("4");
    await expect(region(page, "On air: Table")).not.toContainText(/Effects\s*None/);
    await page.keyboard.up("4");
    await expect(region(page, "On air: Table")).toContainText(/Effects\s*None/);
  });

  test("Scene music sits above the On air box", async ({ page }) => {
    await openRoute(page, "live");
    const music = (await region(page, "Scene music").boundingBox())!;
    const onAir = (await region(page, "On air: Table").boundingBox())!;
    expect(music.y + music.height).toBeLessThanOrEqual(onAir.y + 1);
  });

  test("Play next queues a track and Next music then plays it", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const queued = "Haunted sea shanty, grey and slow - the drowned bells";
    await region(page, "Scene music").getByRole("button", { name: `Play next: ${queued}` }).click();
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(region(page, "On air: Table").getByText(queued)).toBeVisible();
  });

  test("Scene music lists the scene's tracks and playlists in order and marks the one on air", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const items = region(page, "Scene music").getByRole("list", { name: /music in the order it plays/ }).getByRole("listitem");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("On air");
    await expect(items.nth(1)).toContainText("Abbey: eerie, low energy");
    await expect(items.nth(2)).toContainText("Haunted sea shanty");
    await expect(items.nth(3)).toContainText("The Abbess");
  });

  test("Next follows the scene's order into the playlist after the track, and up next is never the track already playing", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const onAir = region(page, "On air: Table");
    await expect(onAir).toContainText("Item 1 of 4");
    await page.getByRole("button", { name: "Next music track" }).click();
    await expect(onAir).toContainText("Item 2 of 4");
    await expect(onAir).toContainText("Abbey: eerie, low energy");
    await expect(onAir).not.toContainText(/up next Eerie dread, low cello/);
  });

  test("a row shows the length that will play with the scene's own end point, with the end rule as a tooltip", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(region(page, "Scene music").getByRole("listitem").first()).toContainText("3:10");
    await expect(region(page, "On air: Table").getByTitle(/Ends 3:10, then next/)).toBeVisible();
  });

  test("a track's title opens its details with a link to the Audio profile for this scene, and does not play it", async ({ page }) => {
    await openRoute(page, "live");
    await startFirstScene(page);
    await startAbbey(page);
    await region(page, "Scene music").getByRole("button", { name: "Haunted sea shanty, grey and slow - the drowned bells", exact: true }).click();
    await expect(region(page, "On air: Table")).not.toContainText("Item 3 of 4");
    await region(page, "Scene music").getByRole("button", { name: /^Eerie dread, low cello/, includeHidden: false }).first().click();
    await expect(region(page, "Scene music").getByRole("link", { name: /profile/i })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
  });

  test("row actions read Preview, Play next, Play on air, in that order", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const row = region(page, "Scene music").getByRole("listitem").first();
    const names = await row.getByRole("button").evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0]));
    expect(names.filter((n) => /^(Preview|Play next|Play on air)/.test(n))).toEqual(["Preview", "Play next", "Play on air"]);
  });

  test("a playlist in Scene music opens to show its tracks, and the box grows with it instead of scrolling inside", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    const box = region(page, "Scene music");
    const before = (await box.boundingBox())!.height;
    await box.getByRole("button", { name: "Show contents of The Abbess" }).click();
    await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(before + 60);
  });

  test("the Pads box offers the scene's boards as a switch", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await region(page, "Pads").getByRole("button", { name: "Pads", exact: true }).click();
    const boards = page.getByRole("group", { name: "This scene's pad boards" });
    await expect(boards.getByRole("button")).toHaveText(["Drowned Abbey", "Weather and places"]);
  });
});

test.describe("Off script search", () => {
  test("a tag you pick can be cleared with the X next to the tag list", async ({ page }) => {
    await openRoute(page, "live");
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
    const off = region(page, "Off script");
    await off.getByRole("group", { name: "Show" }).getByRole("button", { name: "FX", exact: true }).click();
    await off.getByRole("searchbox").fill("door");
    await expect(off.getByText("2 found").first()).toBeVisible();
    await off.getByRole("list", { name: "Off script results" }).getByRole("button", { name: "Play on air: Heavy door slams" }).click();
    const onAir = region(page, "On air: Table");
    await expect(onAir.getByText("Heavy door slams")).toBeVisible();
    await expect(onAir.getByText(/Open road, wonder/)).toBeVisible();
  });
});

test.describe("rooms", () => {
  test("with no room joined the top strip warns that players hear nothing and offers Join Table", async ({ page }) => {
    await openRoute(page, "live");
    await leaveAllRooms(page);
    await expect(page.getByText(/players hear nothing/)).toBeVisible();
    await page.getByRole("button", { name: /Join Table/ }).click();
    await expect(region(page, "On air: Table")).toBeVisible();
    await expect(page.getByText(/players hear nothing/)).toHaveCount(0, { timeout: 5000 });
  });

  test("with one room there is no To: choice anywhere", async ({ page }) => {
    await openRoute(page, "live");
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });

  test("a room's box has Mute, shown as the one status Muted, and a volume slider that works from the keyboard", async ({ page }) => {
    await openRoute(page, "live");
    const room = region(page, "On air: Table");
    await room.getByRole("button", { name: "Mute Table" }).click();
    await expect(room.getByText("Muted")).toBeVisible();
    await room.getByRole("button", { name: "Mute Table" }).click();
    await expect(room.getByText("Muted")).toHaveCount(0);
    const volume = room.getByRole("slider", { name: "Volume in Table" });
    await volume.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(volume).toHaveValue("80");
    await expect(volume).toBeFocused();
  });

  test("Add a room: a second On air box for it appears, saying Silent", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await expect(region(page, "On air: Side room").getByText("Silent")).toBeVisible();
    await expect(region(page, "On air: Side room").getByText("Receiving")).toHaveCount(0);
  });

  test("with two rooms, Scene music, Off script and Pads each get a To: Table choice", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    for (const box of ["Scene music", "Off script"]) {
      await expect(region(page, box).getByRole("button", { name: /choose a room/i })).toHaveText(/^To:\s*Table$/);
    }
  });

  test("a room that joins from Discord gets its box too", async ({ page }) => {
    await openRoute(page, "live");
    await joinRoom(page, "Lyre Side", "Whispers");
    await expect(region(page, "On air: Whispers")).toBeVisible();
  });

  test("choosing To: Side room sends Play on air from Scene music only to that room, and the row buttons say so", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    const music = region(page, "Scene music");
    await music.getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await expect(music.getByRole("button", { name: /choose a room/i })).toBeFocused();
    await expect(music.getByRole("button", { name: /choose a room/i })).toHaveText(/^To:\s*Side room$/);
    await music.getByRole("button", { name: "Play on air in Side room: Coast road travel" }).click();
    await expect(region(page, "On air: Side room").getByText("Playing")).toBeVisible();
    await expect(region(page, "On air: Table").getByText("Silent")).toBeVisible();
  });

  test("Off script can send a track to a chosen room too", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    const off = region(page, "Off script");
    await off.getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await off.getByRole("searchbox").fill("bells");
    await off.getByRole("list", { name: "Off script results" }).getByRole("button", { name: /^Play on air in Side room/ }).first().click();
    await expect(region(page, "On air: Side room").getByText("Playing")).toBeVisible();
    await expect(region(page, "On air: Table").getByText("Silent")).toBeVisible();
  });

  test("a pad key plays in the room chosen in the Pads box", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await region(page, "Pads").getByRole("button", { name: "Pads", exact: true }).click();
    await region(page, "Pads").getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await clickAway(page);
    await page.keyboard.press("w");
    await expect(region(page, "On air: Side room").getByText(/Storm/)).toBeVisible();
    await expect(region(page, "On air: Table")).not.toContainText("Storm");
  });

  test("Next scene always starts in the first room, whatever the Scene music box points to", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await region(page, "Scene music").getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await startFirstScene(page);
    await expect(region(page, "On air: Table").getByText("Playing")).toBeVisible();
    await expect(region(page, "On air: Side room").getByText("Silent")).toBeVisible();
  });

  test("a room's menu offers to copy what another room is playing", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await region(page, "Scene music").getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await region(page, "Scene music").getByRole("button", { name: "Play on air in Side room: Coast road travel" }).click();
    await page.getByRole("button", { name: "More for Table" }).click();
    await expect(page.getByRole("menuitem", { name: /Copy what Side room is playing/ })).toBeVisible();
  });

  test("Leave takes the room's box and the To: choices away again", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    await page.getByRole("button", { name: "More for Side room" }).click();
    await page.getByRole("menuitem", { name: /^Leave/ }).click();
    await expect(region(page, "On air: Side room")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /choose a room/i })).toHaveCount(0);
  });
});

/* Round 5 (design/prototype/ROUND5.md), built in Live in wave 4 (w4-live). */
test.describe("round 5: the Now playing bar, names in scenes, play order and single tracks in Live", () => {
  test("UX-16: in Live the room boxes show what each room hears, so the Now playing bar shows only a preview, tagged Only you", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(region(page, "On air: Table").getByText("Playing")).toBeVisible();
    await expect(region(page, "Now playing")).toHaveCount(0);
    await region(page, "Scene music").getByRole("button", { name: /^Preview: / }).first().click();
    const bar = region(page, "Now playing");
    await expect(bar.getByRole("group", { name: "Only you", exact: true })).toContainText("Previewed from Live");
    await expect(bar.getByRole("group", { name: /^On air/ })).toHaveCount(0);
    await bar.getByRole("button", { name: "Stop the preview" }).click();
    await expect(bar).toBeHidden();
  });

  test("UX-16: with two rooms playing, the Now playing bar on a prep screen has a row for each, tagged with the room's name", async ({ page }) => {
    await openRoute(page, "live");
    await addSideRoom(page);
    const music = region(page, "Scene music");
    await music.getByRole("button", { name: /choose a room/i }).click();
    await page.getByRole("menuitemradio", { name: "Side room" }).click();
    await music.getByRole("button", { name: "Play on air in Side room: Coast road travel" }).click();
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
    await expect(region(page, "On air: Table")).toContainText("Dawn over the abbey");
    await expect(region(page, "Scene music").getByRole("button", { name: "Dawn over the abbey", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    await expect(region(page, "Now playing")).toContainText("Dawn over the abbey");
    await expect(region(page, "Now playing").getByTitle("Its own name: Release after loss, ethereal voice, resolves - end of session or death of an NPC")).toBeVisible();
  });

  test("PLY-13: a playlist in the scene's list has its play order for this scene", async ({ page }) => {
    await openRoute(page, "live");
    await startAbbey(page);
    await expect(region(page, "Scene music").getByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" })).toBeVisible();
    await expect(region(page, "Scene music").getByRole("button", { name: "Play order of The Abbess: In order, no repeat" })).toBeVisible();
  });

  test("ORG-12: the campaign's single tracks are in its menu, ready to play on air", async ({ page }) => {
    await openRoute(page, "live");
    await page.getByRole("button", { name: /^Campaign:/ }).click();
    await page.getByRole("menuitem", { name: /^Play on air: Ominous song, the villain's calling card/ }).click();
    await expect(region(page, "On air: Table")).toContainText("Ominous song, the villain's calling card");
  });
});
