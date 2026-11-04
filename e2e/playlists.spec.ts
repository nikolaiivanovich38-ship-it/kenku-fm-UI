/**
 * Playlists in the player view, as in Kenku FM: create, rename, add tracks
 * from disk, play, pause, skip, shuffle, repeat, volume, delete.
 * Audio is generated sine tones; no sound card is needed (Chromium plays to a
 * silent fake output when there is none).
 */
import fs from "fs";
import path from "path";
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";
import {
  addTrack,
  card,
  createPlaylist,
  openCard,
  playbackPosition,
  trackRow,
  transport,
} from "./fixtures/player";

test("create, rename and delete a playlist", async ({ playerView: page }) => {
  await createPlaylist(page, "Tavern");

  await openCard(page, "Tavern");
  await page.getByRole("button", { name: "Playlist options" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Playlist" });
  await edit.getByLabel("Name").fill("Dragon's Rest Tavern");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Dragon's Rest Tavern", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Playlist options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  // Deleting goes back to the home page, where the playlist is gone.
  await expect(page.getByText("Playlists", { exact: true })).toBeVisible();
  await expect(card(page, "Dragon's Rest Tavern")).toHaveCount(0);
});

test("add tracks from disk, play, pause, skip and delete them", async ({ playerView: page, userDataDir }) => {
  const first = writeSineWav(`${userDataDir}/audio`, "first-tone.wav", { seconds: 8, frequency: 440 });
  const second = writeSineWav(`${userDataDir}/audio`, "second-tone.wav", { seconds: 8, frequency: 660 });

  await createPlaylist(page, "Battle");
  await openCard(page, "Battle");
  await addTrack(page, first, "First Tone");
  await addTrack(page, second, "Second Tone");

  // New tracks are added at the top of the list.
  await expect(page.getByRole("listitem")).toHaveText([/Second Tone/, /First Tone/]);

  const controls = transport(page);
  // Nothing has played yet, so the transport is disabled.
  await expect(controls.getByRole("button", { name: "play", exact: true })).toBeDisabled();

  // Play the first track: its button turns into "pause" and time moves on.
  await trackRow(page, "First Tone").getByRole("button", { name: "play", exact: true }).click();
  await expect(trackRow(page, "First Tone").getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect(controls.getByRole("button", { name: "pause", exact: true })).toBeEnabled();
  await expect.poll(() => playbackPosition(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // Pause: the position stops moving.
  await controls.getByRole("button", { name: "pause", exact: true }).click();
  await expect(controls.getByRole("button", { name: "play", exact: true })).toBeVisible();
  const pausedAt = await playbackPosition(page);
  await page.waitForTimeout(2_000);
  expect(await playbackPosition(page)).toBe(pausedAt);

  // Resume.
  await controls.getByRole("button", { name: "play", exact: true }).click();
  await expect(controls.getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect.poll(() => playbackPosition(page), { timeout: 10_000 }).toBeGreaterThan(pausedAt);

  // The queue follows the list order: Second Tone, First Tone. Repeat starts
  // as "playlist", so "next" from the last track wraps round to the first.
  await controls.getByRole("button", { name: "next", exact: true }).click();
  await expect(trackRow(page, "Second Tone").getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect(trackRow(page, "First Tone").getByRole("button", { name: "play", exact: true })).toBeVisible();
  // "previous" less than 5 s into the first track wraps round to the last.
  await controls.getByRole("button", { name: "previous", exact: true }).click();
  await expect(trackRow(page, "First Tone").getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect(trackRow(page, "Second Tone").getByRole("button", { name: "play", exact: true })).toBeVisible();

  // Delete the playing track: playback stops, the row goes and the player
  // bar no longer shows the track or its time (BUG-8).
  await trackRow(page, "First Tone").getByRole("button", { name: "Options for First Tone" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(trackRow(page, "First Tone")).toHaveCount(0);
  await expect(controls.getByRole("button", { name: "play", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText([/Second Tone/]);
  await expect(page.getByText("First Tone", { exact: true })).toHaveCount(0);
  await expect(controls.getByRole("button", { name: "play", exact: true })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Position in track" })).toBeDisabled();
  expect(await page.evaluate(() => navigator.mediaSession.metadata)).toBeNull();

  // The queue keeps the deleted track's place, so Next carries on from there
  // (BUG-8): after the last track, repeat "playlist" wraps round to Second Tone.
  await expect(controls.getByRole("button", { name: "next", exact: true })).toBeEnabled();
  await controls.getByRole("button", { name: "next", exact: true }).click();
  await expect(trackRow(page, "Second Tone").getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect(controls.getByRole("button", { name: "pause", exact: true })).toBeEnabled();
  await expect.poll(() => playbackPosition(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await controls.getByRole("button", { name: "pause", exact: true }).click();

  // Edit the remaining track's name.
  await trackRow(page, "Second Tone").getByRole("button", { name: "Options for Second Tone" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Track" });
  await expect(edit.getByLabel("Source")).toHaveValue(/second-tone\.wav$/);
  await edit.getByLabel("Name").fill("Battle Drums");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(trackRow(page, "Battle Drums")).toBeVisible();
});

test("repeat, shuffle, mute and volume controls", async ({ playerView: page, userDataDir }) => {
  const tone = writeSineWav(`${userDataDir}/audio`, "tone.wav", { seconds: 2 });
  await createPlaylist(page, "Ambience");
  await openCard(page, "Ambience");
  await addTrack(page, tone, "Short Tone");

  const controls = transport(page);

  // Repeat starts as "playlist" and cycles playlist -> track -> off -> playlist.
  await controls.getByRole("button", { name: "repeat playlist" }).click();
  await expect(controls.getByRole("button", { name: "repeat track" })).toBeVisible();

  // With repeat track, a 2-second track keeps playing past its end.
  await trackRow(page, "Short Tone").getByRole("button", { name: "play", exact: true }).click();
  await expect(controls.getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await page.waitForTimeout(4_000);
  await expect(controls.getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await controls.getByRole("button", { name: "repeat track" }).click();
  await expect(controls.getByRole("button", { name: "repeat off" })).toBeVisible();
  // With repeat off the track stops at its end.
  await expect(controls.getByRole("button", { name: "play", exact: true })).toBeVisible({ timeout: 10_000 });
  await controls.getByRole("button", { name: "repeat off" }).click();
  await expect(controls.getByRole("button", { name: "repeat playlist" })).toBeVisible();

  // Shuffle has no on/off name yet; its icon turns the highlight colour.
  const shuffle = controls.getByRole("button", { name: "shuffle" });
  await shuffle.click();
  await expect(shuffle.locator("svg")).toHaveClass(/MuiSvgIcon-colorPrimary/);
  await shuffle.click();
  await expect(shuffle.locator("svg")).not.toHaveClass(/MuiSvgIcon-colorPrimary/);

  // Volume: keyboard on the slider, then mute and unmute.
  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.focus();
  await page.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(volume).toHaveAttribute("aria-valuenow", "1");
  // 5% per arrow key press.
  const volumeValue = async () => Number(await volume.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await expect.poll(volumeValue).toBeCloseTo(0.95, 5);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(volumeValue).toBeCloseTo(0.9, 5);

  // One name, and a pressed state that says whether it is muted.
  const mute = page.getByRole("button", { name: "Mute", exact: true });
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await expect.poll(volumeValue).toBeCloseTo(0.9, 5);
});

test("a playlist card's play button starts the playlist from the home page", async ({ playerView: page, userDataDir }) => {
  const tone = writeSineWav(`${userDataDir}/audio`, "tone.wav", { seconds: 6 });
  await createPlaylist(page, "Forest");
  await openCard(page, "Forest");
  await addTrack(page, tone, "Birdsong");
  await page.getByRole("button", { name: "Back" }).click();

  await card(page, "Forest").getByRole("button", { name: "play/pause" }).click();
  await expect(transport(page).getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect.poll(() => playbackPosition(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await card(page, "Forest").getByRole("button", { name: "play/pause" }).click();
  await expect(transport(page).getByRole("button", { name: "play", exact: true })).toBeVisible();
});

test("a playlist can use a picture from disk as its background", async ({ playerView: page, userDataDir }) => {
  // A 2x2 PNG.
  const picture = path.join(userDataDir, "tavern.png");
  fs.writeFileSync(
    picture,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR42mP4z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  await page.getByRole("button", { name: "Add Playlist" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Playlist" });
  await dialog.getByLabel("Name").fill("Candlelit");
  await dialog.getByRole("button", { name: "Custom" }).click();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /click to select an image/ }).click();
  await (await chooser).setFiles(picture);
  // The address field's aria-label sits on its wrapper, not on the input, so
  // it is found by its placeholder.
  await expect(dialog.getByPlaceholder("Enter a URL or select an image below")).toHaveValue(/^file:\/\/.*tavern\.png$/);
  const preview = dialog.getByRole("img", { name: "preview" });
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const background = card(page, "Candlelit").getByRole("img", { name: "Background" });
  await expect(background).toHaveAttribute("src", /tavern\.png$/);
  await expect.poll(() => background.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
});
