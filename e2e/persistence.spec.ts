/**
 * The library and settings survive a restart: quit the app, start it again
 * with the same data folder, and everything is still there.
 */
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";
import { startLocalSite } from "./fixtures/localSite";
import {
  addSound,
  addTrack,
  card,
  createPlaylist,
  createSoundboard,
  openCard,
  playbackPosition,
  trackRow,
  transport,
} from "./fixtures/player";

test("playlists, soundboards, bookmarks, volume and settings survive a restart", async ({ launchApp, userDataDir }) => {
  const site = await startLocalSite({ "/inn": { title: "The Inn", body: "<h1>Inn</h1>" } });
  try {
    const tone = writeSineWav(`${userDataDir}/audio`, "lute.wav", { seconds: 8 });
    const bell = writeSineWav(`${userDataDir}/audio`, "bell.wav", { seconds: 2, frequency: 880 });

    // First start: build a small library.
    const first = await launchApp();
    let main = await first.mainWindow();
    let player = await first.playerView();

    await createPlaylist(player, "Saved Playlist");
    await openCard(player, "Saved Playlist");
    await addTrack(player, tone, "Lute");
    const volume = player.getByRole("slider", { name: "Volume" });
    await volume.focus();
    await player.keyboard.press("Home");
    await expect(volume).toHaveAttribute("aria-valuenow", "0");
    await player.getByRole("button", { name: "repeat playlist" }).click();
    await expect(player.getByRole("button", { name: "repeat track" })).toBeVisible();
    await player.getByRole("button", { name: "Back" }).click();

    await createSoundboard(player, "Saved Board");
    await openCard(player, "Saved Board");
    await addSound(player, bell, "Bell", { fadeIn: 0, fadeOut: 0 });
    await card(player, "Bell").getByRole("button", { name: "loop", exact: true }).click();
    await player.getByRole("button", { name: "Back" }).click();

    await main.getByRole("button", { name: "New tab", exact: true }).click();
    await main.getByLabel("Web address").fill(site.url("/inn"));
    await main.getByLabel("Web address").press("Enter");
    const innTab = main.locator("#controls").getByRole("listitem").filter({ hasText: "The Inn" });
    await innTab.getByRole("button", { name: "bookmark" }).click();
    await expect(main.getByRole("navigation").getByText("The Inn")).toBeVisible();

    await main.getByRole("button", { name: "Settings" }).click();
    let settings = main.getByRole("dialog", { name: "Settings" });
    // Review 0.5.0 CR-3: the remote control's port moved to Lyre's Settings, so another main-window setting is used.
    await settings.getByRole("checkbox", { name: "Microphones and other inputs" }).check();
    await settings.getByRole("button", { name: "Done" }).click();

    await first.close();

    // Second start with the same data folder.
    const second = await launchApp();
    main = await second.mainWindow();
    player = await second.playerView();

    await expect(card(player, "Saved Playlist")).toBeVisible();
    await expect(card(player, "Saved Board")).toBeVisible();
    await expect(main.getByRole("navigation").getByText("The Inn")).toBeVisible();

    await openCard(player, "Saved Playlist");
    await expect(trackRow(player, "Lute")).toBeVisible();
    await expect(player.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "0");
    await expect(player.getByRole("button", { name: "repeat track" })).toBeVisible();
    // The track still points at its file and plays.
    await trackRow(player, "Lute").getByRole("button", { name: "play", exact: true }).click();
    await expect(transport(player).getByRole("button", { name: "pause", exact: true })).toBeVisible();
    await expect.poll(() => playbackPosition(player), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await player.getByRole("button", { name: "Back" }).click();

    await openCard(player, "Saved Board");
    await expect(card(player, "Bell").getByRole("button", { name: "no loop" })).toBeVisible();

    await main.getByRole("button", { name: "Settings" }).click();
    settings = main.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("checkbox", { name: "Microphones and other inputs" })).toBeChecked();
  } finally {
    await site.close();
  }
});

test("a change made just before quitting is saved (PERF-6)", async ({ launchApp }) => {
  // Saving is held back only while a mouse button or key is held down
  // (PERF-6) and catches up when it is let go, so quitting straight after a
  // change keeps it.
  const first = await launchApp();
  let player = await first.playerView();
  await createPlaylist(player, "Last Minute");
  await openCard(player, "Last Minute");
  const volume = player.getByRole("slider", { name: "Volume" });
  await volume.focus();
  await player.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await player.getByRole("button", { name: "Playlist options" }).click();
  await player.getByRole("menuitem", { name: "Edit" }).click();
  const edit = player.getByRole("dialog", { name: "Edit Playlist" });
  await edit.getByLabel("Name").fill("Renamed At The Last Minute");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit).toBeHidden();
  await first.close();

  const second = await launchApp();
  player = await second.playerView();
  await expect(card(player, "Renamed At The Last Minute")).toBeVisible();
  await openCard(player, "Renamed At The Last Minute");
  await expect(player.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "0");
});

test("a change made while a key is still held down is saved when the app quits (PERF-6)", async ({ launchApp }) => {
  // While a key or mouse button is held, saving waits up to 500 ms between
  // writes. Quitting destroys the player page without its page-hide handlers,
  // so the main process asks the player to save first (review 7).
  const first = await launchApp();
  let player = await first.playerView();
  await createPlaylist(player, "Held");
  await openCard(player, "Held");
  const volume = player.getByRole("slider", { name: "Volume" });
  await volume.focus();
  await player.keyboard.press("End");
  await expect(volume).toHaveAttribute("aria-valuenow", "1");
  // Pressed but not let go, straight after the last save: this one is held back.
  await player.keyboard.down("Home");
  await expect(volume).toHaveAttribute("aria-valuenow", "0");
  await first.close();

  const second = await launchApp();
  player = await second.playerView();
  await openCard(player, "Held");
  await expect(player.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuenow", "0");
});

