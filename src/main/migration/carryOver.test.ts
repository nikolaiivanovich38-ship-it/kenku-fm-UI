import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appRunningMessage,
  carryOverEarlierData,
  CUE_DESK_ITEMS,
  describeCarryOver,
  isLockFileHeld,
  MARKER_FILE_NAME,
  type CarryOverOptions,
  type LockFileIo,
} from "./carryOver";

let root: string;
let source: string;
let cueDesk: string;
let dest: string;

/** Carry over from Kenku FM only, as the tests before Lyre did. */
function carryOverLegacyData(sourceDir: string, destDir: string, options?: CarryOverOptions) {
  return carryOverEarlierData([{ name: "Kenku FM", dir: sourceDir }], destDir, options);
}

/** Both earlier apps, newest first, as Lyre itself looks for them. */
function carryOverBoth(options?: CarryOverOptions) {
  return carryOverEarlierData(
    [
      { name: "Cue Desk", dir: cueDesk, items: CUE_DESK_ITEMS },
      { name: "Kenku FM", dir: source },
    ],
    dest,
    options,
  );
}

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
  cueDesk = path.join(root, "cue-desk");
  dest = path.join(root, "lyre");
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

  it("does not write the marker after a failure, so the next start tries again", () => {
    makeOldKenkuFolder();
    const realCopy = fs.copyFileSync;
    const copy = vi.spyOn(fs, "copyFileSync").mockImplementation((from, to, mode) => {
      if (String(from).endsWith("CURRENT")) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return realCopy(from, to, mode);
    });

    expect(carryOverLegacyData(source, dest).status).toBe("failed");
    expect(fs.existsSync(path.join(dest, MARKER_FILE_NAME))).toBe(false);

    copy.mockRestore();
    const retry = carryOverLegacyData(source, dest);

    expect(retry.status).toBe("copied");
    expect(retry.copiedItems).toEqual(["Local Storage"]);
    expect(read(path.join(dest, "Local Storage", "leveldb", "CURRENT"))).toBe("MANIFEST-000001");
    expect(JSON.parse(read(path.join(dest, MARKER_FILE_NAME))).status).toBe("copied");
  });

  it("waits while Kenku FM is running: copies nothing, writes no marker and says what to do", () => {
    makeOldKenkuFolder();
    const isLegacyAppRunning = vi.fn(() => true);

    const result = carryOverLegacyData(source, dest, { isLegacyAppRunning });

    expect(isLegacyAppRunning).toHaveBeenCalledWith(source);
    expect(result.status).toBe("legacy-app-running");
    expect(result.reason).toBe(
      "Kenku FM is still running. Close it and restart Lyre to bring your library across.",
    );
    expect(describeCarryOver(result)).toBe(appRunningMessage("Kenku FM"));
    expect(result.copiedItems).toEqual([]);
    expect(fs.existsSync(path.join(dest, MARKER_FILE_NAME))).toBe(false);
    expect(fs.existsSync(path.join(dest, "config.json"))).toBe(false);

    const afterClosing = carryOverLegacyData(source, dest, { isLegacyAppRunning: () => false });
    expect(afterClosing.status).toBe("copied");
  });

  it("by default treats a held Local Storage LOCK file as Kenku FM running (Windows refuses to open it)", () => {
    makeOldKenkuFolder();
    const lockFile = path.join(source, "Local Storage", "leveldb", "LOCK");
    const realOpen = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (String(file) === lockFile) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return realOpen(file, flags, mode);
    });

    expect(carryOverLegacyData(source, dest).status).toBe("legacy-app-running");
  });

  it("does not check for a running Kenku FM when there is nothing to copy", () => {
    const isLegacyAppRunning = vi.fn(() => true);
    expect(carryOverLegacyData(source, dest, { isLegacyAppRunning }).status).toBe("no-old-data");
    expect(isLegacyAppRunning).not.toHaveBeenCalled();
  });

  it("keeps folder names only in the marker file, never full paths (they contain the Windows user name)", () => {
    makeOldKenkuFolder();
    carryOverLegacyData(source, dest);
    const text = read(path.join(dest, MARKER_FILE_NAME));
    expect(text).not.toContain(root);
    expect(JSON.parse(text)).toMatchObject({
      status: "copied",
      sourceFolder: "Kenku FM",
      destFolder: "lyre",
      copiedItems: ["Local Storage", "Session Storage", "config.json"],
    });
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
      /^Your Kenku FM library was copied into Lyre .*Kenku FM itself was not changed\.$/,
    );
    expect(describeCarryOver(carryOverLegacyData(source, dest))).toContain("already happened");
  });
});

describe("carryOverEarlierData with Cue Desk and Kenku FM (rebrand to Lyre)", () => {
  /** A Cue Desk 0.1 data folder: Kenku FM's items plus its own files. */
  function makeCueDeskFolder() {
    write(path.join(cueDesk, "Local Storage", "leveldb", "000003.log"), "cue desk library");
    write(path.join(cueDesk, "Local Storage", "leveldb", "LOCK"), "");
    write(path.join(cueDesk, "config.json"), '{"bounds":"cue desk"}');
    write(path.join(cueDesk, "Local State"), '{"os_crypt":{"encrypted_key":"k"}}');
    write(path.join(cueDesk, "discord-bots.json"), '{"bots":[]}');
    write(path.join(cueDesk, "local-files.json"), "[]");
    write(path.join(cueDesk, "library", "library.sqlite"), "sqlite");
    write(path.join(cueDesk, "Partitions", "tabs", "Cookies"), "not copied");
    write(path.join(cueDesk, "data-carry-over.json"), '{"status":"copied"}');
  }

  it("copies the Cue Desk library when both earlier apps have one (Cue Desk is newer)", () => {
    makeOldKenkuFolder();
    makeCueDeskFolder();

    const result = carryOverBoth();

    expect(result.status).toBe("copied");
    expect(result.sourceApp).toBe("Cue Desk");
    expect(read(path.join(dest, "Local Storage", "leveldb", "000003.log"))).toBe("cue desk library");
    expect(read(path.join(dest, "config.json"))).toBe('{"bounds":"cue desk"}');
    expect(JSON.parse(read(path.join(dest, MARKER_FILE_NAME)))).toMatchObject({
      status: "copied",
      sourceFolder: "cue-desk",
      destFolder: "lyre",
    });
  });

  it("brings Cue Desk's own files across too: bot list with its encryption key, local-file choices, new library", () => {
    makeCueDeskFolder();

    const result = carryOverBoth();

    expect(result.copiedItems).toEqual([
      "Local Storage",
      "config.json",
      "Local State",
      "discord-bots.json",
      "local-files.json",
      "library",
    ]);
    expect(read(path.join(dest, "Local State"))).toContain("encrypted_key");
    expect(read(path.join(dest, "library", "library.sqlite"))).toBe("sqlite");
    expect(fs.existsSync(path.join(dest, "Partitions"))).toBe(false);
    // Cue Desk's own record of its carry-over is not the new app's record.
    expect(JSON.parse(read(path.join(dest, MARKER_FILE_NAME))).sourceFolder).toBe("cue-desk");
  });

  it("copies the Kenku FM library when there is no Cue Desk folder", () => {
    makeOldKenkuFolder();

    const result = carryOverBoth();

    expect(result.status).toBe("copied");
    expect(result.sourceApp).toBe("Kenku FM");
    expect(result.copiedItems).toEqual(["Local Storage", "Session Storage", "config.json"]);
    expect(describeCarryOver(result)).toMatch(/^Your Kenku FM library was copied into Lyre/);
  });

  it("skips a Cue Desk folder that holds no library and copies Kenku FM's", () => {
    makeOldKenkuFolder();
    write(path.join(cueDesk, "config.json"), '{"bounds":"cue desk"}');

    const result = carryOverBoth();

    expect(result.sourceApp).toBe("Kenku FM");
    expect(read(path.join(dest, "config.json"))).toBe('{"bounds":{"x":1}}');
  });

  it("waits while Cue Desk is running and does not fall back to the older Kenku FM library", () => {
    makeOldKenkuFolder();
    makeCueDeskFolder();
    const isLegacyAppRunning = vi.fn((dir: string) => dir === cueDesk);

    const result = carryOverBoth({ isLegacyAppRunning });

    expect(result.status).toBe("legacy-app-running");
    expect(result.sourceApp).toBe("Cue Desk");
    expect(result.reason).toBe("Cue Desk is still running. Close it and restart Lyre to bring your library across.");
    expect(fs.existsSync(path.join(dest, "Local Storage"))).toBe(false);
    expect(fs.existsSync(path.join(dest, MARKER_FILE_NAME))).toBe(false);
  });

  it("checks Cue Desk's own lock file, not Kenku FM's", () => {
    makeOldKenkuFolder();
    makeCueDeskFolder();
    const lockFile = path.join(cueDesk, "Local Storage", "leveldb", "LOCK");
    const realOpen = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (String(file) === lockFile) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return realOpen(file, flags, mode);
    });

    expect(carryOverBoth().status).toBe("legacy-app-running");
  });

  it("copies nothing from either app when Lyre already has a library", () => {
    makeOldKenkuFolder();
    makeCueDeskFolder();
    write(path.join(dest, "Local Storage", "leveldb", "000003.log"), "lyre library");

    const result = carryOverBoth();

    expect(result.status).toBe("destination-has-data");
    expect(read(path.join(dest, "Local Storage", "leveldb", "000003.log"))).toBe("lyre library");
    expect(fs.existsSync(path.join(dest, "discord-bots.json"))).toBe(false);
  });

  it("runs once: after copying from Kenku FM, a Cue Desk library found later is not copied", () => {
    makeOldKenkuFolder();
    carryOverBoth();
    makeCueDeskFolder();

    expect(carryOverBoth().status).toBe("already-done");
    expect(fs.existsSync(path.join(dest, "discord-bots.json"))).toBe(false);
  });

  it("says plainly when neither earlier app left a library", () => {
    const result = carryOverBoth();
    expect(result.status).toBe("no-old-data");
    expect(describeCarryOver(result)).toBe(
      "No Cue Desk or Kenku FM library was found on this computer, so Lyre started empty.",
    );
  });
});

describe("isLockFileHeld (FND-1: is Kenku FM running?)", () => {
  const failWith = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  function io(overrides: Partial<LockFileIo> = {}): LockFileIo {
    return { openSync: vi.fn(() => 7), readSync: vi.fn(() => 0), closeSync: vi.fn(), ...overrides };
  }

  it.each(["EBUSY", "EPERM", "EACCES"])("is true when opening the lock file fails with %s", (code) => {
    const fake = io({ openSync: vi.fn(failWith(code)) });
    expect(isLockFileHeld("/x/LOCK", fake)).toBe(true);
    expect(fake.openSync).toHaveBeenCalledWith("/x/LOCK", "r+");
  });

  it("is true when the file opens but its contents are locked (Windows byte-range lock)", () => {
    const fake = io({ readSync: vi.fn(failWith("EBUSY")) });
    expect(isLockFileHeld("/x/LOCK", fake)).toBe(true);
    expect(fake.closeSync).toHaveBeenCalledWith(7);
  });

  it("is false when there is no lock file", () => {
    expect(isLockFileHeld("/x/LOCK", io({ openSync: vi.fn(failWith("ENOENT")) }))).toBe(false);
  });

  it("is false when the lock file opens and reads, and closes it again without writing", () => {
    const fake = io();
    expect(isLockFileHeld("/x/LOCK", fake)).toBe(false);
    expect(fake.closeSync).toHaveBeenCalledWith(7);
  });
});
