/**
 * w51-audio: Nik heard Lyre 0.5.0 "very stuttery in playback" on Discord. These checks play the seeded library's
 * steady stand-in tone into two rooms (Table and Side room) and count, in what the fake Discord receives, the 20 ms
 * holes (gaps) and the places where audio was lost or doubled (jumps): see fixtures/audioTiming.ts. They also note
 * the Lyre page's long tasks, the main-thread work that competes with the sound.
 *
 * Each test prints its numbers and adds them to the report as annotations, so a run on another computer can be
 * compared with the figures in the commit messages.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";
import {
  analyseStream,
  busyMainThread,
  captureCounts,
  countsSince,
  feedCounts,
  mainNow,
  rawPackets,
  takeLongTasks,
  watchLongTasks,
  type FeedCounts,
  type InletCounts,
  type StreamTiming,
} from "./fixtures/audioTiming";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };
/** The prototype world's voice channels (src/main/broadcast/testing/prototypeWorld.ts). */
const CHANNELS = { Table: "1011", "Side room": "1012" } as const;
type Channel = keyof typeof CHANNELS;

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** Sound packets a channel has received so far. */
async function soundPackets(app: ElectronApplication, channel: Channel): Promise<number> {
  const packets = await rawPackets(app, CHANNELS[channel], 0);
  return packets.filter((packet) => packet.data.length > 3).length;
}

/**
 * Live with Lyre Side in the Side room: scene 3 (music and ambience) on air in the Table, a session playlist on air
 * in the Side room, so two rooms stream at once. Resolves once both are heard.
 */
async function playInTwoRooms(app: ElectronApplication, mainWindow: Page): Promise<Page> {
  const lyre = await openLyreRoute(mainWindow, "live");
  await watchLongTasks(lyre);
  await app.evaluate(() =>
    (globalThis as unknown as { __lyreOutputsTest: { join(bot: string, channel: string): Promise<void> } }).__lyreOutputsTest.join(
      "Lyre Side",
      "Side room",
    ),
  );
  await lyre.getByRole("button", { name: "Start scene 3: The abbey ruins" }).click();
  const playlists = region(lyre, "Session playlists");
  const toggle = playlists.getByRole("heading", { level: 2 }).getByRole("button");
  if ((await toggle.count()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await playlists.getByRole("button", { name: /choose a room/i }).click();
  await lyre.getByRole("menuitemradio", { name: "Side room" }).click();
  await playlists.getByRole("button", { name: /^Play on air in Side room: / }).first().click();
  for (const channel of Object.keys(CHANNELS) as Channel[]) {
    await expect.poll(() => soundPackets(app, channel), { message: `${channel} hears the music`, timeout: 15_000 }).toBeGreaterThan(50);
  }
  // Past the scene's and the playlist's fade in.
  await lyre.waitForTimeout(4_000);
  return lyre;
}

type Heard = {
  channels: Record<Channel, StreamTiming>;
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** w51-audio builds only: the capture window's and the Discord players' own counts for the window. */
  capture: InletCounts | null;
  players: FeedCounts | null;
};

/** Listen for `seconds` and analyse what each channel received meanwhile. */
async function listen(app: ElectronApplication, lyre: Page, seconds: number): Promise<Heard> {
  const capturePage = await pageWithTitle(app, "Audio Capture");
  await takeLongTasks(lyre);
  const before = { capture: await captureCounts(app, capturePage), players: await feedCounts(app) };
  const from = await mainNow(app);
  await lyre.waitForTimeout(seconds * 1000);
  const to = await mainNow(app);
  const longTasks = await takeLongTasks(lyre);
  const after = { capture: await captureCounts(app, capturePage), players: await feedCounts(app) };
  const channels = {} as Record<Channel, StreamTiming>;
  for (const channel of Object.keys(CHANNELS) as Channel[]) {
    channels[channel] = analyseStream(await rawPackets(app, CHANNELS[channel], from - 2_000), from, to);
  }
  return { channels, longTasks, capture: countsSince(before.capture, after.capture), players: countsSince(before.players, after.players) };
}

function report(name: string, heard: Heard): void {
  const text = JSON.stringify(heard);
  console.log(`${name}: ${text}`);
  test.info().annotations.push({ type: name, description: text });
}

/** Holes and lost audio a channel had in a window. */
const stutter = (timing: StreamTiming) => timing.gaps + timing.jumps;

/**
 * Allowed per channel in 10 seconds (500 packets). The 2-core build machine runs other jobs beside the tests; a
 * single late wake-up there can cost one or two packets. Before the w51-audio fixes these checks saw dozens.
 */
const ALLOWED = 3;

test("steady sound in two rooms reaches Discord without holes, on Live and on Rooms with its meters", async ({ launchApp }) => {
  test.setTimeout(120_000);
  const launched = await launchApp({ env: SEEDED });
  const lyre = await playInTwoRooms(launched.app, await launched.mainWindow());

  const live = await listen(launched.app, lyre, 10);
  report("Live, two rooms", live);

  // Rooms (the Outputs screen) with a level meter moving for each room.
  await lyre.evaluate(() => (window.location.hash = "#/outputs"));
  await expect(lyre.locator('[data-testid^="meter-"]').first()).toBeVisible();
  const rooms = await listen(launched.app, lyre, 10);
  report("Rooms with meters, two rooms", rooms);

  for (const [name, heard] of [
    ["Live", live],
    ["Rooms", rooms],
  ] as const) {
    for (const channel of Object.keys(CHANNELS) as Channel[]) {
      expect(heard.channels[channel].sound, `${name}: ${channel} heard the music all along`).toBeGreaterThan(400);
      expect(stutter(heard.channels[channel]), `${name}: ${channel} holes and lost audio`).toBeLessThanOrEqual(ALLOWED);
    }
  }
});

test("a busy Lyre page does not interrupt the sound: 60 ms of work every 250 ms on its main thread", async ({ launchApp }) => {
  test.setTimeout(120_000);
  const launched = await launchApp({ env: SEEDED });
  const lyre = await playInTwoRooms(launched.app, await launched.mainWindow());

  await busyMainThread(lyre, 60, 250, 10);
  const busy = await listen(launched.app, lyre, 10);
  report("Busy Lyre page, two rooms", busy);

  expect(busy.longTasks.count, "the page was kept busy").toBeGreaterThan(20);
  for (const channel of Object.keys(CHANNELS) as Channel[]) {
    expect(busy.channels[channel].sound, `${channel} heard the music all along`).toBeGreaterThan(400);
    expect(stutter(busy.channels[channel]), `${channel} holes and lost audio`).toBeLessThanOrEqual(ALLOWED);
  }
});

test("a preview reaches the headphones in one piece while the Lyre page is busy (the capture window's counts)", async ({ launchApp }) => {
  test.setTimeout(120_000);
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "session/crown/s14");
  await watchLongTasks(lyre);
  const capturePage = await pageWithTitle(launched.app, "Audio Capture");
  await lyre.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
  const music = lyre
    .getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ })
    .getByRole("group", { name: "Music", exact: true })
    .getByRole("list", { name: "Music in order" });
  await music.getByRole("button", { name: /^Preview Haunted sea shanty/ }).click();
  await lyre.waitForTimeout(3_000);

  await busyMainThread(lyre, 60, 250, 10);
  await takeLongTasks(lyre);
  const before = await captureCounts(launched.app, capturePage);
  await lyre.waitForTimeout(10_000);
  const longTasks = await takeLongTasks(lyre);
  const counts = countsSince(before, await captureCounts(launched.app, capturePage));
  const text = JSON.stringify({ preview: counts?.preview ?? null, longTasks });
  console.log(`Busy Lyre page, preview: ${text}`);
  test.info().annotations.push({ type: "Busy Lyre page, preview", description: text });

  // Only builds with the capture window's counts can be measured here.
  test.skip(counts === null, "this build does not count the preview's frames (0.5.0)");
  expect(longTasks.count, "the page was kept busy").toBeGreaterThan(20);
  // 10 s is 500 frames; a timer-driven context that skips sends fewer.
  expect(counts!.preview.frames, "the preview's frames all came").toBeGreaterThan(470);
  expect(counts!.preview.holes + counts!.preview.dropped, "holes and drops in the preview").toBeLessThanOrEqual(ALLOWED);
});
