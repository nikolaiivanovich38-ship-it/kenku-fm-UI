import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "net";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";
import { trustedContents } from "../security/trustedContents";

vi.hoisted(() => {
  Object.assign(globalThis, {
    AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: "file:///app/audio_capture_window/index.html",
    AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: "/app/audio_capture_window/preload.js",
  });
});

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("electron", async () => {
  const { EventEmitter } = await import("events");
  class FakeWebContents extends EventEmitter {
    id = 42;
    loadURL = vi.fn().mockResolvedValue(undefined);
    getURL = () => "file:///app/audio_capture_window/index.html";
    send = vi.fn();
    close = vi.fn();
    destroy = vi.fn();
    setWindowOpenHandler = vi.fn();
  }
  class BrowserWindow {
    webContents = new FakeWebContents();
  }
  return {
    BrowserWindow,
    webContents: { fromId: vi.fn() },
    ipcMain: {
      on: vi.fn(),
      off: vi.fn(),
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      removeHandler: vi.fn(),
    },
  };
});

let manager: InstanceType<typeof AudioCaptureManagerMain> | undefined;
afterEach(() => {
  manager?.destroy();
  manager = undefined;
});

async function listening(m: InstanceType<typeof AudioCaptureManagerMain>) {
  if (!m._wss.address()) {
    await new Promise((resolve) => m._wss.once("listening", resolve));
  }
  return m._wss.address() as AddressInfo;
}

describe("AudioCaptureManagerMain audio socket (SEC-2)", () => {
  it("listens on the loopback interface only", async () => {
    manager = new AudioCaptureManagerMain();
    const address = await listening(manager);
    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
  });

  it("hands the capture window a loopback address it can connect to", async () => {
    manager = new AudioCaptureManagerMain();
    await listening(manager);
    const address = (await handlers.get("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS")?.()) as AddressInfo;
    expect(address.address).toBe("127.0.0.1");

    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.close();
  });

  it("registers the capture window as a trusted page", async () => {
    manager = new AudioCaptureManagerMain();
    expect(trustedContents.roleOf(manager._browserWindow.webContents)).toBe("audio-capture");
  });
});
