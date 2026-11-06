/**
 * Soundboards in the player view, as in Kenku FM: create one, add sounds
 * from disk, play them once or on a loop with and without fades, stop them,
 * edit and delete.
 */
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";
import { addSound, card, createSoundboard, openCard } from "./fixtures/player";

test("add sounds, play them with and without loop and fades, stop, edit, delete", async ({
  playerView: page,
  userDataDir,
}) => {
  const door = writeSineWav(`${userDataDir}/audio`, "door-creak.wav", { seconds: 2, frequency: 300 });
  const rain = writeSineWav(`${userDataDir}/audio`, "rain.wav", { seconds: 2, frequency: 500 });

  await createSoundboard(page, "Dungeon");
  await openCard(page, "Dungeon");

  // No fades: streamed with an audio element on its first play, then, once Lyre knows it is short, decoded with
  // Web Audio (PERF-7). The one-shot below plays it both ways.
  await addSound(page, door, "Door Creak", { fadeIn: 0, fadeOut: 0 });
  // Fades: played with an audio element so loops can cross-fade.
  await addSound(page, rain, "Rain", { fadeIn: 300, fadeOut: 300 });

  const doorCard = card(page, "Door Creak");
  const rainCard = card(page, "Rain");

  // A one-shot sound plays, shows in the player bar, and stops by itself.
  await doorCard.getByRole("button", { name: "play", exact: true }).click();
  await expect(doorCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  const doorChip = page.getByRole("button", { name: "Door Creak", exact: true });
  await expect(doorChip).toBeVisible();
  await expect(doorCard.getByRole("button", { name: "play", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(doorChip).toHaveCount(0);

  // Stopped early with the stop button.
  await doorCard.getByRole("button", { name: "play", exact: true }).click();
  await expect(doorCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  await doorCard.getByRole("button", { name: "stop", exact: true }).click();
  await expect(doorCard.getByRole("button", { name: "play", exact: true })).toBeVisible();

  // A looping sound with fades keeps going past its 2-second length.
  await rainCard.getByRole("button", { name: "loop", exact: true }).click();
  await expect(rainCard.getByRole("button", { name: "no loop" })).toBeVisible();
  await rainCard.getByRole("button", { name: "play", exact: true }).click();
  await expect(rainCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  await page.waitForTimeout(5_000);
  await expect(rainCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  // Stopping from the player bar chip (its delete icon) fades it out.
  const rainChip = page.getByRole("button", { name: "Rain", exact: true });
  await expect(rainChip).toBeVisible();
  await rainChip.focus();
  await page.keyboard.press("Delete");
  await expect(rainCard.getByRole("button", { name: "play", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(rainChip).toHaveCount(0);

  // A looping sound without fades (Howler's own loop) also keeps going.
  await doorCard.getByRole("button", { name: "loop", exact: true }).click();
  await doorCard.getByRole("button", { name: "play", exact: true }).click();
  await expect(doorCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  await page.waitForTimeout(4_500);
  await expect(doorCard.getByRole("button", { name: "stop", exact: true })).toBeVisible();
  await doorCard.getByRole("button", { name: "stop", exact: true }).click();
  await expect(doorCard.getByRole("button", { name: "play", exact: true })).toBeVisible();

  // Volume slider of a sound.
  const volume = doorCard.getByRole("slider", { name: "Volume" });
  await volume.focus();
  await page.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");

  // Edit: name and fades.
  await doorCard.getByRole("button", { name: "Options for Door Creak" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Sound" });
  await expect(edit.getByLabel("Source")).toHaveValue(/door-creak\.wav$/);
  await edit.getByLabel("Name").fill("Heavy Door");
  await edit.getByLabel("fade in").fill("250");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit).toBeHidden();
  await expect(card(page, "Heavy Door")).toBeVisible();

  // Delete a sound, then the soundboard.
  await card(page, "Heavy Door").getByRole("button", { name: "Options for Heavy Door" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(card(page, "Heavy Door")).toHaveCount(0);

  await page.getByRole("button", { name: "Soundboard options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Soundboards", { exact: true })).toBeVisible();
  await expect(card(page, "Dungeon")).toHaveCount(0);
});
