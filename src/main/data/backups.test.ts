/**
 * DAT-6 gaps found by the import stream: the backup taken before the old
 * player's library moves in, rotation of upgrade backups, putting back an
 * upgrade backup, and refusing to put back a damaged one.
 * (library.test.ts covers daily, manual and upgrade backups and restoring.)
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLibrary, restoreBackup, type Library } from "./library";
import { BACKUPS_TO_KEEP, backUpInBackground, listBackups, writeBackup } from "./backups";
import { MIGRATIONS, type Migration } from "./schema";
import { createCampaign, listCampaigns } from "./repo/campaigns";
import { makeClock, makeTempFolder } from "./test/helpers";

let temp: ReturnType<typeof makeTempFolder>;
let folder: string;
let open: Library[] = [];
const clock = makeClock(new Date(2026, 10, 4, 12, 0, 0).getTime());

function openTracked(options: Partial<Parameters<typeof openLibrary>[0]> = {}) {
  const library = openLibrary({ folder, now: clock.now, ...options });
  open.push(library);
  return library;
}

function closeAll() {
  for (const library of open) library.close();
  open = [];
}

beforeEach(() => {
  temp = makeTempFolder();
  folder = path.join(temp.folder, "library");
  clock.set(new Date(2026, 10, 4, 12, 0, 0).getTime());
});
afterEach(() => {
  closeAll();
  temp.cleanup();
});

describe("backups (DAT-6, import stream)", () => {
  it("keeps the backup made before the old library moves in as its own kind, newest 14", async () => {
    const library = openTracked();
    await library.backupNow();
    for (let i = 0; i < 16; i++) {
      await backUpInBackground(library.databasePath, library.backupFolder, "before-import", clock.now());
      clock.advance(1000);
    }
    const backups = listBackups(library.backupFolder);
    expect(backups.filter((b) => b.kind === "import")).toHaveLength(BACKUPS_TO_KEEP);
    expect(backups.filter((b) => b.kind === "manual")).toHaveLength(1);
    expect(path.basename(backups[0].path)).toMatch(/^library-before-import-2026-11-04T12-00-15-000\.sqlite$/);
  });

  it("keeps the newest 14 upgrade backups", () => {
    const library = openTracked();
    for (let i = 0; i < 16; i++) {
      writeBackup(library.store.db, library.backupFolder, `upgrade-v${i + 1}`, clock.now());
      clock.advance(1000);
    }
    expect(listBackups(library.backupFolder).filter((b) => b.kind === "upgrade")).toHaveLength(BACKUPS_TO_KEEP);
  });

  it("puts back the copy made before an upgrade, which is upgraded again (and backed up again) when opened", () => {
    const first = openTracked();
    createCampaign(first.store, { name: "Strahd" });
    closeAll();
    const later: Migration = {
      version: MIGRATIONS.length + 1,
      name: "later",
      up: (db) => db.exec("CREATE TABLE later_things (id TEXT PRIMARY KEY)"),
    };
    clock.advance(1000);
    const upgraded = openTracked({ migrations: [...MIGRATIONS, later] });
    createCampaign(upgraded.store, { name: "Made after the upgrade" });
    const [upgradeBackup] = listBackups(upgraded.backupFolder);
    expect(upgradeBackup.kind).toBe("upgrade");
    closeAll();

    restoreBackup({ folder, backupPath: upgradeBackup.path, now: clock.now });
    clock.advance(1000);
    const restored = openTracked({ migrations: [...MIGRATIONS, later] });
    expect(restored.schemaVersion).toBe(MIGRATIONS.length + 1);
    expect(listCampaigns(restored.store).map((c) => c.name)).toEqual(["Strahd"]);
    expect(listBackups(restored.backupFolder).filter((b) => b.kind === "upgrade")).toHaveLength(2);
  });

  it("refuses to put back a damaged backup and leaves the library as it was", async () => {
    const library = openTracked();
    createCampaign(library.store, { name: "Strahd" });
    const backup = await library.backupNow();
    closeAll();
    const fd = fs.openSync(backup.path, "r+");
    fs.writeSync(fd, Buffer.alloc(100, 0x5a), 0, 100, 0);
    fs.closeSync(fd);

    expect(() => restoreBackup({ folder, backupPath: backup.path, now: clock.now })).toThrow(/backup is damaged/);
    expect(fs.readdirSync(folder).filter((name) => name.startsWith("library-damaged"))).toEqual([]);
    expect(listCampaigns(openTracked().store).map((c) => c.name)).toEqual(["Strahd"]);
  });

  it("reports a backup the worker thread could not make, and leaves no half-written copy", async () => {
    const library = openTracked();
    const folderInTheWay = path.join(temp.folder, "in-the-way");
    fs.writeFileSync(folderInTheWay, "a file where the folder should be");
    await expect(backUpInBackground(library.databasePath, folderInTheWay, "manual", clock.now())).rejects.toMatchObject({
      code: "backup-failed",
    });
    await expect(backUpInBackground(path.join(temp.folder, "no-such.sqlite"), library.backupFolder, "manual", clock.now())).rejects.toMatchObject({
      code: "backup-failed",
    });
    expect(listBackups(library.backupFolder)).toEqual([]);
    expect(fs.existsSync(library.backupFolder) ? fs.readdirSync(library.backupFolder) : []).toEqual([]);
  });
});
