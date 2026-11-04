import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-data-"));

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn(), setPath: vi.fn() },
}));
electron.app.getPath.mockImplementation((name: string) => {
  if (name !== "appData") throw new Error(`unexpected getPath(${name})`);
  return appDataDir;
});
vi.mock("electron", () => electron);

let migration: typeof import("./index");
beforeAll(async () => {
  migration = await import("./index");
});

afterAll(() => fs.rmSync(appDataDir, { recursive: true, force: true }));

describe("migration wiring (FND-1)", () => {
  it("moves the data folder to <appData>/lyre as soon as it is imported", () => {
    expect(electron.app.setPath).toHaveBeenCalledWith("userData", path.join(appDataDir, "lyre"));
    expect(electron.app.setPath).toHaveBeenCalledWith("sessionData", path.join(appDataDir, "lyre"));
  });

  it("looks for earlier libraries in <appData>/cue-desk first, then <appData>/Kenku FM", () => {
    const folders = migration.dataFolders("/x");
    expect(folders.userData).toBe(path.join("/x", "lyre"));
    expect(folders.earlierApps.map(({ name, dir }) => ({ name, dir }))).toEqual([
      { name: "Cue Desk", dir: path.join("/x", "cue-desk") },
      { name: "Kenku FM", dir: path.join("/x", "Kenku FM") },
    ]);
  });

  it("gives Windows the same app ID the Squirrel installer writes into shortcuts", () => {
    expect(migration.windowsAppUserModelId("lyre")).toBe("com.squirrel.lyre.lyre");
    expect(migration.windowsAppUserModelId("cue-desk")).toBe("com.squirrel.cue_desk.cue-desk");
  });

  it("copies the Kenku FM library and keeps the result for the UI", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const leveldb = path.join(appDataDir, "Kenku FM", "Local Storage", "leveldb");
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, "000003.log"), "persist:player");

    expect(migration.getDataCarryOverResult()).toBeNull();
    const result = migration.runDataCarryOver();

    expect(result.status).toBe("copied");
    expect(migration.getDataCarryOverResult()).toBe(result);
    expect(fs.readFileSync(path.join(appDataDir, "lyre", "Local Storage", "leveldb", "000003.log"), "utf8")).toBe(
      "persist:player",
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[data carry-over] Your Kenku FM library was copied"));
    info.mockRestore();
  });
});
