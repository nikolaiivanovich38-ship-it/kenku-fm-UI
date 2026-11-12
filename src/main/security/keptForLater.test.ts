/**
 * FND-16 step 9, narrowed (Nik, 11 Nov: "Keep the code, remove them from the interface"): website tabs, local files
 * and microphones or other inputs are kept for OUT-12 (online sources, a later release) and unreachable. These
 * checks keep them so: no channel that reaches that code may come from the Lyre page, and the window's managers do
 * not make the website-tab manager.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { IPC_CHANNELS } from "./ipcChannels";

const KEPT = /^(BROWSER_VIEW_|LOCAL_FILES_|AUDIO_CAPTURE_)/;

describe("website tabs, local files and device capture: kept, unreachable (FND-16, OUT-12)", () => {
  it("are reached only by channels from the old main window, which no page is any more", () => {
    const kept = Object.entries(IPC_CHANNELS).filter(([name]) => KEPT.test(name));
    expect(kept.length).toBeGreaterThan(10);
    for (const [name, rule] of kept) expect(rule.from, name).toEqual(["main-window"]);
  });

  it("no page is the old main window: src/index.ts trusts its one window as the Lyre page", () => {
    const index = fs.readFileSync(path.resolve(__dirname, "../../index.ts"), "utf8");
    expect(index).not.toMatch(/"main-window"/);
    expect(index).toMatch(/lockAppPage\(mainWindow\.webContents, "lyre-view"/);
  });

  it("nothing is registered for them at start: no cue-local-file scheme, no website-tab or local-file session (CR51-3)", () => {
    const index = fs.readFileSync(path.resolve(__dirname, "../../index.ts"), "utf8");
    expect(index).toMatch(/registerAppSchemes\(\);/);
    expect(index).not.toMatch(/websiteTabs|secureKeptSessions|fromPartition|LOCAL_FILE|TAB_PARTITION/);
  });

  it("nothing makes the website-tab manager", () => {
    const session = fs.readFileSync(path.resolve(__dirname, "../managers/SessionManager.ts"), "utf8");
    expect(session).not.toMatch(/BrowserViewManagerMain/);
  });
});
