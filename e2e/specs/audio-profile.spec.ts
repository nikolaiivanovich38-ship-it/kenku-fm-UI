/**
 * Audio profile: where a track starts and ends, what happens at the end, and its fades, per place
 * (design/prototype/tools/ap-check.js and src/views/profile.js). Opened on "Eerie dread, low cello and choir"
 * (t13), which loops from 1:04 to 5:18 and has its own settings in the scene "The abbey ruins".
 */
import type { Page } from "@playwright/test";
import { appOnly, expect, expectFailureUntilBuilt, test } from "./support/test";
import { openRoute, reopen } from "./support/target";

// Round 10 (prep review S1): the first box is "Audio profile" in the design; the app's name until built: Waveform and listening.
const wave = (page: Page) => page.getByRole("region", { name: /^(Waveform and listening|Audio profile)$/ });
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
    // 0.5.2 (item 2, Nik: "More granular positions"): in the app an arrow moves 0.1 s and Shift+arrow 1 s.
    const [arrow, shift] = test.info().project.name === "app" ? [0.1, 1] : [1, 10];
    await openRoute(page, "profile/t13");
    const end = handle(page, "End");
    await end.focus();
    const start = await num(end);
    await page.keyboard.press("ArrowLeft");
    expect(await num(end)).toBeCloseTo(start - arrow, 5);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await num(end)).toBeCloseTo(start - arrow - shift, 5);
    await expect(end).toHaveAttribute("aria-valuetext", /\d:\d\d/);
  });

  test("the fade out handle changes the fade by a second per arrow key", async ({ page }) => {
    // 0.5.2 (item 2): in the app a second is Shift+arrow; an arrow alone is a tenth.
    const key = test.info().project.name === "app" ? "Shift+ArrowRight" : "ArrowRight";
    await openRoute(page, "profile/t13");
    const knob = handle(page, "Fade out length");
    await knob.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press(key);
    await expect(fades(page).getByRole("textbox", { name: "fade out length in seconds" })).toHaveValue("4");
  });
});

test.describe("what happens at the end", () => {
  // Round 6 (design/prototype/ROUND6.md): Stop no longer says "Then silence"; the check takes either name.
  test("offers Loop back, Move to the next track and Stop, with a plain explanation where one is needed", async ({ page }) => {
    // Round 10 (prep review D5, look D8): the same six ends, in the same words, as At its end in the track's details.
    expectFailureUntilBuilt("r10-tracks");
    await openRoute(page, "profile/t13");
    const choice = atEnd(page).getByRole("group", { name: "At its end" });
    await expect(choice.getByRole("radio")).toHaveCount(6);
    await expect(choice.getByRole("radio", { name: /^Loop with a crossfade/ })).toBeChecked();
    await expect(choice.getByRole("radio", { name: /^Next track The scene or playlist moves on\. Played on its own, the track stops/ })).toBeVisible();
    for (const name of [/^Loop Back to the loop start/, /^Fade out/, /^Stop\b/, /^Play…/]) await expect(choice.getByRole("radio", { name })).toBeVisible();
    await expect(atEnd(page)).toContainText("Loops from 1:04");
  });

  test("choosing Move to the next track changes the summary and no longer needs a loop start", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await atEnd(page).getByRole("radio", { name: /^(Move to the next track|Next track)/ }).check();
    await expect(atEnd(page).getByRole("radio", { name: /^(Move to the next track|Next track)/ })).toBeChecked();
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
    // Round 6: what it does is read out with the group (and is its hover text) instead of a line on screen.
    expectFailureUntilBuilt("prep");
    await openRoute(page, "profile/t13");
    await expect(fades(page).getByRole("group", { name: "Crossfade the loop" })).toHaveAccessibleDescription("Smooths the jump back to 1:04");
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
    // Crowd whispers (f14) is a 20-second loop. In the app the seeded tracks play a six-minute stand-in tone
    // (seedAudio.ts), and since 0.5.2 (item 52) an End at the track's length in the library means the end of the file,
    // so the tone would play on past 0:20. End is moved in one step (a tenth of a second in the app, a second in the
    // prototype) to be a real End inside the track. Counted at least once: the count can pass "once" between two looks.
    await openRoute(page, "profile/f14");
    const end = handle(page, "End");
    const before = await num(end);
    await end.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => num(end)).toBeLessThan(before);
    await wave(page).getByRole("button", { name: "Play the last 10 s before End" }).click();
    await expect(wave(page)).toContainText(/Looped\s*(once|twice|\d+ times)/, { timeout: 20_000 });
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
    await expect(page.getByRole("region", { name: /^(On air|Now playing)$/ })).toBeVisible();
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
    await expect(markers.getByRole("textbox", { name: /^Marker label at / })).toHaveCount(4); // round 6: the open box does not repeat its count
    await markers.getByRole("textbox", { name: "Marker label at 0:02" }).fill("First bell");
    await markers.getByRole("button", { name: "Go to First bell" }).click();
    await markers.getByRole("button", { name: "Remove marker First bell" }).click();
    await expect(markers.getByRole("textbox", { name: /^Marker label at / })).toHaveCount(3); // round 6: the open box does not repeat its count
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
    // Round 6, part 5: the page also has the Saved pop-up's status, so the note is found by its words.
    await expect(page.getByRole("status").filter({ hasText: "Uses the track's settings" })).toContainText("Uses the track's settings (read-only until you give it its own)");
  });

  test("giving a place its own settings copies and unlocks them, and a change there leaves the track's own alone", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const place = page.getByRole("combobox", { name: "Settings for" });
    await place.selectOption({ label: "Playlist: Gothic dread · uses the track's" });
    await page.getByRole("button", { name: "Use separate settings here" }).click();
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

/* Round 5 (design/prototype/ROUND5.md): built in wave 4, so each check waits for "round 5" in the app. */
test.describe("round 5: settings for the scene or session it was opened from, the name there, and the shape", () => {
  test("PLY-14: opened from a scene, it stays on that scene's settings, offers the name in the scene, and Back returns there", async ({ page }) => {
    await openRoute(page, "profile/t07/sc:crown:s14:sc6");
    await expect(page.getByRole("combobox", { name: "Settings for" })).toHaveValue("sc:crown:s14:sc6");
    await expect(page.getByRole("group", { name: "Settings in the scene Aftermath" }).getByRole("button", { name: "Use separate settings here" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name in this scene" })).toHaveValue("Dawn over the abbey");
    await page.getByRole("button", { name: "Use separate settings here" }).click();
    await expect(page.getByText(/Editing own settings for the scene Aftermath/)).toBeVisible();
    await page.getByRole("button", { name: "Back to Aftermath" }).click();
    await expect(page.getByRole("button", { name: "Scene 6: Aftermath" })).toHaveAttribute("aria-expanded", "true");
  });

  test("PLY-14: a session list is a place with its own settings too", async ({ page }) => {
    await openRoute(page, "profile/t03/ss:crown:s14");
    const place = page.getByRole("combobox", { name: "Settings for" });
    await expect(place).toHaveValue("ss:crown:s14");
    await expect(place.getByRole("option", { name: /^Session list: Session 14: The Drowned Abbey/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Back to Session 14" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name in this scene" })).toHaveCount(0);
  });

  test("DAT-13: the header shows the track's shape", async ({ page }) => {
    await openRoute(page, "profile/t02");
    await expect(page.getByTitle("Shape: Peaks then falls (suggested from its loudness)")).toBeVisible();
  });
});

/* Round 5, volume normalisation (design/prototype/ROUND5.md "Volume normalisation (PLY-15, DAT-15)"): built in wave 4. */
test.describe("round 5: volume normalisation", () => {

  test("PLY-15: the header shows the loudness and the gain where these settings apply; a track's Off wins over its playlist's On", async ({ page }) => {
    await openRoute(page, "profile/t18/pl:p-ashen");
    let norm = page.getByRole("group", { name: "Normalise volume" });
    await expect(norm.getByRole("button", { name: "Library setting" })).toHaveAttribute("aria-pressed", "true");
    await expect(norm).toHaveAccessibleDescription("-15.8 LUFS · -2.2 dB");
    await expect(page.getByTitle("In the playlist Ashen King: the playlist's choice (On).")).toBeVisible();
    await openRoute(page, "profile/t26/pl:p-ashen");
    norm = page.getByRole("group", { name: "Normalise volume" });
    await expect(norm.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
    await expect(norm).toHaveAccessibleDescription("-22.7 LUFS · plays as it is");
    await expect(page.getByTitle("In the playlist Ashen King: this track's own choice.")).toBeVisible();
  });
});

/* Round 7 (design/prototype/ROUND7.md, DAT-3): the mix-out marker, where the next track crossfades in, and playing on
   air from a marker. Loop in and loop out are the Loop and End handles a loop bed already has. */
test.describe("round 7: mix out and playing from a marker", () => {
  test.beforeEach(() => expectFailureUntilBuilt("prep"));
  const markers = (page: Page) => page.getByRole("region", { name: "Markers", exact: true });

  test("one marker can be the mix-out point; choosing another moves it", async ({ page }) => {
    await openRoute(page, "profile/t13");
    const low = markers(page).getByRole("button", { name: "Mix out at Low swell" });
    await low.click();
    await expect(low).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: /^Saved: mix out at 3:10/ })).toBeVisible();
    await markers(page).getByRole("button", { name: "Mix out at Choir enters" }).click();
    await expect(low).toHaveAttribute("aria-pressed", "false");
    await expect(markers(page).getByRole("button", { name: "Mix out at Choir enters" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Play on air from a marker starts the track there", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await markers(page).getByRole("button", { name: "Play on air from Low swell" }).click();
    await expect(page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: "On air", exact: true })).toContainText(/3:1\d \//);
  });
});

/* 0.5.0 usability review (UX-R3): round 6's cuts on the Audio profile, as the prototype shows them. */
test.describe("round 6 cuts on the Audio profile", () => {
  test("UX-R3: no badge beside This track everywhere; the key legend shows only while the keyboard is in the waveform box", async ({ page }) => {
    await openRoute(page, "profile/t13");
    await expect(page.getByText("Editing the track's own settings")).toHaveCount(0);
    const legend = wave(page).getByText(/play, Start, End, loop, marker, playhead/);
    await expect(legend).toBeHidden();
    await handle(page, "Playhead").focus();
    await expect(legend).toBeVisible();
  });
});

/* 0.5.1: from Nik's test of 0.5.0 (11 Nov), built in the app with no prototype round (support/test.ts appOnly). */
test.describe("0.5.1: Nik's changes from his test of 0.5.0", () => {
  test("Start at a marker: the track then starts there when played on air from the Library (\"Start at [select marker]\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    const startAt = page.getByRole("region", { name: "At the end" }).getByRole("combobox", { name: "Start at" });
    await expect(startAt).toHaveValue("");
    await startAt.selectOption({ label: "Low swell (3:10)" });
    await expect(page.getByRole("status").filter({ hasText: /start at 3:10, Low swell/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Library" }).click();
    await page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select Eerie dread/ }).getByRole("button", { name: /^Play on air: / }).click();
    await expect(page.getByRole("region", { name: "Now playing" }).getByRole("group", { name: "On air", exact: true })).toContainText(/3:1\d \//);
  });

  test("Pick up where it stopped is in the Audio profile too, the track's own choice (\"I don't see pickup where it stops in details or audio profile views\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    const pickUp = page.getByRole("region", { name: "At the end" }).getByRole("switch", { name: "Pick up where it stopped" });
    await expect(pickUp).not.toBeChecked();
    await pickUp.check();
    await expect(page.getByRole("status").filter({ hasText: /picks up where it stopped/ })).toBeVisible();
    await reopen(page);
    await expect(page.getByRole("region", { name: "At the end" }).getByRole("switch", { name: "Pick up where it stopped" })).toBeChecked();
  });
});

/* 0.5.2: from Nik's play test (14 Nov), built in the app with no prototype round (support/test.ts appOnly). */
test.describe("0.5.2: Nik's play test", () => {
  test("item 2: Start and End move in tenths of a second, a time can be typed with tenths, and the strip zooms in (\"More granular positions on the audio profile tracking bar\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    const end = handle(page, "End");
    await end.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(end).toHaveAttribute("aria-valuetext", "5:17.9");
    const typed = atEnd(page).getByRole("textbox", { name: "End" });
    await typed.fill("5:12.4");
    await typed.press("Enter");
    await expect(end).toHaveAttribute("aria-valuenow", "312.4");
    const listen = wave(page);
    await listen.getByRole("button", { name: "Zoom in" }).click();
    await listen.getByRole("button", { name: "Zoom in" }).click();
    await expect(listen.getByText("4×")).toBeVisible();
    // The strip is four times as wide as its box, which now scrolls sideways; the End handle is still in reach.
    const sizes = await page.locator(".ap-wavescroll").evaluate((box) => ({ box: box.clientWidth, strip: box.scrollWidth }));
    expect(sizes.strip).toBeGreaterThan(sizes.box * 3.5);
    await end.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(end).toHaveAttribute("aria-valuenow", "313.4");
    await expect(end).toBeInViewport();
  });

  test("round 8 #3: Start at shows its whole choice, not \"Begi\"", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    const startAt = atEnd(page).getByRole("combobox", { name: "Start at" });
    const fits = await startAt.evaluate((select: HTMLSelectElement) => {
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(select).font}`;
      probe.textContent = select.selectedOptions[0]?.textContent ?? "";
      document.body.append(probe);
      const text = probe.getBoundingClientRect().width;
      probe.remove();
      // The box holds the text beside its arrow (about 24 px) and padding.
      return select.clientWidth - 24 >= text;
    });
    expect(fits).toBe(true);
  });

  test("round 8 #1: right after Add marker, the Saved pop-up leaves the new marker's row and its buttons in sight (WCAG 2.4.11)", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    const markers = page.getByRole("region", { name: "Markers", exact: true });
    await markers.scrollIntoViewIfNeeded();
    await markers.getByRole("button", { name: /Add marker/ }).click();
    const toast = page.locator("#lyre-toast");
    await expect(toast).toContainText("Saved");
    const row = page.locator(":focus").locator("xpath=ancestor::li[1]");
    const [a, b] = [(await row.boundingBox())!, (await toast.boundingBox())!];
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps).toBe(false);
  });

  test("item 24: Back from the Audio profile keeps the preview playing, and the Now playing bar stays (\"At the moment, it stops and the bar disappears\")", async ({ page }) => {
    appOnly();
    await openRoute(page, "library/t13");
    await page.evaluate(() => {
      window.location.hash = "#/profile/t13";
    });
    await wave(page).getByRole("button", { name: "Play", exact: true }).click();
    const bar = page.getByRole("region", { name: "Now playing" });
    await expect(bar.getByRole("group", { name: /^Only you/ })).toBeVisible();
    await page.getByRole("button", { name: /^Back to / }).click();
    await expect(page.getByRole("region", { name: "Details", exact: true })).toBeVisible();
    await expect(bar.getByRole("group", { name: /^Only you/ })).toBeVisible();
    await expect(bar.getByRole("group", { name: /^Only you/ })).toContainText(/Eerie dread/);
  });

  test("item 28: a setting changed while the track previews applies to the sound that plays, without starting it again", async ({ page }) => {
    appOnly();
    await openRoute(page, "profile/t13");
    await wave(page).getByRole("button", { name: "Play the last 10 s before End" }).click();
    const bar = page.getByRole("region", { name: "Now playing" });
    await expect(bar.getByRole("group", { name: /^Only you/ })).toContainText(/5:\d\d/);
    // End 20 s earlier: the preview, now past it, goes round to Loop start (1:04) at once.
    const end = handle(page, "End");
    await end.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press("PageDown");
    await expect(bar.getByRole("group", { name: /^Only you/ })).toContainText(/1:0\d \//, { timeout: 4000 });
  });
});
