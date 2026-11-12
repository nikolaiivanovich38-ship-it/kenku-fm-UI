/**
 * OUT-5, PRV-1 in the packaged app with the fake Discord (test builds only):
 * each engine room's mix goes from the player page over the private channel
 * to the capture window and to that room's bot only; the preview never
 * reaches any room. The engine is driven through `window.__lyreRoomsTest`
 * (src/player/engine/rooms/testHook.ts) because the new interface does not
 * exist yet.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { captureCounts } from "./fixtures/audioTiming";
import {
  FAKE_DISCORD_ENV,
  botSettings,
  channelButton,
  connectFakeBot,
  openSettings,
  packetCount,
  receivedAudio,
  type FakeChannelName,
} from "./fixtures/discord";

type Room = { botId: string; name: string };
type RoomsTestApi = {
  start(): Promise<void>;
  status(): { rooms: Room[]; broadcasting: boolean; linked: boolean };
  tone(roomId: string, frequency: number): void;
  preview(frequency: number): void;
  sent(): Record<string, number>;
};
type WithRooms = { __lyreRoomsTest: RoomsTestApi };

// Each step is its own evaluate: the player page's Content-Security-Policy forbids eval.
const api = {
  start: (page: Page) => page.evaluate(() => (window as unknown as WithRooms).__lyreRoomsTest.start()),
  status: (page: Page) => page.evaluate(() => (window as unknown as WithRooms).__lyreRoomsTest.status()),
  tone: (page: Page, room: string, frequency: number) =>
    page.evaluate(([r, f]) => (window as unknown as WithRooms).__lyreRoomsTest.tone(r, f), [room, frequency] as const),
  preview: (page: Page, frequency: number) =>
    page.evaluate((f) => (window as unknown as WithRooms).__lyreRoomsTest.preview(f), frequency),
  sent: (page: Page) => page.evaluate(() => (window as unknown as WithRooms).__lyreRoomsTest.sent()),
};

/** Two bots, Bot 1 in the Tavern (the table) and Bot 2 in the Dungeon. */
async function twoRooms(mainWindow: Page) {
  const settings = await openSettings(mainWindow);
  await settings.getByRole("button", { name: "Add a second bot" }).click();
  await mainWindow.getByRole("dialog", { name: "Add a second bot" }).getByRole("button", { name: "Add bot" }).click();
  await expect(botSettings(mainWindow, "Bot 2")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
  await connectFakeBot(mainWindow, "fake-token-1", "Bot 1");
  await connectFakeBot(mainWindow, "fake-token-2", "Bot 2");
  await channelButton(mainWindow, "Tavern", "Bot 1").click();
  await channelButton(mainWindow, "Dungeon", "Bot 2").click();
  await expect(channelButton(mainWindow, "Tavern", "Bot 1")).toHaveAttribute("aria-pressed", "true");
  await expect(channelButton(mainWindow, "Dungeon", "Bot 2")).toHaveAttribute("aria-pressed", "true");
}

/**
 * The Lyre page takes the private channel while it is open (w3-host; wired in wave 3). These tests drive the old
 * player's engine, so they remove the Lyre page first (as the main window removes a view) and the old player takes
 * the channel back, as it does whenever the Lyre page goes away.
 */
async function closeLyrePage(app: ElectronApplication, mainWindow: Page): Promise<void> {
  let viewId = 0;
  await expect
    .poll(
      async () =>
        (viewId = await app.evaluate(
          ({ webContents }) => webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getTitle() === "Lyre Interface")?.id ?? 0,
        )),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await mainWindow.evaluate((id) => (window as unknown as { kenku: { removeBrowserView(id: number): void } }).kenku.removeBrowserView(id), viewId);
}

/** Start the engine's rooms in the player page and wait until both rooms stream. */
async function startRooms(playerView: Page): Promise<Room[]> {
  await api.start(playerView);
  await expect
    .poll(() => api.status(playerView), { timeout: 10_000 })
    .toMatchObject({ broadcasting: true, linked: true, rooms: [{ name: "Tavern" }, { name: "Dungeon" }] });
  return (await api.status(playerView)).rooms;
}

/** Strength of one frequency in the left channel of what a channel received (Goertzel). */
async function strength(app: ElectronApplication, channel: FakeChannelName, frequency: number): Promise<number> {
  const count = await packetCount(app, channel);
  // The last second, past the start of each tone.
  const packets = await receivedAudio(app, channel, Math.max(0, count - 50), 50);
  const left = packets.flatMap(({ pcm }) => pcm.filter((_, i) => i % 2 === 0).map((sample) => sample / 32768));
  if (left.length === 0) {
    return 0;
  }
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / 48_000);
  let previous = 0;
  let before = 0;
  for (const sample of left) {
    const current = sample + coefficient * previous - before;
    before = previous;
    previous = current;
  }
  const power = previous * previous + before * before - coefficient * previous * before;
  return Math.sqrt(power) / left.length;
}


/**
 * A room's own tone counts as heard above this strength. It measures about 0.06 on a quiet machine and fell to 0.041
 * to 0.048 on the 2-core build machine under load (packets late or dropped), failing a different test each time. The
 * checks that matter are the ratios below (the other room's tone at least 20 or 50 times weaker, no packets at all
 * for an idle room); this floor only says the tone arrived, so it sits well above silence and below the loaded range.
 */
const HEARD = 0.02;

test("each engine room reaches its own bot: two rooms receive different sound (OUT-5)", async ({ launchApp }) => {
  test.setTimeout(90_000);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  const playerView = await launched.playerView();
  await twoRooms(mainWindow);
  await closeLyrePage(app, mainWindow);
  const [tavern, dungeon] = await startRooms(playerView);

  await api.tone(playerView, tavern.botId, 440);
  await api.tone(playerView, dungeon.botId, 1000);
  await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(80);
  await expect.poll(() => packetCount(app, "Dungeon"), { timeout: 10_000 }).toBeGreaterThan(80);

  const heard = {
    tavern: { a: await strength(app, "Tavern", 440), b: await strength(app, "Tavern", 1000) },
    dungeon: { a: await strength(app, "Dungeon", 440), b: await strength(app, "Dungeon", 1000) },
  };
  expect(heard.tavern.a).toBeGreaterThan(HEARD);
  expect(heard.tavern.b).toBeLessThan(heard.tavern.a / 20);
  expect(heard.dungeon.b).toBeGreaterThan(HEARD);
  expect(heard.dungeon.a).toBeLessThan(heard.dungeon.b / 20);
});

test("a preview produces nothing in any room while a room is playing (PRV-1)", async ({ launchApp }) => {
  test.setTimeout(90_000);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  const playerView = await launched.playerView();
  await twoRooms(mainWindow);
  await closeLyrePage(app, mainWindow);
  const [tavern] = await startRooms(playerView);

  await api.tone(playerView, tavern.botId, 440);
  await api.preview(playerView, 2500);
  await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(80);
  // The preview did play: its frames reached the capture window (since 0.5.1 over a channel of their own, straight
  // from the page's audio thread, so the capture window counts them, not the page).
  const capturePage = await pageWithTitle(app, "Audio Capture");
  await expect.poll(async () => (await captureCounts(app, capturePage))?.preview?.frames ?? 0).toBeGreaterThan(50);
  await mainWindow.waitForTimeout(1_000);

  const tavernTone = await strength(app, "Tavern", 440);
  expect(tavernTone).toBeGreaterThan(HEARD);
  expect(await strength(app, "Tavern", 2500)).toBeLessThan(tavernTone / 50);
  // The Dungeon plays nothing: no sound at all reaches it.
  expect(await packetCount(app, "Dungeon")).toBe(0);
});

test("the player page may choose a sound output device, and still not use the microphone (PRV-2)", async ({ playerView }) => {
  const result = await playerView.evaluate(async () => {
    const outcome = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "ok";
      } catch (error) {
        return (error as Error).name;
      }
    };
    const element = new Audio() as HTMLAudioElement & { setSinkId(id: string): Promise<void> };
    return {
      // No such device here, but the page is allowed to ask: "not found", not "not allowed".
      chooseDevice: await outcome(() => element.setSinkId("a-device-that-is-not-plugged-in")),
      microphone: await outcome(() => navigator.mediaDevices.getUserMedia({ audio: true })),
    };
  });
  expect(result.chooseDevice).toBe("NotFoundError");
  // Refused ("NotAllowedError"); a machine with no microphone at all says "NotFoundError" first.
  expect(["NotAllowedError", "NotFoundError"]).toContain(result.microphone);
});
