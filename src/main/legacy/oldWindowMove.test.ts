import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moveOldWindowDataOnce, parseOldWindowData, type OldWindowMoveDeps } from "./oldWindowMove";

/** persist:root as redux-persist wrote it: every part is itself a JSON string. */
function persistRoot(settings: Record<string, unknown>, version = 7): string {
  return JSON.stringify({ settings: JSON.stringify(settings), _persist: JSON.stringify({ version, rehydrated: true }) });
}

describe("parseOldWindowData (FND-16)", () => {
  it("reads Sound to Discord from the old main window's settings", () => {
    expect(parseOldWindowData(persistRoot({ streamingMode: "lowLatency" })).streamingMode).toBe("lowLatency");
    expect(parseOldWindowData(persistRoot({ streamingMode: "performance" })).streamingMode).toBe("performance");
  });

  it("finds nothing in an empty, missing or damaged value", () => {
    for (const raw of [null, undefined, "", "{not json", JSON.stringify({ settings: "{not json" }), persistRoot({ streamingMode: "fast" })]) {
      expect(parseOldWindowData(raw).streamingMode).toBeNull();
    }
  });
});

describe("moveOldWindowDataOnce (FND-16)", () => {
  let dir: string;
  let deps: OldWindowMoveDeps & { setStreamingMode: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
  let hasMode: boolean;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-old-window-"));
    hasMode = false;
    deps = {
      recordFile: path.join(dir, "old-window.json"),
      read: vi.fn(async () => persistRoot({ streamingMode: "lowLatency" })),
      hasStreamingMode: () => hasMode,
      setStreamingMode: vi.fn(async () => true),
      now: () => 1234,
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("copies the old window's Sound to Discord into this computer's settings, once", async () => {
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).toHaveBeenCalledWith("lowLatency");
    expect(JSON.parse(fs.readFileSync(deps.recordFile, "utf8"))).toMatchObject({ movedAt: 1234 });
    deps.setStreamingMode.mockClear();
    deps.read.mockClear();
    await moveOldWindowDataOnce(deps);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
  });

  it("keeps a Sound to Discord this computer already has", async () => {
    hasMode = true;
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });

  it("records the move when there was no old window (a new install), so it never reads again", async () => {
    deps.read.mockResolvedValue(null);
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });

  it("tries again next start when the page could not be read or the setting not saved", async () => {
    deps.read.mockRejectedValueOnce(new Error("page gone"));
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    deps.setStreamingMode.mockResolvedValueOnce(false);
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });
});
