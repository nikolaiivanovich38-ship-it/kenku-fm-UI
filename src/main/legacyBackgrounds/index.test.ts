import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { trustedContents } from "../security/trustedContents";
import { registerBackgroundsIpc, startKenkuBackgroundImport } from "./index";
import { LOCAL_APP_DATA_DIR_ENV } from "./kenkuInstall";

const state = vi.hoisted(() => {
  // A test build, as packaged for the end-to-end tests.
  Object.assign(globalThis, { __CUE_DESK_TEST_BUILD__: true });
  return { userData: "", ipc: undefined as unknown as EventEmitter & { handle(): void; removeHandler(): void } };
});

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("events");
  state.ipc = Object.assign(new Emitter(), { handle: vi.fn(), removeHandler: vi.fn() });
  return {
    app: { getPath: (name: string) => (name === "userData" ? state.userData : "") },
    ipcMain: state.ipc,
  };
});

let root: string;

function fakeContents(id: number) {
  const mainFrame = { frameTreeNodeId: id * 10 };
  return { id, isDestroyed: () => false, mainFrame, once: vi.fn() };
}

/** Send PLAYER_GET_BACKGROUNDS as `sendSync` would and wait for the answer. */
async function ask(contents: ReturnType<typeof fakeContents>): Promise<unknown> {
  const event: { sender: typeof contents; senderFrame: { frameTreeNodeId: number }; returnValue?: unknown } = {
    sender: contents,
    senderFrame: contents.mainFrame,
  };
  state.ipc.emit("PLAYER_GET_BACKGROUNDS", event);
  await vi.waitFor(() => expect(event).toHaveProperty("returnValue"));
  return event.returnValue;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kenku-backgrounds-ipc-"));
  state.userData = path.join(root, "cue-desk");
  process.env.CUE_DESK_USER_DATA_DIR = state.userData;
});

afterAll(() => {
  delete process.env.CUE_DESK_USER_DATA_DIR;
  delete process.env[LOCAL_APP_DATA_DIR_ENV];
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Kenku FM backgrounds at start-up and PLAYER_GET_BACKGROUNDS", () => {
  const player = fakeContents(7);
  const mainWindow = fakeContents(8);

  beforeAll(() => {
    trustedContents.trust(player, "player-view");
    trustedContents.trust(mainWindow, "main-window");
    registerBackgroundsIpc();
  });

  it("answers the player with the copied pictures once the copy has finished", async () => {
    const localAppData = path.join(root, "Local");
    const rendererDir = path.join(localAppData, "kenku-fm-win32-x64", "app-1.5.5", "resources", "app", ".webpack", "renderer");
    fs.mkdirSync(path.join(rendererDir, "player_window"), { recursive: true });
    fs.writeFileSync(path.join(rendererDir, "abc123.jpg"), "tavern picture");
    fs.writeFileSync(
      path.join(rendererDir, "player_window", "index.js"),
      '{"./tavern.jpg":5},5:(e,t,r)=>{"use strict";e.exports=r.p+"abc123.jpg"}',
    );
    process.env[LOCAL_APP_DATA_DIR_ENV] = localAppData;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const started = startKenkuBackgroundImport();
    const answer = await ask(player);
    await started;

    const copied = path.join(state.userData, "backgrounds", "tavern.jpg");
    expect(answer).toEqual({ tavern: pathToFileURL(copied).href });
    expect(fs.readFileSync(copied, "utf8")).toBe("tavern picture");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(/^\[Kenku FM backgrounds\] Copied 1 of 1 background pictures from /);
    info.mockRestore();
  });

  it("refuses the main window and anything with arguments", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await ask(mainWindow)).toEqual({});
    const event = { sender: player, senderFrame: player.mainFrame, returnValue: undefined as unknown };
    state.ipc.emit("PLAYER_GET_BACKGROUNDS", event, "../../etc");
    expect(event.returnValue).toEqual({});
    expect(warn).toHaveBeenCalledWith("Ignored a PLAYER_GET_BACKGROUNDS message: not an app page allowed on this channel");
    expect(warn).toHaveBeenCalledWith("Ignored a PLAYER_GET_BACKGROUNDS message: unexpected arguments");
    warn.mockRestore();
  });
});
