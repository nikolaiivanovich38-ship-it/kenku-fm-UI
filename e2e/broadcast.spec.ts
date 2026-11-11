/**
 * WP2, OUT-5, PRV-1, FND-16 (0.5.1) in the packaged app: the path every Discord packet takes. The Lyre page sends
 * each room's mix over the private channel to the hidden capture window, which encodes it for that room's bot only;
 * a preview stays on this computer. Until 0.5.1 this spec played a website tab and rooms.spec drove the old player's
 * test hook; both are gone, so the Lyre page itself plays here. Seeded with the prototype's library (its files play a
 * stand-in tone, src/main/lyreApi/seedAudio.ts) and Discord: Lyre Table is in Table.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { PROTOTYPE_ENV, joinRoom, receivedPeaks, thisComputerPlays, type PrototypeChannel } from "./fixtures/discord";
import { openLyreRoute } from "./fixtures/lyre";

/** A packet louder than this has sound in it (the stand-in tone is far louder; encoded silence is near 0). */
const SOUND = 0.02;

/** Packets with sound a channel received after packet number `from`. */
async function loudSince(app: ElectronApplication, channel: PrototypeChannel, from: number): Promise<number> {
  return (await receivedPeaks(app, channel, from)).filter((p) => p.peak > SOUND).length;
}

const onAirBar = (lyre: Page) => lyre.getByRole("region", { name: "Now playing" });

test("music on air reaches its room's bot as sound, and no other room (OUT-5)", async ({ launchApp }) => {
  const launched = await launchApp({ env: PROTOTYPE_ENV });
  const { app } = launched;
  const lyre = await openLyreRoute(await launched.mainWindow(), "playlists");
  // A second room: Lyre Side in the Side room.
  await joinRoom(app, "Lyre Side", "Side room");
  const tableBefore = (await receivedPeaks(app, "Table")).length;
  const sideBefore = (await receivedPeaks(app, "Side room")).length;

  await lyre.getByRole("button", { name: "Play on air: The Company themes" }).first().click();
  await expect(onAirBar(lyre)).toBeVisible();
  await expect.poll(() => loudSince(app, "Table", tableBefore), { message: "Table hears the music", timeout: 8_000 }).toBeGreaterThan(25);
  // A second and a half later it still does: the stream keeps going.
  const heard = await loudSince(app, "Table", tableBefore);
  await lyre.waitForTimeout(1500);
  expect(await loudSince(app, "Table", tableBefore)).toBeGreaterThan(heard + 25);
  // The Side room's bot is in a voice channel too, but this music is not its room's.
  expect(await loudSince(app, "Side room", sideBefore), "nothing in the Side room").toBe(0);
  expect(await thisComputerPlays(app), "never on this computer (BUG-19)").toBe(false);

  // Stop: after the fade, Table hears nothing more.
  await onAirBar(lyre).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(onAirBar(lyre)).toHaveCount(0);
  await lyre.waitForTimeout(2000);
  const stopped = (await receivedPeaks(app, "Table")).length;
  await lyre.waitForTimeout(1500);
  expect(await loudSince(app, "Table", stopped)).toBe(0);
});

test("a preview reaches no room: only the game master hears it (PRV-1)", async ({ launchApp }) => {
  const launched = await launchApp({ env: PROTOTYPE_ENV });
  const { app } = launched;
  const lyre = await openLyreRoute(await launched.mainWindow(), "session/crown/s14");
  await lyre.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
  const music = lyre
    .getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ })
    .getByRole("group", { name: "Music", exact: true })
    .getByRole("list", { name: "Music in order" });
  const before = (await receivedPeaks(app, "Table")).length;
  await music.getByRole("button", { name: /^Preview Haunted sea shanty/ }).click();
  await expect(music.getByRole("button", { name: /^Stop preview of Haunted sea shanty/ })).toHaveAttribute("aria-pressed", "true");
  // The capture window plays the preview in the headphones while it lasts.
  await expect.poll(() => thisComputerPlays(app), { message: "the preview plays on this computer", timeout: 8_000 }).toBe(true);
  await lyre.waitForTimeout(2000);
  expect(await loudSince(app, "Table", before), "the preview never reaches Table").toBe(0);
});
