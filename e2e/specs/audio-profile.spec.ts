/**
 * Audio profile: where a track starts and ends, what happens at the end, and its fades, per place
 * (design/prototype/tools/ap-check.js and src/views/profile.js). Opened on "Eerie dread, low cello and choir"
 * (t13), which loops from 1:04 to 5:18 and has its own settings in the scene "The abbey ruins".
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";

const wave = (page: Page) => page.getByRole("region", { name: "Waveform and listening", exact: true });
const handle = (page: Page, name: string) => wave(page).getByRole("slider", { name, exact: true });
const atEnd = (page: Page) => page.getByRole("region", { name: "At the end", exact: true });
const fades = (page: Page) => page.getByRole("region", { name: "Fades", exact: true });
const num = async (l: ReturnType<Page["getByRole"]>) => Number(await l.getAttribute("aria-valuenow"));

test.describe("the handles", () => {
  test("Start, End, Loop start, the two fade lengths and the playhead are sliders you can reach", async ({ page }) => {
    await openRoute(page, "profile/t13");
    for (const name of ["Playhead", "Start", "End", "Loop start", "Fade in length", "Fade out length"]) {
      await expect(handle(page, name)).toBeVisible();
    }
  });

  test("dragging the End handle left moves End earlier, and the End box follows", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const end = handle(page, "End");
    const before = await num(end);
    const box = (await end.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(10, box.height / 2));
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y + Math.min(10, box.height / 2), { steps: 8 });
    await page.mouse.up();
    const after = await num(end);
    expect(after).toBeLessThan(before - 20);
    const typed = await atEnd(page).getByRole("textbox", { name: "End" }).inputValue();
    expect(typed).toMatch(/^\d+:\d\d/);
    expect(typed).not.toBe("5:18");
  });

  test("on the End handle, the arrow keys move 1 s and Shift+Right 10 s, and the new time is announced", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const end = handle(page, "End");
    await end.focus();
    const start = await num(end);
    await page.keyboard.press("ArrowLeft");
    expect(await num(end)).toBe(start - 1);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await num(end)).toBe(start - 11);
    await expect(end).toHaveAttribute("aria-valuetext", /\d:\d\d/);
  });

  test("the fade out handle changes the fade by a second per arrow key", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const knob = handle(page, "Fade out length");
    await knob.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect(fades(page).getByRole("textbox", { name: "fade out length in seconds" })).toHaveValue("4");
  });
});

test.describe("what happens at the end", () => {
  test("offers Loop back, Move to the next track and Stop, with a plain explanation of each", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const choice = atEnd(page).getByRole("group", { name: "At the end" });
    await expect(choice.getByRole("radio", { name: /^Loop back to loop start/ })).toBeChecked();
    await expect(choice.getByRole("radio", { name: /^Move to the next track The scene or playlist moves on; played on its own, it stops/ })).toBeVisible();
    await expect(choice.getByRole("radio", { name: /^Stop Then silence/ })).toBeVisible();
    await expect(atEnd(page)).toContainText("Loops from 1:04");
  });

  test("choosing Move to the next track changes the summary and no longer needs a loop start", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await atEnd(page).getByRole("radio", { name: /^Move to the next track/ }).check();
    await expect(atEnd(page).getByRole("radio", { name: /^Move to the next track/ })).toBeChecked();
    await expect(atEnd(page)).not.toContainText("Loops from 1:04");
    await expect(handle(page, "Loop start")).toHaveCount(0);
  });

  test("Start, End and Loop start can be typed as times", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const end = atEnd(page).getByRole("textbox", { name: "End" });
    await end.fill("4:30");
    await end.press("Enter");
    await expect(end).toHaveValue("4:30");
    expect(await num(handle(page, "End"))).toBe(270);
    await atEnd(page).getByRole("textbox", { name: "Start", exact: true }).fill("0:08");
    await atEnd(page).getByRole("textbox", { name: "Start", exact: true }).press("Enter");
    expect(await num(handle(page, "Start"))).toBe(8);
  });

  test("End at playhead takes the time from where the preview is", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await handle(page, "Playhead").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await atEnd(page).getByRole("button", { name: "Start at playhead" }).click();
    expect(await num(handle(page, "Start"))).toBe(2);
  });

  test("Reset to whole track takes Start and End back to the ends of the file", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await page.getByRole("button", { name: "Reset to whole track" }).click();
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toHaveValue("7:21");
    await expect(atEnd(page).getByRole("textbox", { name: "Start", exact: true })).toHaveValue("0:00");
  });
});

test.describe("fades", () => {
  test("fade in and fade out each have a length in seconds with shorter and longer buttons, and an intensity from gentle to sharp", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const f = fades(page);
    await expect(f).toContainText("No fades");
    await f.getByRole("button", { name: "Longer fade in" }).click();
    await f.getByRole("button", { name: "Longer fade in" }).click();
    await expect(f.getByRole("textbox", { name: "fade in length in seconds" })).toHaveValue("2");
    await f.getByRole("button", { name: "Shorter fade in" }).click();
    await expect(f.getByRole("textbox", { name: "fade in length in seconds" })).toHaveValue("1");
    await expect(f.getByRole("slider", { name: "Intensity" })).toHaveCount(2);
    await expect(f).not.toContainText("No fades");
  });

  test("a looping track also has a loop crossfade that smooths the jump back", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await expect(fades(page)).toContainText(/Crossfade the loop\s*smooths the jump back to 1:04/);
    await expect(fades(page).getByRole("textbox", { name: "loop crossfade length in seconds" })).toHaveValue("2");
  });
});

test.describe("listening while you set it", () => {
  test("Space plays the preview from the playhead (only you hear it) and Space stops it", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const preview = wave(page).getByRole("group", { name: "Preview: only you hear it" });
    await page.getByRole("heading", { name: /Eerie dread/, level: 1 }).click();
    await page.keyboard.press("Space");
    await expect(preview.getByRole("button", { name: /^Pause|^Play$/ }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(wave(page)).toContainText(/Previewing/);
    await page.keyboard.press("Space");
    await expect(preview.getByRole("button", { name: "Stop the preview" })).toBeVisible();
  });

  test("the last 10 seconds before End can be played, and a loop is counted when the preview crosses End", async ({ page }) => {
    test.setTimeout(40_000);
    await openRoute(page, "profile/t13");
    await wave(page).getByRole("button", { name: "Play the last 10 s before End" }).click();
    await expect(wave(page)).toContainText(/Looped\s*once/, { timeout: 20_000 });
  });

  test("the position, the time to End and the volume after fades are shown while it plays", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await expect(wave(page)).toContainText(/Position\s*0:00\.0/);
    await expect(wave(page)).toContainText(/Time to End\s*5:18\.0/);
    await expect(wave(page).getByRole("meter", { name: "Volume after fades" })).toBeVisible();
  });

  test("Play on air sends the track to the players with these settings", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await wave(page).getByRole("button", { name: "Play on air" }).click();
    await expect(page.getByRole("region", { name: "On air", exact: true })).toBeVisible();
  });
});

test.describe("markers and keys", () => {
  test("M adds a marker at the playhead, which can be named, jumped to and removed", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await handle(page, "Playhead").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("m");
    const markers = page.getByRole("region", { name: "Markers", exact: true });
    await expect(markers).toContainText("4 markers");
    await markers.getByRole("textbox", { name: "Marker label at 0:02" }).fill("First bell");
    await markers.getByRole("button", { name: "Go to First bell" }).click();
    await markers.getByRole("button", { name: "Remove marker First bell" }).click();
    await expect(markers).toContainText("3 markers");
  });

  test("with single-key shortcuts off, O does nothing", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await wave(page).getByRole("switch", { name: "Single-key shortcuts" }).click();
    await handle(page, "Playhead").focus();
    await page.keyboard.press("ArrowRight");
    const endBefore = await num(handle(page, "End"));
    await page.keyboard.press("o");
    expect(await num(handle(page, "End"))).toBe(endBefore);
  });
});

test.describe("different settings for different places", () => {
  test("a scene that has its own settings for the track shows them: End 3:10", async ({ page }) => {
    await openRoute(page, "profile/t13/sc:crown:s14:sc3");
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toHaveValue("3:10");
    await expect(page.getByRole("button", { name: "Back to the track's settings" })).toBeVisible();
  });

  test("a place that uses the track's settings shows them read-only until it is given its own", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await page.getByRole("combobox", { name: "Settings for" }).selectOption({ label: "Playlist: Gothic dread · uses the track's" });
    await expect(page.getByRole("combobox", { name: "Settings for" })).toBeFocused();
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Uses the track's settings (read-only until you give it its own)");
  });

  test("giving a place its own settings copies and unlocks them, and a change there leaves the track's own alone", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const place = page.getByRole("combobox", { name: "Settings for" });
    await place.selectOption({ label: "Playlist: Gothic dread · uses the track's" });
    await page.getByRole("button", { name: "Give this place its own settings" }).click();
    const end = atEnd(page).getByRole("textbox", { name: "End" });
    await expect(end).toBeEnabled();
    await end.fill("4:30");
    await end.press("Enter");
    await expect(end).toHaveValue("4:30");
    await place.selectOption({ label: "This track everywhere (its own)" });
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toHaveValue("5:18");
  });

  test("Back to the track's settings removes the place's own settings, with an Undo", async ({ page }) => {
    await openRoute(page, "profile/t13/sc:crown:s14:sc3");
    await page.getByRole("button", { name: "Back to the track's settings" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toBeDisabled();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(atEnd(page).getByRole("textbox", { name: "End" })).toHaveValue("3:10");
  });

  test("every place that uses the track is listed in the Settings for choice", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const labels = await page.getByRole("combobox", { name: "Settings for" }).evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.label));
    expect(labels).toEqual(
      expect.arrayContaining([
        "This track everywhere (its own)",
        "Playlist: Abbey: eerie, low energy · uses the track's",
        "Scene: The abbey ruins (The Sunken Crown, session 14) · own settings",
      ]),
    );
  });
});
