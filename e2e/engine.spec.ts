/**
 * WP4: the new playback engine in a real browser. Unit tests use a fake Web
 * Audio graph; this checks the same routing with Chromium's real one, inside
 * the packaged player page, by listening to the engine's outputs with
 * AnalyserNodes. The engine has no interface yet: test builds expose it as
 * `window.__cueDeskEngineTest` (src/player/engine/testHook.ts).
 */
import { pathToFileURL } from "url";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";

type Probe = "musicBus" | "table" | "whisper" | "preview";
type Played = { state: string; error?: string; duration: number; sourceKind: string | null };
type EngineTestApi = {
  start(): Promise<string>;
  play(url: string, bus: string, options?: Record<string, unknown>): Promise<Played>;
  listen(ms: number): Promise<Record<Probe, number>>;
  stopAll(): void;
  close(): Promise<void>;
};
type WithEngine = { __cueDeskEngineTest: EngineTestApi };

/** RMS of the 0.2-amplitude test tone is about 0.14; silence is 0. */
const HEARD = 0.02;
const SILENT = 0.001;

const start = (page: Page) => page.evaluate(() => (window as unknown as WithEngine).__cueDeskEngineTest.start());
const play = (page: Page, url: string, bus: string, options: Record<string, unknown> = {}) =>
  page.evaluate(([u, b, o]) => (window as unknown as WithEngine).__cueDeskEngineTest.play(u, b, o), [url, bus, options] as const);
const listen = (page: Page, ms = 600) => page.evaluate((m) => (window as unknown as WithEngine).__cueDeskEngineTest.listen(m), ms);
const stopAll = (page: Page) => page.evaluate(() => (window as unknown as WithEngine).__cueDeskEngineTest.stopAll());

test.afterEach(async ({ playerView }) => {
  await playerView.evaluate(() => (window as unknown as WithEngine).__cueDeskEngineTest?.close()).catch((): void => undefined);
});

test("the test build exposes the engine in the player page", async ({ playerView }) => {
  expect(await playerView.evaluate(() => typeof (window as unknown as WithEngine).__cueDeskEngineTest)).toBe("object");
  expect(await start(playerView)).toBe("running");
});

test("a streamed track on the music bus is heard on the music bus and in the table mix only", async ({ playerView, userDataDir }) => {
  const url = pathToFileURL(writeSineWav(`${userDataDir}/audio`, "track.wav", { seconds: 4 })).href;
  await start(playerView);

  const played = await play(playerView, url, "music");
  // Streamed through an <audio> element, not decoded whole (PERF-7).
  expect(played).toEqual({ state: "playing", duration: expect.closeTo(4, 1), sourceKind: "stream" });

  const levels = await listen(playerView);
  expect(levels.musicBus).toBeGreaterThan(HEARD);
  expect(levels.table).toBeGreaterThan(HEARD);
  expect(levels.whisper).toBeLessThan(SILENT);
  expect(levels.preview).toBeLessThan(SILENT);
});

test("a short sound decoded to a buffer plays through the graph", async ({ playerView, userDataDir }) => {
  const url = pathToFileURL(writeSineWav(`${userDataDir}/audio`, "sting.wav", { seconds: 3, frequency: 660 })).href;
  await start(playerView);

  // Read with XMLHttpRequest from file:// and decoded by Web Audio.
  expect(await play(playerView, url, "effects", { preferBuffer: true })).toMatchObject({ state: "playing", sourceKind: "buffer" });
  const levels = await listen(playerView);
  expect(levels.table).toBeGreaterThan(HEARD);
  expect(levels.musicBus).toBeLessThan(SILENT);
});

test("a preview is heard on the preview output and never in the table mix (PRV-1)", async ({ playerView, userDataDir }) => {
  const url = pathToFileURL(writeSineWav(`${userDataDir}/audio`, "next-track.wav", { seconds: 4 })).href;
  await start(playerView);

  expect(await play(playerView, url, "preview")).toMatchObject({ state: "playing" });
  const levels = await listen(playerView);
  expect(levels.preview).toBeGreaterThan(HEARD);
  expect(levels.table).toBeLessThan(SILENT);
  expect(levels.musicBus).toBeLessThan(SILENT);
  expect(levels.whisper).toBeLessThan(SILENT);
});

test("a whisper is heard on the whisper output only, and stop all silences everything (OUT-5, PLY-5)", async ({ playerView, userDataDir }) => {
  const url = pathToFileURL(writeSineWav(`${userDataDir}/audio`, "secret.wav", { seconds: 4 })).href;
  await start(playerView);

  expect(await play(playerView, url, "whisper")).toMatchObject({ state: "playing" });
  // A loop without a fade-out is gapless, so it is decoded.
  expect(await play(playerView, url, "ambience", { loop: true })).toMatchObject({ state: "playing", sourceKind: "buffer" });
  const levels = await listen(playerView);
  expect(levels.whisper).toBeGreaterThan(HEARD);
  expect(levels.table).toBeGreaterThan(HEARD);
  expect(levels.preview).toBeLessThan(SILENT);

  await stopAll(playerView);
  // Let the analysers' window (about 45 ms) clear before measuring.
  await playerView.waitForTimeout(200);
  const after = await listen(playerView, 300);
  expect(after.table).toBeLessThan(SILENT);
  expect(after.whisper).toBeLessThan(SILENT);
});

test("a missing file fails with a message instead of hanging", async ({ playerView, userDataDir, errors }) => {
  // Chromium logs the failed load of the missing file itself.
  errors.ignoredConsole.push(/Failed to load resource: net::ERR_FILE_NOT_FOUND/);
  const url = pathToFileURL(`${userDataDir}/audio/missing.wav`).href;
  await start(playerView);
  const played = await play(playerView, url, "music");
  expect(played.state).toBe("failed");
  expect(played.error).toBeTruthy();
});
