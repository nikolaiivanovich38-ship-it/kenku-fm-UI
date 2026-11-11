import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRemoteState } from "../../common/remoteControl";
import { fakeIpcMain, fakePage, fromMainFrame, fromSubframe } from "../security/testing/fakeIpc";
import { REMOTE_RETURNS_LATER, RemoteOff } from "./remoteOff";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

let remote: RemoteOff | undefined;
beforeEach(() => fakeIpcMain.reset());
afterEach(() => {
  remote?.destroy();
  remote = undefined;
});

describe("remote control, hidden until Stream Deck support (FND-16 step 6; Nik, 11 Nov)", () => {
  it("answers off to the Lyre page: not on, not running, no code; nothing is listening", async () => {
    remote = new RemoteOff();
    const lyre = fromMainFrame(fakePage("lyre-view"));
    const state = await fakeIpcMain.invoke("REMOTE_GET", lyre);
    expect(isRemoteState(state)).toBe(true);
    expect(state).toMatchObject({ enabled: false, running: false, code: "", codeRemembered: false, homeAddress: null });
    expect(await fakeIpcMain.invoke("REMOTE_NEW_CODE", lyre)).toEqual(state);
  });

  it("refuses to turn it on, in plain words", async () => {
    remote = new RemoteOff();
    expect(await fakeIpcMain.invoke("REMOTE_SET", fromMainFrame(fakePage("lyre-view")), { enabled: true })).toEqual({ error: REMOTE_RETURNS_LATER });
    expect(REMOTE_RETURNS_LATER).toBe("Remote control returns with Stream Deck support.");
  });

  it("answers the Lyre page only", async () => {
    remote = new RemoteOff();
    for (const event of [fromMainFrame(fakePage(null)), fromSubframe(fakePage("lyre-view")), fromMainFrame(fakePage("main-window"))]) {
      await expect(fakeIpcMain.invoke("REMOTE_GET", event)).rejects.toThrow();
    }
  });

  it("stops answering when destroyed", () => {
    remote = new RemoteOff();
    remote.destroy();
    remote = undefined;
    expect(fakeIpcMain.handlers.size).toBe(0);
  });
});
