/**
 * BUG-12, BUG-13 (w31-fix) in the packaged app: what plays belongs to the Lyre page, not to a screen. Preparing a
 * scene never stops what is on air or in preview, and music keeps playing, with the Now playing bar, wherever the game
 * master goes until Stop. Seeded with the prototype's library, whose files play a stand-in tone
 * (src/main/lyreApi/seedAudio.ts), and the prototype's Discord: Lyre Table is in the voice channel Table.
 *
 * BUG-19 (w5-fixes): what goes to the players is heard only through Discord. Sound on air is checked as the packets
 * the fake Discord's Table receives; this computer (the Lyre page and the capture window, by Chromium's own
 * audibility check) never plays it, with a bot in a room or without one.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };
/** The prototype world's voice channel Table (src/main/broadcast/testing/prototypeWorld.ts). */
const TABLE_CHANNEL = "1011";

/** Packets with sound the fake Discord's Table has received so far. */
function heardAtTable(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    (_electron, channelId) => (globalThis as unknown as { __cueDeskFakeDiscord?: { decode(id: string): unknown[] } }).__cueDeskFakeDiscord?.decode(channelId).length ?? -1,
    TABLE_CHANNEL,
  );
}

/** Whether this computer's speakers get sound from Lyre: the Lyre page or the capture window (Chromium's audibility check). */
function thisComputerPlays(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((c) => !c.isDestroyed() && ["Lyre Interface", "Audio Capture"].includes(c.getTitle()) && c.isCurrentlyAudible()),
  );
}

/**
 * Table hears it now and still a second and a half later (so a short gap between tracks is not taken for silence); this
 * computer stays silent. While a preview plays, the capture window plays it in the headphones, so this computer's
 * silence is checked only without one.
 */
async function expectSound(app: ElectronApplication, lyre: Page, why: string, { previewing = false } = {}) {
  const before = await heardAtTable(app);
  await expect.poll(() => heardAtTable(app), { message: why, timeout: 5_000 }).toBeGreaterThan(before + 10);
  const after = await heardAtTable(app);
  await lyre.waitForTimeout(1500);
  expect(await heardAtTable(app), why).toBeGreaterThan(after + 10);
  if (!previewing) expect(await thisComputerPlays(app), `${why}: never on this computer`).toBe(false);
}

const onAirBar = (lyre: Page) => lyre.getByRole("region", { name: "Now playing" });
const abbey = (lyre: Page) => lyre.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ });
const musicOf = (lyre: Page) => abbey(lyre).getByRole("group", { name: "Music", exact: true }).getByRole("list", { name: "Music in order" });

test("adding, moving and removing in a scene leaves the music on air and the preview playing (BUG-12)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "session/crown/s14");
  await lyre.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
  await musicOf(lyre).getByRole("button", { name: "Play on air: The Abbess" }).click();
  await expect(onAirBar(lyre)).toBeVisible();
  const title = (await onAirBar(lyre).locator(".oab-title").first().textContent())?.trim() ?? "";
  expect(title).not.toBe("");
  await musicOf(lyre).getByRole("button", { name: /^Preview Haunted sea shanty/ }).click();
  const stopPreview = musicOf(lyre).getByRole("button", { name: /^Stop preview of Haunted sea shanty/ });
  await expect(stopPreview).toHaveAttribute("aria-pressed", "true");
  await expectSound(launched.app, lyre, "music on air before preparing", { previewing: true });

  await abbey(lyre).getByRole("button", { name: "Add tracks or playlists…" }).click();
  const sheet = lyre.getByRole("dialog");
  await sheet.getByRole("checkbox", { name: /^Quiet grief, solo voice/ }).check();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(musicOf(lyre).getByRole("listitem")).toHaveCount(5);
  await musicOf(lyre).getByRole("button", { name: /^More for Quiet grief/ }).click();
  await lyre.getByRole("menuitem", { name: "Start the scene with it" }).click();
  await musicOf(lyre).getByRole("button", { name: /^More for Quiet grief/ }).click();
  await lyre.getByRole("menuitem", { name: "Remove from this scene" }).click();
  await expect(musicOf(lyre).getByRole("listitem")).toHaveCount(4);

  await expect(onAirBar(lyre)).toContainText(title);
  await expect(stopPreview).toHaveAttribute("aria-pressed", "true");
  await expectSound(launched.app, lyre, "music on air after adding, moving and removing", { previewing: true });
});

test("music started on one screen keeps playing, with the Now playing bar, on the others until Stop (BUG-13)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "playlists");
  await lyre.getByRole("button", { name: "Play on air: The Company themes" }).first().click();
  await expect(onAirBar(lyre)).toBeVisible();
  // The playlist it plays from, which the bar and Live's room box both name: the test files are a few seconds long, so
  // the track itself may have moved on to the next one between screens.
  const from = "The Company themes";
  await expect(onAirBar(lyre)).toContainText(from);
  await expectSound(launched.app, lyre, "music on air on Playlists");
  // Through the rail, as a person goes: Library, Pad boards, Campaigns, then Live. In Live the room boxes show what is on
  // air, so the bar there shows previews only (UX-16) and the track is in the room's On air box.
  for (const [link, heading] of [
    ["Library", "Library"],
    ["Pad boards", "Pad boards"],
    ["Campaigns", "Campaigns"],
    [/^Live/, "Live"],
  ] as const) {
    await lyre.getByRole("navigation").getByRole("link", { name: link }).first().click();
    await expect(lyre.getByRole("main").getByRole("heading", { level: 1 })).toContainText(heading);
    if (heading === "Live") {
      await expect(onAirBar(lyre), "no room rows in the bar in Live").toHaveCount(0);
      await expect(lyre.getByRole("region", { name: /^On air/ }).first()).toContainText(from);
    } else {
      await expect(onAirBar(lyre), `the bar on ${heading}`).toBeInViewport();
      await expect(onAirBar(lyre)).toContainText(from);
    }
    await expectSound(launched.app, lyre, `music on air on ${heading}`);
  }
  await lyre.getByRole("navigation").getByRole("link", { name: "Library" }).first().click();
  await onAirBar(lyre).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(onAirBar(lyre)).toHaveCount(0);
  // Stopped: after the fade, Table receives nothing more.
  await lyre.waitForTimeout(2000);
  const stopped = await heardAtTable(launched.app);
  await lyre.waitForTimeout(1500);
  expect(await heardAtTable(launched.app)).toBe(stopped);
});

test("with no bot in a voice channel, music on air plays nowhere: nobody hears it, and the bar says so (BUG-19)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "playlists");
  await launched.app.evaluate(() => (globalThis as unknown as { __lyreOutputsTest: { leaveAll(): Promise<void> } }).__lyreOutputsTest.leaveAll());
  await lyre.getByRole("button", { name: "Play on air: The Company themes" }).first().click();
  const row = onAirBar(lyre).getByRole("group", { name: "On air: no room" });
  await expect(row).toContainText("nobody hears it");
  await expect(row.locator(".num")).not.toHaveText(/^0:00/, { timeout: 5_000 });
  const heard = await heardAtTable(launched.app);
  for (let i = 0; i < 6; i++) {
    expect(await thisComputerPlays(launched.app), "nothing on this computer").toBe(false);
    await lyre.waitForTimeout(500);
  }
  expect(await heardAtTable(launched.app)).toBe(heard);
});
