/**
 * SEC-8 test helpers: a fake `ipcMain` and fake web contents with frames, so
 * IPC sender checks can be exercised without Electron.
 */
import { EventEmitter } from "events";
import { vi } from "vitest";
import type { AppPageRole } from "../permissions";
import { TrustedContentsRegistry, trustedContents } from "../trustedContents";

let nextId = 5000;

/** Stand-in for Electron's WebFrameMain. */
export class FakeFrame {
  constructor(readonly frameTreeNodeId: number) {}
}

/** Stand-in for an Electron WebContents with a main frame and one subframe. */
export class FakePage extends EventEmitter {
  readonly id = nextId++;
  readonly mainFrame = new FakeFrame(this.id * 10);
  readonly subframe = new FakeFrame(this.id * 10 + 1);
  destroyed = false;
  send = vi.fn();
  isDestroyed = () => this.destroyed;
  getMediaSourceId = vi.fn(() => `media-source-${this.id}`);

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

/** A web contents registered in `registry` with `role`, or a website tab when `role` is null. */
export function fakePage(
  role: AppPageRole | null,
  registry: TrustedContentsRegistry = trustedContents,
): FakePage {
  const page = new FakePage();
  if (role) {
    registry.trust(page, role);
  }
  return page;
}

/** An IPC event as Electron delivers it for a message from `page`'s main frame. */
export function fromMainFrame(page: FakePage) {
  return {
    sender: page,
    senderFrame: page.mainFrame as FakeFrame | null,
    returnValue: undefined as unknown,
    reply: vi.fn(),
  };
}

/** An IPC event for a message sent by an embedded frame inside `page`. */
export function fromSubframe(page: FakePage) {
  return { ...fromMainFrame(page), senderFrame: page.subframe };
}

export type FakeIpcEvent = ReturnType<typeof fromMainFrame>;

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Fake `ipcMain`: an EventEmitter plus `handle`/`removeHandler` like Electron's. */
export class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Listener>();

  handle<E>(channel: string, listener: (event: E, ...args: unknown[]) => unknown) {
    if (this.handlers.has(channel)) {
      throw new Error(`Attempted to register a second handler for '${channel}'`);
    }
    this.handlers.set(channel, listener as Listener);
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }

  /** Deliver an `ipcRenderer.send`/`sendSync` message and return the event (for `returnValue`). */
  deliver<E>(channel: string, event: E, ...args: unknown[]): E {
    this.emit(channel, event, ...args);
    return event;
  }

  /** Deliver an `ipcRenderer.invoke` call. */
  async invoke(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for '${channel}'`);
    }
    return handler(event, ...args);
  }

  reset() {
    this.removeAllListeners();
    this.handlers.clear();
  }
}

/** Shared instance for `vi.mock("electron", ...)` factories and the tests that use them. */
export const fakeIpcMain = new FakeIpcMain();
