import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabaseError } from "./errors";
import { libraryFolder, openLibrary, restoreBackup, startDailyBackups, type Library } from "./library";
import { BACKUPS_TO_KEEP, listBackups } from "./backups";
import { MIGRATIONS, type Migration } from "./schema";
import { createCampaign, listCampaigns } from "./repo/campaigns";
import { makeClock, makeTempFolder } from "./test/helpers";
import { generateLibrary } from "./test/generateLibrary";

let temp: ReturnType<typeof makeTempFolder>;
let folder: string;
let open: Library[] = [];
const clock = makeClock(new Date(2026, 10, 4, 12, 0, 0).getTime());

function openTracked(options: Partial<Parameters<typeof openLibrary>[0]> = {}) {
  const library = openLibrary({ folder, now: clock.now, ...options });
  open.push(library);
  return library;
}

beforeEach(() => {
  temp = makeTempFolder();
  folder = path.join(temp.folder, "library");
  clock.set(new Date(2026, 10, 4, 12, 0, 0).getTime());
});
afterEach(() => {
  for (const library of open) library.close();
  open = [];
  temp.cleanup();
});

/** Overwrites bytes in a closed database file. */
function damage(file: string, offset: number, length: number) {
  const fd = fs.openSync(file, "r+");
  fs.writeSync(fd, Buffer.alloc(length, 0x5a), 0, length, offset);
  fs.closeSync(fd);
}

describe("opening the library (DAT-6)", () => {
  it("creates the folder and an up-to-date database on first use", () => {
    const library = openTracked();
    expect(fs.existsSync(path.join(folder, "library.sqlite"))).toBe(true);
    expect(library.schemaVersion).toBe(MIGRATIONS.length);
    createCampaign(library.store, { name: "Strahd" });
    library.close();
    open = [];
    const again = openTracked();
    expect(listCampaigns(again.store).map((c) => c.name)).toEqual(["Strahd"]);
  });

  it("keeps the library in a 'library' folder inside the app data folder", () => {
    expect(libraryFolder(path.join("C:", "Users", "gm", "AppData", "Roaming", "lyre"))).toBe(
      path.join("C:", "Users", "gm", "AppData", "Roaming", "lyre", "library"),
    );
  });

  it("comes with undo/redo wired to every change", () => {
    const library = openTracked();
    createCampaign(library.store, { name: "Strahd" });
    expect(library.history.undo()).toBe('Add campaign "Strahd"');
    expect(listCampaigns(library.store)).toEqual([]);
  });

  it("backs the library up before upgrading it to a new version", () => {
    openTracked().close();
    open = [];
    const later: Migration = { version: MIGRATIONS.length + 1, name: "later", up: (db) => db.exec("CREATE TABLE pads (id TEXT PRIMARY KEY)") };
    const library = openTracked({ migrations: [...MIGRATIONS, later] });
    expect(library.schemaVersion).toBe(MIGRATIONS.length + 1);
    const backups = listBackups(library.backupFolder);
    expect(backups.map((b) => b.kind)).toEqual(["upgrade"]);
    expect(path.basename(backups[0].path)).toMatch(/^library-upgrade-v1-/);
  });

  it("reports a damaged file clearly and offers the newest backup (check before opening)", () => {
    const library = openTracked();
    createCampaign(library.store, { name: "Strahd" });
    const backup = library.backupNow();
    library.close();
    open = [];
    const file = path.join(folder, "library.sqlite");
    // Scribble over the middle of the file, where the tables live.
    damage(file, 4096 * 2, 4096 * 3);

    let error: unknown;
    try {
      openTracked({ integrityCheck: "blocking" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LibraryDatabaseError);
    expect((error as LibraryDatabaseError).code).toBe("corrupt");
    expect((error as LibraryDatabaseError).message).toMatch(/damaged/);
    expect((error as LibraryDatabaseError).latestBackup).toBe(backup.path);

    expect(() => restoreBackup({ folder, backupPath: path.join(temp.folder, "elsewhere.sqlite") })).toThrow(
      /backups folder/,
    );
    const result = restoreBackup({ folder, backupPath: backup.path, now: clock.now });
    expect(fs.existsSync(result.damagedCopy)).toBe(true);
    const restored = openTracked();
    expect(listCampaigns(restored.store).map((c) => c.name)).toEqual(["Strahd"]);
  });

  it("checks a large library in the background and reports damage found there", async () => {
    let library = openTracked();
    generateLibrary(library, { tracks: 2000, playlists: 20 });
    expect(await library.checkIntegrity()).toEqual({ status: "ok" });
    const backup = library.backupNow();
    const page = library.store.get<{ pageno: number }>(
      "SELECT pageno FROM dbstat WHERE name = 'tracks' AND pagetype = 'leaf' ORDER BY pageno LIMIT 1 OFFSET 20",
    )!.pageno;
    const pageSize = library.store.get<{ page_size: number }>("PRAGMA page_size")!.page_size;
    library.close();
    open = [];
    damage(path.join(folder, "library.sqlite"), (page - 1) * pageSize + 8, pageSize - 8);

    library = openTracked();
    const report = await library.checkIntegrity();
    expect(report.status).toBe("corrupt");
    expect(report.status === "corrupt" && report.error.latestBackup).toBe(backup.path);
    expect(report.status === "corrupt" && report.error.code).toBe("corrupt");
  });

  it("stops the background check when the library is closed", async () => {
    const library = openTracked();
    generateLibrary(library, { tracks: 2000, playlists: 20 });
    library.close();
    open = [];
    const reopened = openLibrary({ folder, now: clock.now });
    reopened.close();
    expect(await reopened.checkIntegrity()).toEqual({ status: "not-checked" });
    expect(await openTracked({ integrityCheck: "blocking" }).checkIntegrity()).toEqual({ status: "ok" });
  });

  it("reports a file that is not a library at all", () => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "library.sqlite"), "this is not a database".repeat(100));
    expect(() => openTracked()).toThrow(expect.objectContaining({ code: "corrupt", latestBackup: null }));
  });
});

describe("backups (DAT-6)", () => {
  it("makes a manual backup that opens as a complete library", () => {
    const library = openTracked();
    createCampaign(library.store, { name: "Strahd" });
    const backup = library.backupNow();
    expect(backup.kind).toBe("manual");
    expect(path.dirname(backup.path)).toBe(path.join(folder, "backups"));
    const copy = openLibrary({ folder: path.join(temp.folder, "copy"), now: clock.now });
    copy.close();
    fs.copyFileSync(backup.path, path.join(temp.folder, "copy", "library.sqlite"));
    fs.rmSync(path.join(temp.folder, "copy", "library.sqlite-wal"), { force: true });
    fs.rmSync(path.join(temp.folder, "copy", "library.sqlite-shm"), { force: true });
    const reopened = openTracked({ folder: path.join(temp.folder, "copy") });
    expect(listCampaigns(reopened.store).map((c) => c.name)).toEqual(["Strahd"]);
    expect(fs.readdirSync(path.join(folder, "backups")).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("makes one daily backup per day and keeps the newest 14", () => {
    const library = openTracked();
    for (let day = 0; day < 20; day++) {
      expect(library.runDailyBackup()).not.toBeNull();
      expect(library.runDailyBackup()).toBeNull(); // already done today
      clock.advance(24 * 60 * 60 * 1000);
    }
    const daily = listBackups(library.backupFolder).filter((b) => b.kind === "daily");
    expect(BACKUPS_TO_KEEP).toBe(14);
    expect(daily).toHaveLength(14);
    // Newest first: the last day made, back 13 days.
    expect(path.basename(daily[0].path)).toBe("library-daily-2026-11-23T12-00-00-000.sqlite");
    expect(path.basename(daily[13].path)).toBe("library-daily-2026-11-10T12-00-00-000.sqlite");
  });

  it("keeps manual backups apart from the daily ones, also the newest 14", () => {
    const library = openTracked();
    library.runDailyBackup();
    for (let i = 0; i < 16; i++) {
      library.backupNow();
      clock.advance(1000);
    }
    const backups = listBackups(library.backupFolder);
    expect(backups.filter((b) => b.kind === "manual")).toHaveLength(14);
    expect(backups.filter((b) => b.kind === "daily")).toHaveLength(1);
    expect(backups[0].createdAt).toBeGreaterThan(backups[1].createdAt);
  });

  it("ignores unrelated files in the backups folder and skips a damaged backup when offering one", () => {
    const library = openTracked();
    const good = library.backupNow();
    clock.advance(1000);
    const bad = library.backupNow();
    damage(bad.path, 0, 100);
    fs.writeFileSync(path.join(library.backupFolder, "notes.txt"), "mine");
    library.close();
    open = [];
    damage(path.join(folder, "library.sqlite"), 0, 100);
    // A damaged header is caught at once, without waiting for the full check.
    expect(() => openTracked()).toThrow(expect.objectContaining({ code: "corrupt", latestBackup: good.path }));
    expect(fs.existsSync(path.join(folder, "backups", "notes.txt"))).toBe(true);
  });

  it("checks every day on a timer and reports failures without stopping", () => {
    vi.useFakeTimers();
    try {
      const library = openTracked();
      const errors: unknown[] = [];
      const stop = startDailyBackups(library, { intervalMs: 60_000, onError: (e) => errors.push(e) });
      expect(listBackups(library.backupFolder)).toHaveLength(1);
      clock.advance(24 * 60 * 60 * 1000);
      vi.advanceTimersByTime(60_000);
      expect(listBackups(library.backupFolder)).toHaveLength(2);
      fs.rmSync(library.backupFolder, { recursive: true });
      fs.writeFileSync(library.backupFolder, "a file where the folder should be");
      clock.advance(24 * 60 * 60 * 1000);
      vi.advanceTimersByTime(60_000);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "backup-failed" });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to back up in the middle of a change", () => {
    const library = openTracked();
    expect(() => library.store.change("x", () => library.backupNow())).toThrow(/while a change/);
  });
});
