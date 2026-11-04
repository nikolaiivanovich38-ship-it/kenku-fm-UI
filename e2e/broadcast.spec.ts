/**
 * WP2 PERF-4: audio is recorded and encoded only while an output is in a
 * voice channel, only for tabs that play sound, and the start of a sound
 * reaches Discord. Uses the fake Discord (fixtures/discord.ts).
 */
import type { ConsoleMessage, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";
import {
  FAKE_DISCORD_ENV,
  TONE_PAGE,
  channelButton,
  chooseStreamingMode,
  tonePage,
  connectFakeBot,
  openTab,
  packetCount,
  receivedAudio,
  receivedPeaks,
} from "./fixtures/discord";

let site: LocalSite;

test.beforeEach(async () => {
  site = await startLocalSite({
    "/tone": TONE_PAGE,
    "/ramp-a": tonePage("/ramp-a"),
    "/ramp-b": tonePage("/ramp-b"),
    "/ramp-element": tonePage("/ramp-element"),
  });
});

test.afterEach(async () => {
  await site.close();
});

/** Collect what the hidden capture window logs. */
async function captureLog(app: Parameters<typeof pageWithTitle>[0]) {
  const capture = await pageWithTitle(app, "Audio Capture");
  const lines: string[] = [];
  capture.on("console", (message: ConsoleMessage) => lines.push(message.text()));
  return lines;
}

async function openToneTab(mainWindow: Page, app: Parameters<typeof pageWithTitle>[0]) {
  const viewId = await openTab(mainWindow, site.url("/tone"));
  const tone = await pageWithTitle(app, "Tone");
  return { viewId, tone };
}

test("nothing is recorded before an output joins a voice channel; joining starts it and leaving stops it", async ({
  launchApp,
}) => {
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  const log = await captureLog(app);

  const { viewId, tone } = await openToneTab(mainWindow, app);
  await tone.evaluate(() => (window as unknown as { playTone(): void }).playTone());
  await connectFakeBot(mainWindow);
  // A tab playing sound, a connected bot, but no voice channel: no recording.
  await mainWindow.waitForTimeout(1_500);
  expect(log).toEqual([]);
  expect(await packetCount(app, "Tavern")).toBe(0);

  await channelButton(mainWindow, "Tavern").click();
  await expect.poll(() => log, { timeout: 10_000 }).toContain(`Capturing audio of view ${viewId}`);
  expect(log[0]).toBe("Broadcast audio started");
  await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(10);
  // The player is silent, so it is not recorded.
  expect(log.filter((line) => line.startsWith("Capturing audio of view"))).toEqual([
    `Capturing audio of view ${viewId}`,
  ]);

  // Back to "This Computer" only: the bot leaves and recording stops.
  await mainWindow.getByRole("button", { name: "This Computer" }).click();
  await expect.poll(() => log, { timeout: 10_000 }).toContain("Broadcast audio stopped");
});

/** Wait until Discord has been sent everything still on its way (no new packet for half a second). */
async function packetsSettled(app: Parameters<typeof packetCount>[0]) {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await packetCount(app, "Tavern");
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [500], timeout: 10_000 },
    )
    .toBe(true);
}

/**
 * How much of the start of a sound Discord missed. The tone's volume rises
 * evenly from 0 to full over `rampSeconds`, so the volume of the first sound
 * received tells how far into the tone recording began.
 */
function missedMs(samples: number[], rampSeconds: number): number {
  const threshold = 0.003 * 32768;
  const first = samples.findIndex((sample) => Math.abs(sample) > threshold);
  if (first < 0) {
    return Number.POSITIVE_INFINITY;
  }
  // Peak over the first 10 ms (480 stereo samples) of sound.
  const peak = Math.max(...samples.slice(first, first + 960).map(Math.abs)) / 32768;
  return peak * rampSeconds * 1000;
}

test("the start of a sound reaches Discord: about 100 ms at most is lost while recording starts", async ({
  launchApp,
}) => {
  test.setTimeout(90_000);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  await connectFakeBot(mainWindow);
  await channelButton(mainWindow, "Tavern").click();

  // Three tabs, each recorded only once it plays: Web Audio twice (the
  // soundboard's way), and an audio element (playlists, YouTube).
  const rampSeconds = 2;
  const results: Record<string, number> = {};
  for (const [path, how] of [
    ["/ramp-a", "playRamp"],
    ["/ramp-b", "playRamp"],
    ["/ramp-element", "playRampElement"],
  ] as const) {
    const before = await packetCount(app, "Tavern");
    await openTab(mainWindow, site.url(path));
    const page = await pageWithTitle(app, path);
    await mainWindow.waitForTimeout(500);
    await page.evaluate(
      ([method, seconds]) => (window as unknown as Record<string, (s: number) => unknown>)[method](seconds),
      [how, rampSeconds] as const,
    );
    await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(before + 25);
    const packets = await receivedAudio(app, "Tavern", before, 50);
    results[path] = Math.round(missedMs(packets.flatMap((packet) => packet.pcm), rampSeconds));
    // Silence the tab so the next one's start is measured on its own.
    await page.evaluate(() => document.querySelectorAll("audio").forEach((audio) => audio.pause()));
    await page.evaluate(() => (window as unknown as { stopTone(): void }).stopTone());
    await packetsSettled(app);
  }

  console.log(`Start of each sound missed by (ms): ${JSON.stringify(results)}`);
  test.info().annotations.push({ type: "missed start (ms)", description: JSON.stringify(results) });
  const sorted = Object.values(results).sort((a, b) => a - b);
  // Chromium reports a page audible up to ~70 ms after its sound starts
  // (it checks 15 times a second); recording then starts within ~10 ms.
  // The median allows one slow start on a busy test machine.
  expect(sorted[1]).toBeLessThan(110);
  expect(sorted[2]).toBeLessThan(250);
});

for (const mode of ["Low Latency", "Performance"] as const) {
  test(`delay from a tab's sound to Discord in ${mode} mode`, async ({ launchApp }) => {
    test.setTimeout(90_000);
    const launched = await launchApp({ env: FAKE_DISCORD_ENV });
    const { app } = launched;
    const mainWindow = await launched.mainWindow();
    await launched.playerView();
    await chooseStreamingMode(mainWindow, mode);
    await connectFakeBot(mainWindow);
    await channelButton(mainWindow, "Tavern").click();
    await openTab(mainWindow, site.url("/tone"));
    const tone = await pageWithTitle(app, "Tone");
    // A quiet tone first, so the tab is already being recorded.
    await tone.evaluate(() => (window as unknown as { playQuiet(): void }).playQuiet());
    await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(50);

    const delays: number[] = [];
    for (let jump = 0; jump < 3; jump++) {
      // Let the previous loud half-second pass.
      await mainWindow.waitForTimeout(1_500);
      const before = await packetCount(app, "Tavern");
      const loudAt = await tone.evaluate(() => (window as unknown as { jumpAfter(s: number): number }).jumpAfter(0.3));
      const firstLoud = async () =>
        (await receivedPeaks(app, "Tavern", before)).find((packet) => packet.peak > 0.3);
      await expect.poll(async () => (await firstLoud()) !== undefined, { timeout: 10_000 }).toBe(true);
      delays.push(Math.round(((await firstLoud())?.at ?? 0) - loudAt));
    }
    delays.sort((a, b) => a - b);
    console.log(`${mode}: delay from the tab to Discord (ms): ${JSON.stringify(delays)}`);
    test.info().annotations.push({ type: `${mode} delay (ms)`, description: JSON.stringify(delays) });
    expect(delays[1]).toBeLessThan(mode === "Low Latency" ? 250 : 900);
  });
}
