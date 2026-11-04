/**
 * FND-4: tab audio capture, the way Discord broadcasting gets the player's
 * sound. The main process asks for a media source id for the player view and
 * the hidden capture window opens it with getUserMedia (legacy
 * `chromeMediaSource: "tab"` constraint, as AudioCaptureManagerPreload does).
 *
 * SEC-3: Chromium asks the captured page for permission. The app allows it
 * only for pages it chose to capture (src/main/security/captureTargets.ts).
 * PERF-4 (WP2): a page is chosen only while an output is in a voice channel
 * and the page plays sound; the first test asks for the player's media
 * source id itself, as the capture manager would.
 */
import type { ConsoleMessage } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite } from "./fixtures/localSite";
import { writeSineWav } from "./fixtures/audio";
import { addTrack, createPlaylist, openCard, trackRow } from "./fixtures/player";
import { FAKE_DISCORD_ENV, TONE_PAGE, channelButton, connectFakeBot, openTab } from "./fixtures/discord";

test("the player's audio can be captured only while it plays during a broadcast", async ({ launchApp, userDataDir }) => {
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  const playerView = await launched.playerView();
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  const capture = await pageWithTitle(app, "Audio Capture");
  const captureLog: string[] = [];
  capture.on("console", (message: ConsoleMessage) => captureLog.push(message.text()));

  // Nothing is being broadcast, so the app has not chosen the player for
  // capture and Chromium's permission request is refused (SEC-3).
  const sourceId = await app.evaluate(({ webContents }) => {
    const all = webContents.getAllWebContents();
    const player = all.find((contents) => contents.getTitle() === "Cue Desk Player");
    const captureWindow = all.find((contents) => contents.getTitle() === "Audio Capture");
    if (!player || !captureWindow) {
      throw new Error("player view or capture window not found");
    }
    return player.getMediaSourceId(captureWindow);
  });
  const result = await capture.evaluate(async (id) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: id } },
        video: false,
      } as MediaStreamConstraints);
      stream.getTracks().forEach((track) => track.stop());
      return "live";
    } catch (error) {
      return (error as Error).name;
    }
  }, sourceId);
  expect(result).toBe("NotAllowedError");

  // In a voice channel, playing a track gets the player captured.
  await connectFakeBot(mainWindow);
  await channelButton(mainWindow, "Tavern").click();
  const tone = writeSineWav(`${userDataDir}/audio`, "tone.wav", { seconds: 8 });
  await createPlaylist(playerView, "Battle");
  await openCard(playerView, "Battle");
  await addTrack(playerView, tone, "Tone");
  await trackRow(playerView, "Tone").getByRole("button", { name: "play", exact: true }).click();
  await expect
    .poll(() => captureLog.some((line) => /^Capturing audio of view \d+$/.test(line)), { timeout: 10_000 })
    .toBe(true);
  // Captured, so the player no longer plays by itself: no NotAllowedError logged.
  expect(captureLog.filter((line) => /Unable/.test(line))).toEqual([]);
});

/**
 * Start a broadcast with the fake Discord and play a tone in a website tab,
 * so the app captures that tab. Returns the tab's page and view id.
 */
async function captureATab(launchApp: Parameters<Parameters<typeof test>[2]>[0]["launchApp"], url: string) {
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  const capture = await pageWithTitle(app, "Audio Capture");
  const captureLog: { type: string; text: string }[] = [];
  capture.on("console", (message: ConsoleMessage) => captureLog.push({ type: message.type(), text: message.text() }));

  const viewId = await openTab(mainWindow, url);
  const site = await pageWithTitle(app, "Tone");
  await connectFakeBot(mainWindow);
  await channelButton(mainWindow, "Tavern").click();
  await site.evaluate(() => (window as unknown as { playTone(): void }).playTone());
  await expect
    .poll(() => captureLog.map((entry) => entry.text), { timeout: 10_000 })
    .toContain(`Capturing audio of view ${viewId}`);
  expect(captureLog.filter((entry) => entry.type === "error")).toEqual([]);
  return { app, site, viewId };
}

test("the app captures a website tab's audio when it plays during a broadcast", async ({ launchApp }) => {
  const local = await startLocalSite({ "/tone": TONE_PAGE });
  try {
    const { app, viewId } = await captureATab(launchApp, local.url("/tone"));
    // Chromium still reports the captured tab as playing.
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isCurrentlyAudible(), viewId)).toBe(true);
  } finally {
    await local.close();
  }
});

test("a website in a tab cannot record the screen or desktop audio (WP1 review)", async ({ launchApp }) => {
  const local = await startLocalSite({ "/tone": TONE_PAGE });
  try {
    // The tab is being captured for Discord, which must not give the site
    // any capture rights of its own.
    const { site } = await captureATab(launchApp, local.url("/tone"));
    const attempts = await site.evaluate(async () => {
      const tryCapture = async (constraints: unknown) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
          stream.getTracks().forEach((track) => track.stop());
          return "granted";
        } catch (error) {
          return (error as Error).name;
        }
      };
      return {
        screen: await tryCapture({ audio: false, video: { mandatory: { chromeMediaSource: "desktop" } } }),
        desktopAudio: await tryCapture({
          audio: { mandatory: { chromeMediaSource: "desktop" } },
          video: { mandatory: { chromeMediaSource: "desktop" } },
        }),
      };
    });

    expect(attempts).toEqual({ screen: "NotAllowedError", desktopAudio: "NotAllowedError" });
  } finally {
    await local.close();
  }
});
