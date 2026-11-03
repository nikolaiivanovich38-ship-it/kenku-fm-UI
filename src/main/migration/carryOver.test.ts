import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { carryOverLegacyData, describeCarryOver, MARKER_FILE_NAME } from "./carryOver";

let root: string;
let source: string;
let dest: string;

function write(file: string, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

/** A small stand-in for Kenku FM's data folder. */
function makeOldKenkuFolder() {
  write(path.join(source, "Local Storage", "leveldb", "000003.log"), "persist:root");
  write(path.join(source, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001");
  write(path.join(source, "Local Storage", "leveldb", "LOCK"), "");
  write(path.join(source, "Session Storage", "000001.log"), "session");
  write(path.join(source, "Session Storage", "LOCK"), "");
  write(path.join(source, "config.json"), '{"bounds":{"x":1}}');
  write(path.join(source, "Cache", "data_0"), "not copied");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "carry-over-"));
  source = path.join(root, "Kenku FM");
  dest = path.join(root, "cue-desk");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("carryOverLegacyData (FND-1 data carry-over)", () => {
  it("copies Local Storage, Session Storage and config.json, including nested folders", () => {
    makeOldKenkuFolder();
    const result = carryOverLegacyData(source, dest);

    expect(result.status).toBe("copied");
    expect(result.copiedItems).toEqual(["Local Storage", "Session Storage", "config.json"]);
    expect(result.fileCount).toBe(4);
    expect(read(path.join(dest, "Local Storage", "leveldb", "000003.log"))).toBe("persist:root");
    expect(read(path.join(dest, "Local Storage", "leveldb", "CURRENT"))).toBe("MANIFEST-000001");
    expect(read(path.join(dest, "Session Storage", "000001.log"))).toBe("session");
    expect(read(path.join(dest, "config.json"))).toBe('{"bounds":{"x":1}}');
    expect(fs.existsSync(path.join(dest, "Cache"))).toBe(false);
  });

  it("skips LevelDB LOCK files", () => {
    makeOldKenkuFolder();
    carryOverLegacyData(source, dest);
    expect(fs.existsSync(path.join(dest, "Local Storage", "leveldb", "LOCK"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "Session Storage", "LOCK"))).toBe(false);
  });

  it("runs once: a second start does nothing, even if the old data changes", () => {
    makeOldKenkuFolder();
    carryOverLegacyData(source, dest);
    write(path.join(source, "Local Storage", "leveldb", "000003.log"), "changed later");
    fs.rmSync(path.join(dest, "Local Storage"), { recursive: true });

    const second = carryOverLegacyData(source, dest);

    expect(second.status).toBe("already-done");
    expect(fs.existsSync(path.join(dest, "Local Storage"))).toBe(false);
  });

  it("writes a marker file recording what was copied", () => {
    makeOldKenkuFolder();
    carryOverLegacyData(source, dest);
    const marker = JSON.parse(read(path.join(dest, MARKER_FILE_NAME)));
    expect(marker.status).toBe("copied");
    expect(marker.copiedItems).toContain("Local Storage");
    expect(marker.decidedAt).toEqual(expect.any(String));
  });

  it("does not copy anything when this app already has its own library", () => {
    makeOldKenkuFolder();
    write(path.join(dest, "Local Storage", "leveldb", "000003.log"), "our own library");

    const result = carryOverLegacyData(source, dest);

    expect(result.status).toBe("destination-has-data");
    expect(read(path.join(dest, "Local Storage", "leveldb", "000003.log"))).toBe("our own library");
    expect(fs.existsSync(path.join(dest, "config.json"))).toBe(false);
  });

  it("never overwrites an existing destination file", () => {
    makeOldKenkuFolder();
    write(path.join(dest, "config.json"), '{"bounds":"ours"}');

    const result = carryOverLegacyData(source, dest);

    expect(result.status).toBe("copied");
    expect(read(path.join(dest, "config.json"))).toBe('{"bounds":"ours"}');
    expect(result.skippedItems).toContainEqual({
      item: "config.json",
      reason: "already exists here; left unchanged",
    });
  });

  it("is a no-op when there is no old Kenku FM folder", () => {
    const result = carryOverLegacyData(source, dest);
    expect(result.status).toBe("no-old-data");
    expect(result.copiedItems).toEqual([]);
    expect(fs.readdirSync(dest)).toEqual([MARKER_FILE_NAME]);
  });

  it("copies only what exists (old folder without Session Storage)", () => {
    write(path.join(source, "Local Storage", "leveldb", "CURRENT"), "M");
    const result = carryOverLegacyData(source, dest);
    expect(result.copiedItems).toEqual(["Local Storage"]);
    expect(result.skippedItems.map((skip) => skip.item)).toEqual(["Session Storage", "config.json"]);
  });

  it("never modifies or deletes the old folder", () => {
    makeOldKenkuFolder();
    const listing = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? listing(path.join(dir, entry.name)).map((child) => `${entry.name}/${child}`)
            : [`${entry.name}=${read(path.join(dir, entry.name))}`],
        )
        .sort();
    const before = listing(source);
    carryOverLegacyData(source, dest);
    expect(listing(source)).toEqual(before);
  });

  it("handles a read error gracefully: reports it and leaves no half-copied database", () => {
    makeOldKenkuFolder();
    const realCopy = fs.copyFileSync;
    vi.spyOn(fs, "copyFileSync").mockImplementation((from, to, mode) => {
      if (String(from).endsWith("CURRENT")) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return realCopy(from, to, mode);
    });

    const result = carryOverLegacyData(source, dest);

    expect(result.status).toBe("failed");
    expect(result.errors).toEqual([{ item: "Local Storage", message: "EBUSY: resource busy or locked" }]);
    expect(fs.existsSync(path.join(dest, "Local Storage"))).toBe(false);
    expect(result.copiedItems).toEqual(["Session Storage", "config.json"]);
    expect(fs.readdirSync(dest).some((name) => name.startsWith(".data-carry-over"))).toBe(false);
    expect(describeCarryOver(result)).toContain("could not be copied");
  });

  it("never throws, even when the destination cannot be created", () => {
    makeOldKenkuFolder();
    write(dest, "a file where the folder should be");
    const result = carryOverLegacyData(source, dest);
    expect(result.status).toBe("failed");
    expect(result.errors).toHaveLength(1);
  });

  it("does not follow symbolic links out of the old folder", () => {
    write(path.join(source, "Local Storage", "leveldb", "CURRENT"), "M");
    write(path.join(root, "outside", "secret.txt"), "secret");
    try {
      fs.symlinkSync(path.join(root, "outside"), path.join(source, "Local Storage", "link"), "dir");
    } catch {
      return; // Symlinks need extra rights on some Windows machines; nothing to test there.
    }
    carryOverLegacyData(source, dest);
    expect(fs.existsSync(path.join(dest, "Local Storage", "link"))).toBe(false);
  });

  it("describes each outcome in plain language", () => {
    makeOldKenkuFolder();
    expect(describeCarryOver(carryOverLegacyData(source, dest))).toMatch(
      /^Your Kenku FM library was copied into this app .*Kenku FM itself was not changed\.$/,
    );
    expect(describeCarryOver(carryOverLegacyData(source, dest))).toContain("already happened");
  });
});
