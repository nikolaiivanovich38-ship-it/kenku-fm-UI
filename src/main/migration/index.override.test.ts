import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// FND-4: end-to-end tests start the app with a throw-away data folder.
const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-data-"));
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-data-"));

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn(), setPath: vi.fn() },
}));
electron.app.getPath.mockImplementation(() => appDataDir);
vi.mock("electron", () => electron);

let migration: typeof import("./index");
beforeAll(async () => {
  vi.stubEnv("CUE_DESK_USER_DATA_DIR", testDataDir);
  migration = await import("./index");
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(appDataDir, { recursive: true, force: true });
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe("migration wiring with CUE_DESK_USER_DATA_DIR (FND-4)", () => {
  it("uses the given folder for all app data", () => {
    expect(electron.app.setPath).toHaveBeenCalledWith("userData", testDataDir);
    expect(electron.app.setPath).toHaveBeenCalledWith("sessionData", testDataDir);
  });

  it("never copies a Kenku FM library into the test folder", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const leveldb = path.join(appDataDir, "Kenku FM", "Local Storage", "leveldb");
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, "000003.log"), "persist:player");

    const result = migration.runDataCarryOver();

    expect(result.copiedItems).toEqual([]);
    expect(fs.existsSync(path.join(testDataDir, "Local Storage"))).toBe(false);
  });
});
