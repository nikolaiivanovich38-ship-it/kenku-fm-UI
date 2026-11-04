/**
 * EDT-6 speed budget: 5,000 files added from one folder (100 albums of 50
 * files) into a library that already holds 20,000 tracks, with a tag reader
 * that answers at once (the real reader's own time comes on top: music-metadata
 * reads a FLAC header in a few milliseconds, about 5 to 15 s for 5,000 files on
 * a Windows laptop with 8 files at a time).
 *
 * Budget (measured on the 2-core build machine: about 1.2 s in all, saving
 * 0.5 s, the longest batch 70 ms):
 * - the whole import (walking, file facts with the quick checksum, saving in
 *   batches with the search index): under 5 s;
 * - saving alone (all batches): under 2 s;
 * - no single batch holds the main process for more than 200 ms (DB review item 1:
 *   longer drops Discord voice packets).
 * Skip on slow CI with CUE_DESK_SKIP_PERF=1.
 */
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLibrary, type Library } from "../library";
import { generateLibrary } from "../test/generateLibrary";
import { makeTempFolder } from "../test/helpers";
import { listTracks } from "../repo/tracks";
import { importAudio, type ImportProgress } from "./pipeline";
import { fakeTagReader, writeAudio } from "./testing/fixtures";

const FILES = 5_000;

describe.skipIf(process.env.CUE_DESK_SKIP_PERF === "1")("importing 5,000 files", () => {
  let temp: ReturnType<typeof makeTempFolder>;
  let library: Library;
  let audio: string;

  beforeAll(() => {
    temp = makeTempFolder("lyre-import-perf-");
    library = openLibrary({ folder: path.join(temp.folder, "library") });
    generateLibrary(library, { tracks: 20_000, playlists: 10 });
    audio = path.join(temp.folder, "Audio");
    for (let i = 0; i < FILES; i++) {
      const album = Math.floor(i / 50);
      writeAudio(audio, `Album ${album}/${String(i % 50).padStart(2, "0")} Cue ${i}.flac`, Buffer.alloc(2048, i % 251));
    }
  }, 300_000);

  afterAll(() => {
    library?.close();
    temp?.cleanup();
  });

  it("stays within its budget", async () => {
    const saves: number[] = [];
    let lastSave = 0;
    const started = performance.now();
    const result = await importAudio(
      library.store,
      { paths: [audio] },
      {
        tagReader: fakeTagReader(),
        onProgress: (p: ImportProgress) => {
          if (p.phase === "reading" && lastSave === 0) lastSave = performance.now();
          if (p.phase === "saving") {
            saves.push(performance.now() - lastSave);
            lastSave = 0;
          }
        },
      },
    );
    const totalMs = performance.now() - started;
    expect(result.added).toHaveLength(FILES);
    expect(listTracks(library.store)).toHaveLength(20_000 + FILES);
    // saves[] holds reading plus saving per batch; the saving share is measured below.
    console.info(`[import perf] ${FILES} files in ${Math.round(totalMs)} ms; batches ${saves.map(Math.round).join(", ")} ms`);
    expect(totalMs).toBeLessThan(5_000);
  }, 60_000);

  it("saves in batches that each hold the main process briefly", async () => {
    const more = path.join(temp.folder, "More");
    for (let i = 0; i < FILES; i++) writeAudio(more, `Album ${Math.floor(i / 50)}/${i}.flac`, Buffer.alloc(512, i % 13));
    const store = library.store;
    // Time the saving step alone, by wrapping the store's transaction.
    const original = store.changeWithoutHistory.bind(store);
    const batches: number[] = [];
    store.changeWithoutHistory = <T>(fn: () => T): T => {
      const start = performance.now();
      try {
        return original(fn);
      } finally {
        batches.push(performance.now() - start);
      }
    };
    try {
      await importAudio(store, { paths: [more] });
    } finally {
      store.changeWithoutHistory = original;
    }
    const savingMs = batches.reduce((a, b) => a + b, 0);
    console.info(`[import perf] saving ${FILES} tracks: ${Math.round(savingMs)} ms in ${batches.length} batches (max ${Math.round(Math.max(...batches))} ms)`);
    expect(batches).toHaveLength(FILES / 500);
    expect(savingMs).toBeLessThan(2_000);
    expect(Math.max(...batches)).toBeLessThan(200);
  }, 60_000);
});
