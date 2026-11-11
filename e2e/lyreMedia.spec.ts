/**
 * w3-media: what the packaged app does with audio files through its bundled libraries. music-metadata (ESM-only,
 * bundled into the library's process) reads new tracks' tags and length; the ffmpeg that ffmpeg-static ships is
 * found outside app.asar, converts formats the player cannot play (BUG-10), and works out each track's loudness peaks.
 */
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreTab } from "./fixtures/lyre";
import { aiffBytes, wavBytes, writeFile } from "../src/main/media/testing/wavFiles";

/** A LyreApi call from the Lyre page, exactly as its screens make them. */
function lyreCall<T = unknown>(lyre: Page, area: string, method: string, ...args: unknown[]): Promise<T> {
  return lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([a, m, rest]) => (window as any).lyre.api.call(a, m, rest),
    [area, method, args] as const,
  ) as Promise<T>;
}

type Track = { id: string; metaTitle: string; artist: string; album: string; durationMs: number | null; url: string | null };

async function importFiles(lyre: Page, paths: string[]): Promise<Track[]> {
  const imported = await lyreCall<{ ok: boolean; value: { added: string[] } }>(lyre, "import", "start", { from: "paths", paths });
  expect(imported.ok).toBe(true);
  const tracks = await lyreCall<Track[]>(lyre, "library", "listTracks");
  return imported.value.added.map((id) => tracks.find((t) => t.id === id) as Track);
}

test("the packaged app finds its bundled ffmpeg outside app.asar", async ({ app }) => {
  const ffmpegPath = await app.evaluate(() => (globalThis as unknown as { lyreFfmpegPath: string | null }).lyreFfmpegPath);
  expect(ffmpegPath, "the bundled ffmpeg (forge.config.js ships ffmpeg-static; ASAR_UNPACK_GLOB keeps it unpacked)").toBeTruthy();
  expect(ffmpegPath).toContain(`app.asar.unpacked${path.sep}node_modules${path.sep}ffmpeg-static${path.sep}ffmpeg`);
  expect(fs.existsSync(ffmpegPath as string)).toBe(true);
});

test("an AIFF file plays: the player gets a FLAC copy made by the bundled ffmpeg (BUG-10)", async ({ mainWindow, userDataDir }) => {
  const file = writeFile(path.join(userDataDir, "sounds"), "Temple bells.aiff", aiffBytes({ seconds: 2, sampleRate: 44100, channels: 2 }));
  const lyre = await openLyreTab(mainWindow);
  const [track] = await importFiles(lyre, [file]);
  expect(track.url).toBeTruthy();
  const prepared = await lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (url) => (window as any).lyre.audio.media.prepare(url, { keepLocal: false }) as Promise<{ url?: string; error?: string }>,
    track.url as string,
  );
  expect(prepared.error, "no refusal").toBeUndefined();
  // Security review 6: the Lyre page is given a lyre-media: address for the copy, never a file: one.
  expect(prepared.url).toMatch(/^lyre-media:\/\/.*\.flac$/);
  const start = await lyre.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    return String.fromCharCode(...bytes.subarray(0, 4));
  }, prepared.url as string);
  expect(start).toBe("fLaC");
});

test("new tracks get their file-tag title, artist, album and length, then their loudness peaks", async ({ mainWindow, userDataDir }) => {
  const file = writeFile(
    path.join(userDataDir, "sounds"),
    "07 track.wav",
    wavBytes({ seconds: 3, sampleRate: 22050, level: (t) => (t < 1.5 ? 0.001 : 0.9) }, { title: "Tavern Warmth", artist: "The Lute Guild", album: "Inns of the North" }),
  );
  const lyre = await openLyreTab(mainWindow);
  const [track] = await importFiles(lyre, [file]);
  expect(track).toMatchObject({ metaTitle: "Tavern Warmth", artist: "The Lute Guild", album: "Inns of the North", durationMs: 3000 });

  let levels: number[] | null = null;
  await expect
    .poll(async () => (levels = await lyreCall<number[] | null>(lyre, "library", "peaksOf", track.id)), { message: "the track's peaks", timeout: 15_000 })
    .not.toBeNull();
  expect(levels).toHaveLength(1000);
  expect(Math.max(...(levels as number[]).slice(0, 450))).toBeLessThan(0.1);
  expect(Math.min(...(levels as number[]).slice(550))).toBeGreaterThan(0.9);
});
