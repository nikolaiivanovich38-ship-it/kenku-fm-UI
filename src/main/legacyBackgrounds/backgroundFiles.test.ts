import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { createPackage } from "@electron/asar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_BACKGROUND_BYTES,
  MAX_TOTAL_BACKGROUND_BYTES,
  type BackgroundImportResult,
  backgroundUrls,
  copyMissingBackgrounds,
  describeBackgroundImport,
  importKenkuBackgrounds,
  listBackgroundFiles,
  waitAtMost,
} from "./backgroundFiles";

let root: string;
let source: string;
let dest: string;

function write(file: string, content: string | Buffer = "picture") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kenku-backgrounds-"));
  source = path.join(root, "renderer");
  dest = path.join(root, "cue-desk", "backgrounds");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("copyMissingBackgrounds", () => {
  it("copies each picture under its name, creating the folder", async () => {
    write(path.join(source, "aaa.jpg"), "autumn");
    write(path.join(source, "bbb.png"), "tavern");
    const result = await copyMissingBackgrounds(
      source,
      [
        { name: "autumn", file: "aaa.jpg" },
        { name: "tavern", file: "bbb.png" },
      ],
      dest,
    );
    expect(result).toEqual({ copied: ["autumn", "tavern"], alreadyPresent: [], skipped: [] });
    expect(fs.readFileSync(path.join(dest, "autumn.jpg"), "utf8")).toBe("autumn");
    expect(fs.readFileSync(path.join(dest, "tavern.png"), "utf8")).toBe("tavern");
    expect(fs.readdirSync(dest).sort()).toEqual(["autumn.jpg", "tavern.png"]);
  });

  it("never overwrites a picture that is already there, whatever its extension", async () => {
    write(path.join(source, "aaa.jpg"), "from Kenku FM");
    write(path.join(dest, "Tavern.png"), "mine");
    write(path.join(dest, "autumn.jpg"), "earlier copy");
    const result = await copyMissingBackgrounds(
      source,
      [
        { name: "tavern", file: "aaa.jpg" },
        { name: "autumn", file: "aaa.jpg" },
      ],
      dest,
    );
    expect(result).toEqual({ copied: [], alreadyPresent: ["tavern", "autumn"], skipped: [] });
    expect(fs.readFileSync(path.join(dest, "Tavern.png"), "utf8")).toBe("mine");
    expect(fs.readFileSync(path.join(dest, "autumn.jpg"), "utf8")).toBe("earlier copy");
    expect(fs.existsSync(path.join(dest, "tavern.jpg"))).toBe(false);
  });

  it("never deletes anything in the folder", async () => {
    write(path.join(dest, "my own.webp"), "mine");
    write(path.join(dest, "notes.txt"), "x");
    await copyMissingBackgrounds(source, [], dest);
    expect(fs.readdirSync(dest).sort()).toEqual(["my own.webp", "notes.txt"]);
  });

  it("skips missing, empty, oversized and non-picture files and copies the rest", async () => {
    write(path.join(source, "ok.jpg"), "ok");
    write(path.join(source, "empty.jpg"), "");
    write(path.join(source, "huge.jpg"), Buffer.alloc(MAX_BACKGROUND_BYTES + 1));
    write(path.join(source, "folder.jpg", "inside"), "x");
    const result = await copyMissingBackgrounds(
      source,
      [
        { name: "gone", file: "gone.jpg" },
        { name: "empty", file: "empty.jpg" },
        { name: "huge", file: "huge.jpg" },
        { name: "folder", file: "folder.jpg" },
        { name: "script", file: "evil.exe" },
        { name: "../up", file: "ok.jpg" },
        { name: "ok", file: "ok.jpg" },
      ],
      dest,
    );
    expect(result.copied).toEqual(["ok"]);
    expect(result.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["gone", "not found"],
      ["empty", "empty file"],
      ["huge", "larger than 20 MB"],
      ["folder", "not a file"],
      ["script", "not allowed"],
      ["../up", "not allowed"],
    ]);
    expect(fs.readdirSync(dest)).toEqual(["ok.jpg"]);
    expect(MAX_BACKGROUND_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("copyMissingBackgrounds limits (0.1.1 review)", () => {
  it("stops copying once the total would pass the limit", async () => {
    const big = Buffer.alloc(MAX_BACKGROUND_BYTES, 1);
    write(path.join(source, "big.jpg"), big);
    const entries = Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, file: "big.jpg" }));
    const result = await copyMissingBackgrounds(source, entries, dest);
    expect(result.copied.length * MAX_BACKGROUND_BYTES).toBeLessThanOrEqual(MAX_TOTAL_BACKGROUND_BYTES);
    expect(result.skipped.some((s) => /total/.test(s.reason))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("does not follow a picture that is a link to another file", async () => {
    write(path.join(root, "secret.txt"), "private");
    fs.mkdirSync(source, { recursive: true });
    fs.symlinkSync(path.join(root, "secret.txt"), path.join(source, "link.jpg"));
    const result = await copyMissingBackgrounds(source, [{ name: "linked", file: "link.jpg" }], dest);
    expect(result.copied).toEqual([]);
    expect(fs.existsSync(path.join(dest, "linked.jpg"))).toBe(false);
  });
});

describe("listBackgroundFiles", () => {
  it("lists pictures by name, sorted, ignoring other files, hidden files and folders", async () => {
    write(path.join(dest, "tavern.jpg"));
    write(path.join(dest, "autumn.PNG"));
    write(path.join(dest, "notes.txt"));
    write(path.join(dest, ".sky.jpg.part"));
    write(path.join(dest, "folder.jpg", "x.jpg"));
    expect(await listBackgroundFiles(dest)).toEqual({
      autumn: path.join(dest, "autumn.PNG"),
      tavern: path.join(dest, "tavern.jpg"),
    });
  });

  it("keeps the first of two pictures with the same name", async () => {
    write(path.join(dest, "sky.jpg"));
    write(path.join(dest, "sky.png"));
    expect(Object.keys(await listBackgroundFiles(dest))).toEqual(["sky"]);
  });

  it("returns nothing when the folder does not exist", async () => {
    expect(await listBackgroundFiles(path.join(root, "missing"))).toEqual({});
  });
});

describe("listBackgroundFiles names (0.1.1 review)", () => {
  it("keeps pictures whose names are also object property names", async () => {
    write(path.join(dest, "constructor.jpg"));
    write(path.join(dest, "toString.png"));
    const pictures = await listBackgroundFiles(dest);
    expect(Object.keys(pictures).sort()).toEqual(["constructor", "toString"]);
  });
});

describe("backgroundUrls", () => {
  it("turns each picture into a file:// address the player can show", async () => {
    write(path.join(dest, "a picture.jpg"));
    const urls = await backgroundUrls(dest);
    expect(urls).toEqual({ "a picture": pathToFileURL(path.join(dest, "a picture.jpg")).href });
    expect(urls["a picture"]).toMatch(/^file:\/\/.*a%20picture\.jpg$/);
  });
});

/** A fake Kenku FM install under a fake LocalAppData folder. */
function makeKenkuInstall(localAppData: string, version: string, pictures: Record<string, string>) {
  const rendererDir = path.join(localAppData, "kenku-fm-win32-x64", `app-${version}`, "resources", "app", ".webpack", "renderer");
  let id = 100;
  const map: string[] = [];
  const modules: string[] = [];
  for (const [name, content] of Object.entries(pictures)) {
    id += 1;
    const file = `hash${id}.jpg`;
    write(path.join(rendererDir, file), content);
    map.push(`"./${name}.jpg":${id}`);
    modules.push(`,${id}:(e,t,r)=>{"use strict";e.exports=r.p+"${file}"}`);
  }
  write(path.join(rendererDir, "player_window", "index.js"), `var a={${map.join(",")}};${modules.join("")}`);
  return rendererDir;
}

describe("importKenkuBackgrounds", () => {
  it("copies the pictures from the newest install that has them", async () => {
    const lad = path.join(root, "Local");
    makeKenkuInstall(lad, "1.5.4", { autumn: "old autumn" });
    const newest = makeKenkuInstall(lad, "1.5.5", { autumn: "new autumn", tavern: "tavern" });
    // A newer folder without the bundle (an update in progress) is passed over.
    fs.mkdirSync(path.join(lad, "kenku-fm-win32-x64", "app-1.6.0", "resources", "app"), { recursive: true });

    const result = await importKenkuBackgrounds(lad, dest);
    expect(result).toEqual({
      status: "done",
      source: newest,
      found: 2,
      copied: ["autumn", "tavern"],
      alreadyPresent: [],
      skipped: [],
    });
    expect(fs.readFileSync(path.join(dest, "autumn.jpg"), "utf8")).toBe("new autumn");

    // Next start: nothing to do, nothing changed.
    const again = await importKenkuBackgrounds(lad, dest);
    expect(again).toMatchObject({ status: "done", copied: [], alreadyPresent: ["autumn", "tavern"] });
  });

  it("reads an install packed in app.asar without keeping the archive open (Windows e2e, 0.1.1)", async () => {
    const lad = path.join(root, "Local");
    const rendererDir = makeKenkuInstall(lad, "1.5.5", { tavern: "tavern picture" });
    const appDir = path.dirname(path.dirname(rendererDir));
    const archive = path.join(path.dirname(appDir), "app.asar");
    await createPackage(appDir, archive);
    fs.rmSync(appDir, { recursive: true });

    let opened = 0;
    let closed = 0;
    const countingFs = {
      promises: {
        open: async (file: string, flags: string) => {
          const handle = await fs.promises.open(file, flags);
          opened += 1;
          return {
            read: (b: Buffer, o: number, l: number, p: number) => handle.read(b, o, l, p),
            close: async () => {
              closed += 1;
              await handle.close();
            },
          };
        },
      },
    };
    const result = await importKenkuBackgrounds(lad, dest, { rawFs: countingFs });
    expect(result).toMatchObject({ status: "done", copied: ["tavern"] });
    expect(fs.readFileSync(path.join(dest, "tavern.jpg"), "utf8")).toBe("tavern picture");
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
  });

  it("reports when there is no Kenku FM install or no folder to look in", async () => {
    expect(await importKenkuBackgrounds(path.join(root, "empty"), dest)).toEqual({ status: "no-install" });
    expect(await importKenkuBackgrounds(null, dest)).toEqual({ status: "not-looked" });
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("reports a failure instead of throwing", async () => {
    const lad = path.join(root, "Local");
    makeKenkuInstall(lad, "1.5.5", { autumn: "x" });
    // A file where the backgrounds folder should be.
    write(dest, "not a folder");
    const result = await importKenkuBackgrounds(lad, dest);
    expect(result.status).toBe("failed");
  });
});

describe("describeBackgroundImport", () => {
  const done = (over: Partial<Extract<BackgroundImportResult, { status: "done" }>>): BackgroundImportResult => ({
    status: "done",
    source: "C:\\kenku\\renderer",
    found: 23,
    copied: [],
    alreadyPresent: [],
    skipped: [],
    ...over,
  });

  it("says in one line what happened", () => {
    expect(describeBackgroundImport({ status: "not-looked" })).toBe(
      "Not looked for Kenku FM's background pictures (only on Windows).",
    );
    expect(describeBackgroundImport({ status: "no-install" })).toBe("No Kenku FM install found; no background pictures copied.");
    expect(describeBackgroundImport(done({ copied: Array(23).fill("x") }))).toBe(
      "Copied 23 of 23 background pictures from C:\\kenku\\renderer.",
    );
    expect(describeBackgroundImport(done({ alreadyPresent: Array(23).fill("x") }))).toBe(
      "All 23 background pictures from C:\\kenku\\renderer were already copied.",
    );
    expect(
      describeBackgroundImport(
        done({ copied: Array(21).fill("x"), alreadyPresent: ["y"], skipped: [{ name: "war", reason: "not found" }] }),
      ),
    ).toBe("Copied 21 of 23 background pictures from C:\\kenku\\renderer; 1 already there; skipped war (not found).");
    expect(describeBackgroundImport({ status: "failed", error: "EACCES" })).toBe(
      "Could not copy Kenku FM's background pictures: EACCES",
    );
  });
});

describe("waitAtMost", () => {
  it("resolves when the promise settles or the time runs out, never rejects", async () => {
    await expect(waitAtMost(Promise.resolve(1), 1000)).resolves.toBeUndefined();
    await expect(waitAtMost(Promise.reject(new Error("x")), 1000)).resolves.toBeUndefined();
    const start = Date.now();
    await waitAtMost(new Promise(() => undefined), 20);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
