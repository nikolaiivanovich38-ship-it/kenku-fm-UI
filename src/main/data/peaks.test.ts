/**
 * Loudness peaks per track (w3-media): a table of their own (schema step 2, one BLOB per track, deleted with the
 * track, kept out of undo), the stored levels tied to the file they came from, and PeakJobs, which works them out
 * one track at a time after an import and on demand, without holding the library's process.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wavBytes, writeFile } from "../media/testing/wavFiles";
import { importAudio } from "./import";
import { openLibrary, type Library } from "./library";
import { PeakJobs, fileThereWithin, type PeakReader } from "./peaks";
import { PEAK_POINTS, savePeaks, trackPeaks, type PeakSource } from "./repo/peaks";
import { deleteTracks } from "./repo/tracks";
import { saveLoudness, trackLoudness, tracksNeedingLoudness } from "./repo/loudness";
import { makeTempFolder } from "./test/helpers";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((fn) => fn());
});

/** A library in a temporary folder with `count` real WAV files imported; returns their track ids in order. */
async function libraryWith(count: number): Promise<{ library: Library; ids: string[]; files: string[]; folder: string }> {
  const temp = makeTempFolder("lyre-peaks-");
  const library = openLibrary({ folder: path.join(temp.folder, "library") });
  cleanups.push(temp.cleanup, () => library.close());
  const files = Array.from({ length: count }, (_, i) => writeFile(path.join(temp.folder, "sounds"), `tone ${i + 1}.wav`, wavBytes({ seconds: 0.5 })));
  const result = count ? await importAudio(library.store, { paths: files }) : { trackIds: [] as string[] };
  return { library, ids: result.trackIds, files, folder: temp.folder };
}

/** A reader the test controls: each read waits until the test answers it. */
function controlledReader() {
  const pending: { file: string; signal: AbortSignal; resolve: (levels: Uint8Array) => void; reject: (error: Error) => void }[] = [];
  const reader: PeakReader = {
    read: (file, signal) => new Promise<Uint8Array>((resolve, reject) => pending.push({ file, signal, resolve, reject })),
  };
  return { reader, pending };
}

const levels = (n = PEAK_POINTS, value = 128) => new Uint8Array(n).fill(value);
const sourceOf = (library: Library, id: string): PeakSource => {
  const state = trackPeaks(library.store, id);
  if (state.state !== "needed") throw new Error(`expected peaks to be needed, got ${state.state}`);
  return state.source;
};

describe("stored peaks (schema step 2)", () => {
  it("are needed for a new track, ready once saved, and kept as bytes of a BLOB in a table of their own", async () => {
    const { library, ids, files } = await libraryWith(1);
    const source = sourceOf(library, ids[0]);
    expect(source).toMatchObject({ trackId: ids[0], file: files[0] });
    expect(savePeaks(library.store, source, levels(1000, 200))).toBe(true);
    const state = trackPeaks(library.store, ids[0]);
    expect(state.state).toBe("ready");
    expect(state.state === "ready" && [...state.levels.slice(0, 3)]).toEqual([200, 200, 200]);
    expect(library.store.get("SELECT typeof(levels) AS type, length(levels) AS bytes FROM track_peaks")).toEqual({ type: "blob", bytes: 1000 });
  });

  it("go with their track when it is deleted, and undo brings the track back without them (they are worked out again)", async () => {
    const { library, ids } = await libraryWith(2);
    savePeaks(library.store, sourceOf(library, ids[0]), levels());
    savePeaks(library.store, sourceOf(library, ids[1]), levels());
    await deleteTracks(library.store, [ids[0]]);
    expect(library.store.all("SELECT track_id FROM track_peaks")).toEqual([{ track_id: ids[1] }]);
    await library.history.undo();
    expect(trackPeaks(library.store, ids[0]).state).toBe("needed");
    expect(trackPeaks(library.store, ids[1]).state).toBe("ready");
  });

  it("are not an undo step, and saving them keeps the undo history", async () => {
    const { library, ids } = await libraryWith(1);
    library.store.change("Rename", () => library.store.run("UPDATE tracks SET title = 'Bells' WHERE id = ?", ids[0]));
    savePeaks(library.store, sourceOf(library, ids[0]), levels());
    expect(library.history.state()).toMatchObject({ canUndo: true, undoLabel: "Rename" });
  });

  it("belong to the file they came from: when the track's file changes they are needed again", async () => {
    const { library, ids } = await libraryWith(1);
    savePeaks(library.store, sourceOf(library, ids[0]), levels());
    library.store.changeWithoutHistory(() => library.store.run("UPDATE tracks SET file_size = file_size + 1 WHERE id = ?", ids[0]));
    expect(trackPeaks(library.store, ids[0]).state).toBe("needed");
  });

  it("are not saved for a file that changed while they were worked out, nor for a track deleted meanwhile", async () => {
    const { library, ids } = await libraryWith(2);
    const changed = sourceOf(library, ids[0]);
    library.store.changeWithoutHistory(() => library.store.run("UPDATE tracks SET file_mtime_ms = 1 WHERE id = ?", ids[0]));
    expect(savePeaks(library.store, changed, levels())).toBe(false);
    const deleted = sourceOf(library, ids[1]);
    await deleteTracks(library.store, [ids[1]]);
    expect(savePeaks(library.store, deleted, levels())).toBe(false);
    expect(library.store.all("SELECT * FROM track_peaks")).toEqual([]);
  });

  it("remember a file that could not be read, so it is not tried again until it changes", async () => {
    const { library, ids } = await libraryWith(1);
    savePeaks(library.store, sourceOf(library, ids[0]), null);
    expect(trackPeaks(library.store, ids[0]).state).toBe("unreadable");
  });

  it("are none for an unknown track or a web address", async () => {
    const { library } = await libraryWith(0);
    expect(trackPeaks(library.store, "nope").state).toBe("none");
    library.store.changeWithoutHistory(() =>
      library.store.run("INSERT INTO tracks (id, url, file_name, created_at, updated_at) VALUES ('web', 'https://example.com/a.mp3', 'a.mp3', 1, 1)"),
    );
    expect(trackPeaks(library.store, "web").state).toBe("none");
  });

  it("refuse more than 4,096 levels or an empty set", async () => {
    const { library, ids } = await libraryWith(1);
    expect(() => savePeaks(library.store, sourceOf(library, ids[0]), new Uint8Array(4097))).toThrow();
    expect(() => savePeaks(library.store, sourceOf(library, ids[0]), new Uint8Array(0))).toThrow();
  });
});

describe("PeakJobs", () => {
  it("works out one track at a time: on demand first, then the background ones, and says which are ready", async () => {
    const { library, ids, files } = await libraryWith(3);
    const { reader, pending } = controlledReader();
    const ready: string[][] = [];
    const jobs = new PeakJobs(library.store, reader, { onReady: (trackIds) => ready.push(trackIds), notifyEveryMs: 0 });
    cleanups.push(() => jobs.close());
    jobs.inBackground([ids[0], ids[1]]);
    jobs.soon(ids[2]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // The first background read had started; the one asked for on demand comes next, before the other.
    pending[0].resolve(levels());
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].file).toBe(files[2]);
    pending[1].resolve(levels());
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending[2].resolve(levels());
    await vi.waitFor(() => expect(ready.flat()).toEqual([ids[0], ids[2], ids[1]]));
    expect(ids.map((id) => trackPeaks(library.store, id).state)).toEqual(["ready", "ready", "ready"]);
  });

  it("gathers the ready tracks into one notice per interval, so a large import does not flood the screens", async () => {
    const { library, ids } = await libraryWith(3);
    const reader: PeakReader = { read: async () => levels() };
    const ready: string[][] = [];
    const jobs = new PeakJobs(library.store, reader, { onReady: (trackIds) => ready.push(trackIds), notifyEveryMs: 60 });
    cleanups.push(() => jobs.close());
    jobs.inBackground(ids);
    await vi.waitFor(() => expect(ready.flat()).toHaveLength(3));
    expect(ready.length).toBeLessThanOrEqual(2);
  });

  it("skips tracks that are ready or unreadable, and asks nothing twice", async () => {
    const { library, ids } = await libraryWith(2);
    savePeaks(library.store, sourceOf(library, ids[0]), levels());
    savePeaks(library.store, sourceOf(library, ids[1]), null);
    const read = vi.fn(async () => levels());
    const jobs = new PeakJobs(library.store, { read }, { onReady: () => undefined, notifyEveryMs: 0 });
    cleanups.push(() => jobs.close());
    jobs.inBackground(ids);
    jobs.soon(ids[0]);
    await jobs.idle();
    expect(read).not.toHaveBeenCalled();
  });

  it("remembers a file that could not be read, and leaves a file that is not there now (an unplugged drive) for later", async () => {
    const { library, ids, files } = await libraryWith(2);
    fs.rmSync(files[1]);
    const reader: PeakReader = { read: async () => Promise.reject(new Error("Invalid data found when processing input")) };
    const logged: string[] = [];
    const jobs = new PeakJobs(library.store, reader, { onReady: () => undefined, notifyEveryMs: 0, log: (m) => logged.push(m) });
    cleanups.push(() => jobs.close());
    jobs.inBackground(ids);
    await jobs.idle();
    expect(trackPeaks(library.store, ids[0]).state).toBe("unreadable");
    expect(trackPeaks(library.store, ids[1]).state).toBe("needed");
    expect(logged.join("\n")).toContain("tone 1.wav");
  });

  it("waits while the library saves bulk work, then saves", async () => {
    const { library, ids } = await libraryWith(1);
    let release: () => void;
    const busy = library.store.exclusive("Tag 5,000 tracks", () => new Promise<void>((resolve) => (release = resolve)));
    const ready: string[][] = [];
    const jobs = new PeakJobs(library.store, { read: async () => levels() }, { onReady: (t) => ready.push(t), notifyEveryMs: 0, busyRetryMs: 5 });
    cleanups.push(() => jobs.close());
    jobs.soon(ids[0]);
    await new Promise((r) => setTimeout(r, 30));
    expect(trackPeaks(library.store, ids[0]).state).toBe("needed");
    release();
    await busy;
    await vi.waitFor(() => expect(ready.flat()).toEqual([ids[0]]));
  });

  it("stops the running read when closed, and saves nothing more", async () => {
    const { library, ids } = await libraryWith(2);
    const { reader, pending } = controlledReader();
    const jobs = new PeakJobs(library.store, reader, { onReady: () => undefined, notifyEveryMs: 0 });
    jobs.inBackground(ids);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    jobs.close();
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve(levels());
    await new Promise((r) => setTimeout(r, 10));
    expect(pending).toHaveLength(1);
    expect(library.store.all("SELECT * FROM track_peaks")).toEqual([]);
  });
});

describe("PeakJobs never holds the library's process on a slow file check (security review 9)", () => {
  it("uses no synchronous file-system call (a share that does not answer would block every library call)", () => {
    const source = fs.readFileSync(path.join(__dirname, "peaks.ts"), "utf8");
    expect(source).not.toMatch(/\b\w+Sync\(/);
  });

  it("gives up on a file check that does not answer in time and goes on with the next track, leaving that one for later", async () => {
    const { library, ids, files } = await libraryWith(2);
    const read = vi.fn(async () => levels());
    const exists = vi.fn((file: string) => (file === files[0] ? new Promise<boolean>(() => undefined) : Promise.resolve(true)));
    const jobs = new PeakJobs(library.store, { read }, { onReady: () => undefined, notifyEveryMs: 0, fileCheckMs: 50, exists });
    cleanups.push(() => jobs.close());
    jobs.inBackground(ids);
    await vi.waitFor(() => expect(trackPeaks(library.store, ids[1]).state).toBe("ready"), { timeout: 1000 });
    expect(trackPeaks(library.store, ids[0]).state).toBe("needed");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("checks files without blocking by default", async () => {
    expect(await fileThereWithin(path.join(os.tmpdir(), "no-such-file-lyre"), 1000)).toBe(false);
    expect(await fileThereWithin(__filename, 1000)).toBe(true);
  });
});

describe("PeakJobs measuring loudness too (DAT-15)", () => {
  const loudness = { lufs: -22.6, truePeakDb: -8 };

  it("measures each track's loudness with its peaks, in the same background job, and says when it is ready", async () => {
    const { library, ids, files } = await libraryWith(2);
    const measure = vi.fn(async () => loudness);
    const ready: string[][] = [];
    const jobs = new PeakJobs(library.store, { read: async () => levels() }, { onReady: (trackIds) => ready.push(trackIds), notifyEveryMs: 0, loudness: { measure } });
    cleanups.push(() => jobs.close());
    jobs.inBackground(ids);
    await vi.waitFor(() => expect(ready.flat()).toEqual(ids));
    expect(ids.map((id) => trackLoudness(library.store, id))).toEqual([
      { state: "ready", loudness },
      { state: "ready", loudness },
    ]);
    expect(measure.mock.calls.map((call) => (call as unknown[])[0])).toEqual(files);
  });

  it("measures a track whose peaks are ready but whose loudness is not (a library from before version 4)", async () => {
    const { library, ids } = await libraryWith(1);
    savePeaks(library.store, sourceOf(library, ids[0]), levels());
    const read = vi.fn(async () => levels());
    const jobs = new PeakJobs(library.store, { read }, { onReady: () => undefined, notifyEveryMs: 0, loudness: { measure: async () => loudness } });
    cleanups.push(() => jobs.close());
    jobs.inBackground(tracksNeedingLoudness(library.store));
    await vi.waitFor(() => expect(trackLoudness(library.store, ids[0]).state).toBe("ready"));
    expect(read).not.toHaveBeenCalled();
    expect(tracksNeedingLoudness(library.store)).toEqual([]);
  });

  it("keeps a file it cannot measure as not measurable, and does not try it again until it changes", async () => {
    const { library, ids } = await libraryWith(1);
    const measure = vi.fn(async () => {
      throw new Error("Could not measure how loud tone 1.wav is");
    });
    const log = vi.fn();
    const jobs = new PeakJobs(library.store, { read: async () => levels() }, { onReady: () => undefined, notifyEveryMs: 0, loudness: { measure }, log });
    cleanups.push(() => jobs.close());
    jobs.soon(ids[0]);
    await vi.waitFor(() => expect(trackLoudness(library.store, ids[0]).state).toBe("unmeasurable"));
    jobs.soon(ids[0]);
    await jobs.idle();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/measure how loud/), expect.any(Error));
  });

  it("keeps silence as not measurable without counting it a failure", async () => {
    const { library, ids } = await libraryWith(1);
    const jobs = new PeakJobs(library.store, { read: async () => levels() }, { onReady: () => undefined, notifyEveryMs: 0, loudness: { measure: async () => null } });
    cleanups.push(() => jobs.close());
    jobs.soon(ids[0]);
    await vi.waitFor(() => expect(trackLoudness(library.store, ids[0]).state).toBe("unmeasurable"));
  });

  it("lists the tracks that need measuring: files only, not measured from their current file", async () => {
    const { library, ids } = await libraryWith(3);
    const state = trackLoudness(library.store, ids[1]);
    if (state.state === "needed") saveLoudness(library.store, state.source, loudness);
    expect(tracksNeedingLoudness(library.store)).toEqual([ids[0], ids[2]]);
  });
});
