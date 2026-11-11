import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MediaAccess } from "./mediaAccess";
import { MediaCache, PrepareAnswer } from "./mediaCache";
import { FakeConverter } from "./testing/fakeConverter";

let root: string;
let library: string;
let cacheFolder: string;
let converter: FakeConverter;

const url = (name: string) => pathToFileURL(path.join(library, name)).href;
const write = (name: string, content: string) => fs.writeFileSync(path.join(library, name), content);
function cache(options: { capBytes?: number } = {}) {
  return new MediaCache({
    folder: cacheFolder,
    access: new MediaAccess({ libraryFolders: () => [library], windowsPaths: false }),
    converter,
    capBytes: options.capBytes,
    windowsPaths: false,
    log: () => undefined,
  });
}
function played(answer: PrepareAnswer): string {
  if (!("url" in answer)) throw new Error(`Expected an address, got: ${answer.error}`);
  return fileURLToPath(answer.url);
}
const cacheFiles = () => (fs.existsSync(cacheFolder) ? fs.readdirSync(cacheFolder).filter((f) => f !== "index.json").sort() : []);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "media-cache-")));
  library = path.join(root, "Library");
  cacheFolder = path.join(root, "UserData", "media-cache");
  fs.mkdirSync(library, { recursive: true });
  write("tavern.flac", "flac bytes");
  write("old.wma", "wma lossy");
  write("pristine.wma", "wma lossless");
  write("studio.aiff", "aiff bytes");
  converter = new FakeConverter({ losslessInputs: ["pristine.wma"] });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MediaCache (BUG-10): files the player cannot play are converted once", () => {
  it("plays a format the player knows from where it is, without copying it", async () => {
    const answer = await cache().prepare(url("tavern.flac"), { keepLocal: false });
    expect(played(answer)).toBe(path.join(library, "tavern.flac"));
    expect(converter.conversions).toHaveLength(0);
    expect(cacheFiles()).toEqual([]);
  });

  it("converts WMA Lossless to FLAC in Lyre's cache folder, once", async () => {
    const c = cache();
    const first = played(await c.prepare(url("pristine.wma"), { keepLocal: false }));
    expect(path.dirname(first)).toBe(cacheFolder);
    expect(first).toMatch(/\.flac$/);
    expect(fs.readFileSync(first, "utf8")).toBe("flac from pristine.wma");
    const again = played(await c.prepare(url("pristine.wma"), { keepLocal: false }));
    expect(again).toBe(first);
    expect(converter.conversions).toHaveLength(1);
  });

  it("converts lossy WMA to Opus, and formats that are always lossless to FLAC without checking", async () => {
    const c = cache();
    expect(played(await c.prepare(url("old.wma"), { keepLocal: false }))).toMatch(/\.ogg$/);
    expect(played(await c.prepare(url("studio.aiff"), { keepLocal: false }))).toMatch(/\.flac$/);
    expect(converter.probes.map((p) => path.basename(p))).toEqual(["old.wma"]);
    expect(converter.conversions.map((j) => j.target)).toEqual(["opus", "flac"]);
  });

  it("converts once when asked twice at the same time, and one file at a time", async () => {
    const c = cache();
    const answers = await Promise.all([
      c.prepare(url("old.wma"), { keepLocal: false }),
      c.prepare(url("old.wma"), { keepLocal: false }),
      c.prepare(url("pristine.wma"), { keepLocal: false }),
    ]);
    expect(played(answers[0])).toBe(played(answers[1]));
    expect(converter.conversions).toHaveLength(2);
    expect(converter.mostAtOnce).toBe(1);
  });

  it("remembers conversions across restarts", async () => {
    const first = played(await cache().prepare(url("old.wma"), { keepLocal: false }));
    const later = played(await cache().prepare(url("old.wma"), { keepLocal: false }));
    expect(later).toBe(first);
    expect(converter.conversions).toHaveLength(1);
  });

  it("converts again when the file changes, and drops the old copy when it tidies up", async () => {
    const c = cache();
    const before = played(await c.prepare(url("old.wma"), { keepLocal: false }));
    write("old.wma", "wma lossy, re-ripped");
    const after = played(await c.prepare(url("old.wma"), { keepLocal: false }));
    expect(after).not.toBe(before);
    expect(await c.sweep()).toBe(1);
    expect(fs.existsSync(before)).toBe(false);
    expect(fs.existsSync(after)).toBe(true);
  });

  it("removes a converted copy once its source is gone, and partial or unknown files of its own", async () => {
    const c = cache();
    const copy = played(await c.prepare(url("old.wma"), { keepLocal: false }));
    fs.rmSync(path.join(library, "old.wma"));
    fs.writeFileSync(path.join(cacheFolder, `${"a".repeat(40)}.flac.part`), "left from a crash");
    fs.writeFileSync(path.join(cacheFolder, `${"b".repeat(40)}.ogg`), "not in the index");
    expect(await c.sweep()).toBe(3);
    expect(fs.existsSync(copy)).toBe(false);
    expect(cacheFiles()).toEqual([]);
  });

  it("never deletes or writes outside its own folder, even with a damaged index", async () => {
    const c = cache();
    await c.prepare(url("old.wma"), { keepLocal: false });
    const precious = path.join(root, "precious.txt");
    fs.writeFileSync(precious, "keep me");
    const indexFile = path.join(cacheFolder, "index.json");
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    for (const entry of Object.values(index.entries) as { file: string }[]) entry.file = "../precious.txt";
    fs.writeFileSync(indexFile, JSON.stringify(index));
    const restarted = cache();
    await restarted.sweep();
    expect(fs.readFileSync(precious, "utf8")).toBe("keep me");
    expect(path.dirname(played(await restarted.prepare(url("old.wma"), { keepLocal: false })))).toBe(cacheFolder);
  });

  it("reports a failed conversion in plain words, leaves no partial file and tries again next time", async () => {
    converter.failing.add("old.wma");
    const c = cache();
    expect(await c.prepare(url("old.wma"), { keepLocal: false })).toEqual({ error: "Could not convert old.wma." });
    expect(cacheFiles()).toEqual([]);
    converter.failing.clear();
    expect(played(await c.prepare(url("old.wma"), { keepLocal: false }))).toMatch(/\.ogg$/);
  });

  it("passes on a refusal from the library rules without touching the file", async () => {
    const elsewhere = path.join(root, "elsewhere.wma");
    fs.writeFileSync(elsewhere, "x");
    expect(await cache().prepare(pathToFileURL(elsewhere).href, { keepLocal: false })).toEqual({
      error: "Lyre only plays files from your library folders.",
    });
    expect(converter.probes).toHaveLength(0);
  });
});

describe("MediaCache (PLY-11): copies of big tracks on this computer's disk", () => {
  it("copies in the background when asked and plays the original meanwhile", async () => {
    const c = cache();
    const first = played(await c.prepare(url("tavern.flac"), { keepLocal: true }));
    expect(first).toBe(path.join(library, "tavern.flac"));
    await c.idle();
    const later = played(await c.prepare(url("tavern.flac"), { keepLocal: true }));
    expect(path.dirname(later)).toBe(cacheFolder);
    expect(fs.readFileSync(later, "utf8")).toBe("flac bytes");
    // Without keepLocal the original is played, so nothing changes for small tracks.
    expect(played(await c.prepare(url("tavern.flac"), { keepLocal: false }))).toBe(path.join(library, "tavern.flac"));
  });

  it("stays under its disk limit, dropping what was used longest ago", async () => {
    write("a.flac", "x".repeat(40));
    write("b.flac", "y".repeat(40));
    write("c.flac", "z".repeat(40));
    const c = cache({ capBytes: 100 });
    for (const name of ["a.flac", "b.flac"]) {
      await c.prepare(url(name), { keepLocal: true });
      await c.idle();
    }
    await c.prepare(url("a.flac"), { keepLocal: true }); // a is used again
    await c.prepare(url("c.flac"), { keepLocal: true });
    await c.idle();
    expect(cacheFiles()).toHaveLength(2);
    expect(path.dirname(played(await c.prepare(url("a.flac"), { keepLocal: true })))).toBe(cacheFolder);
    expect(path.dirname(played(await c.prepare(url("b.flac"), { keepLocal: true })))).toBe(library);
    await c.idle();
  });

  it("clear() empties the folder", async () => {
    const c = cache();
    await c.prepare(url("old.wma"), { keepLocal: false });
    await c.clear();
    expect(cacheFiles()).toEqual([]);
  });
});

describe("MediaCache close (security review 3)", () => {
  it("stops a conversion under way, removes its part file, and resolves when it has stopped", async () => {
    let started: () => void;
    const begun = new Promise<void>((resolve) => (started = resolve));
    const slow = {
      isLossless: async () => false,
      convert: (job: { output: string; signal: AbortSignal }) =>
        new Promise<void>((resolve, reject) => {
          fs.writeFileSync(job.output, "half of a long conversion");
          started();
          job.signal.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
    };
    const c = new MediaCache({ folder: cacheFolder, access: new MediaAccess({ libraryFolders: () => [library], windowsPaths: false }), converter: slow, windowsPaths: false, log: () => undefined });
    const answer = c.prepare(url("old.wma"), { keepLocal: false });
    await begun;
    expect(cacheFiles().some((f) => f.endsWith(".part"))).toBe(true);
    await c.close();
    expect(await answer).toEqual({ error: "Could not convert old.wma." });
    expect(cacheFiles().filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("starts nothing new once closed", async () => {
    const c = cache();
    await c.close();
    expect(await c.prepare(url("old.wma"), { keepLocal: false })).toMatchObject({ error: expect.any(String) });
    expect(converter.conversions).toHaveLength(0);
  });
});
