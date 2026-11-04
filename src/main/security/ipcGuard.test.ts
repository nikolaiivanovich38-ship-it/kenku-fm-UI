import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardIpc } from "./ipcGuard";
import { IPC_CHANNELS } from "./ipcChannels";
import { TrustedContentsRegistry } from "./trustedContents";
import {
  FakeIpcMain,
  fakePage,
  fromMainFrame,
  fromSubframe,
} from "./testing/fakeIpc";

let ipc: FakeIpcMain;
let registry: TrustedContentsRegistry;
let warn: ReturnType<typeof vi.fn<(message: string) => void>>;

beforeEach(() => {
  ipc = new FakeIpcMain();
  registry = new TrustedContentsRegistry();
  warn = vi.fn<(message: string) => void>();
});

function guard() {
  return guardIpc(ipc, { registry, warn });
}

describe("guardIpc: who may send (SEC-8)", () => {
  it("passes a message from an allowed app page to the listener", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    const main = fakePage("main-window", registry);
    const event = ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(main));
    expect(listener).toHaveBeenCalledWith(event);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops a message from a website tab", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(fakePage(null, registry)));
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a message from an app page that does not use the channel", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(fakePage("player-view", registry)));
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(fakePage("audio-capture", registry)));
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a message from an embedded frame inside a trusted page", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    ipc.deliver("WINDOW_MINIMIZE", fromSubframe(fakePage("main-window", registry)));
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a message whose frame has gone (navigated away or destroyed)", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    const main = fakePage("main-window", registry);
    ipc.deliver("WINDOW_MINIMIZE", { ...fromMainFrame(main), senderFrame: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a message from a destroyed page", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    const main = fakePage("main-window", registry);
    main.destroyed = true;
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(main));
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a message from a page whose id was reused after its trusted owner was destroyed", () => {
    const listener = vi.fn();
    guard().on("WINDOW_MINIMIZE", listener);
    const main = fakePage("main-window", registry);
    main.destroy();
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(main));
    expect(listener).not.toHaveBeenCalled();
  });

  it("logs each kind of refusal once per channel", () => {
    guard().on("WINDOW_MINIMIZE", vi.fn());
    const tab = fakePage(null, registry);
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(tab));
    ipc.deliver("WINDOW_MINIMIZE", fromMainFrame(tab));
    ipc.deliver("WINDOW_MINIMIZE", fromSubframe(fakePage("main-window", registry)));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("WINDOW_MINIMIZE");
  });

  it("answers a refused synchronous message so the caller does not hang", () => {
    guard().on("PLAYER_GET_URL", vi.fn());
    const event = ipc.deliver("PLAYER_GET_URL", fromMainFrame(fakePage(null, registry)));
    expect(event.returnValue).toBe(IPC_CHANNELS.PLAYER_GET_URL.refusedReturnValue);
  });
});

describe("guardIpc: argument types (SEC-8)", () => {
  it("passes well-formed arguments through unchanged", () => {
    const listener = vi.fn();
    guard().on("AUDIO_CAPTURE_SET_MUTED", listener);
    const event = ipc.deliver(
      "AUDIO_CAPTURE_SET_MUTED",
      fromMainFrame(fakePage("main-window", registry)),
      7,
      true,
    );
    expect(listener).toHaveBeenCalledWith(event, 7, true);
  });

  it.each([
    ["a string id", ["7", true]],
    ["a fractional id", [7.5, true]],
    ["a non-boolean flag", [7, "yes"]],
    ["a missing argument", [7]],
    ["an extra argument", [7, true, "extra"]],
    ["an object", [{ id: 7 }, true]],
  ])("drops a message with %s", (_, args) => {
    const listener = vi.fn();
    guard().on("AUDIO_CAPTURE_SET_MUTED", listener);
    ipc.deliver(
      "AUDIO_CAPTURE_SET_MUTED",
      fromMainFrame(fakePage("main-window", registry)),
      ...args,
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops over-long strings", () => {
    const listener = vi.fn();
    guard().on("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", listener);
    ipc.deliver(
      "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
      fromMainFrame(fakePage("main-window", registry)),
      "1".repeat(10_000),
    );
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("guardIpc: invoke handlers (SEC-8)", () => {
  // WP2: uses CLEAR_CACHE since the capture window's socket-address channel is gone (SEC-2).
  it("answers an allowed caller", async () => {
    guard().handle("CLEAR_CACHE", () => "cleared");
    const main = fakePage("main-window", registry);
    await expect(ipc.invoke("CLEAR_CACHE", fromMainFrame(main))).resolves.toBe("cleared");
  });

  it("rejects any other caller without running the handler", async () => {
    const handler = vi.fn();
    guard().handle("CLEAR_CACHE", handler);
    await expect(ipc.invoke("CLEAR_CACHE", fromMainFrame(fakePage(null, registry)))).rejects.toThrow();
    await expect(
      ipc.invoke("CLEAR_CACHE", fromMainFrame(fakePage("audio-capture", registry))),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("guardIpc: clean-up", () => {
  it("removes one registration with the function it returns", () => {
    const listener = vi.fn();
    const stop = guard().on("WINDOW_MINIMIZE", listener);
    stop();
    expect(ipc.listenerCount("WINDOW_MINIMIZE")).toBe(0);
  });

  it("removes everything it registered on dispose", () => {
    const g = guard();
    g.on("WINDOW_MINIMIZE", vi.fn());
    g.on("WINDOW_CLOSE", vi.fn());
    g.handle("CLEAR_CACHE", vi.fn());
    const other = vi.fn();
    ipc.on("WINDOW_CLOSE", other);
    g.dispose();
    expect(ipc.listenerCount("WINDOW_MINIMIZE")).toBe(0);
    expect(ipc.listeners("WINDOW_CLOSE")).toEqual([other]);
    expect(ipc.handlers.size).toBe(0);
  });
});

describe("IPC channel table (SEC-8)", () => {
  it("allows every channel from at least one page and never from a website tab", () => {
    for (const [channel, rule] of Object.entries(IPC_CHANNELS)) {
      expect(rule.from.length, channel).toBeGreaterThan(0);
      expect(rule.from as readonly unknown[], channel).not.toContain(null);
    }
  });

  it("has no channel for Kenku FM's background pictures: the player bundles its own", () => {
    expect(Object.keys(IPC_CHANNELS)).not.toContain("PLAYER_GET_BACKGROUNDS");
  });
});
