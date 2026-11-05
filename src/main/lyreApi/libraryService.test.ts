/**
 * The library's own process and the main process's side of it (DB review 1): calls wait for the library to open,
 * events reach the page, host work is done by the main side, a crash is announced and the library starts again,
 * a damaged library is reported in plain words, the old player's library comes in once, and closing is clean.
 * The utility process is played by the real process core (libraryProcessCore.ts) on a MessageChannel.
 */
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { MessageChannel } from "worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LyreEvent } from "../../common/lyre/api";
import { LibraryDatabaseError, openLibrary } from "../data";
import { runLibraryProcess } from "./libraryProcessCore";
import { BACK_AGAIN, GAVE_UP, LyreLibraryService, STARTING_AGAIN, type LibraryChild } from "./libraryService";

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});
function tempFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-service-"));
  dirs.push(dir);
  return dir;
}

/** A library process on a MessageChannel that a test can make crash, as Electron's UtilityProcess behaves. */
class FakeChild extends EventEmitter implements LibraryChild {
  private readonly main;
  readonly done: Promise<void>;
  exited = false;
  constructor(open?: (folder: string) => ReturnType<typeof openLibrary>) {
    super();
    const { port1, port2 } = new MessageChannel();
    this.main = port2;
    port2.on("message", (message) => this.emit("message", message));
    this.done = runLibraryProcess(
      { postMessage: (m) => port1.postMessage(m), onMessage: (l) => (port1.on("message", l), () => port1.off("message", l)) },
      { open, log: () => undefined },
    ).done;
    this.done.then(() => this.exit(0));
  }
  postMessage(message: unknown) {
    if (!this.exited) this.main.postMessage(message);
  }
  kill() {
    this.exit(1);
    return true;
  }
  /** The process stops by itself (a crash). */
  crash() {
    this.exit(134);
  }
  private exit(code: number) {
    if (this.exited) return;
    this.exited = true;
    this.main.close();
    this.emit("exit", code);
  }
}

function service(options: { open?: (folder: string) => ReturnType<typeof openLibrary>; seed?: boolean; host?: Record<string, (...a: unknown[]) => unknown> } = {}) {
  const folder = tempFolder();
  const children: FakeChild[] = [];
  const events: LyreEvent[] = [];
  const s = new LyreLibraryService({
    fork: () => {
      const child = new FakeChild(options.open);
      children.push(child);
      return child;
    },
    folder,
    seed: options.seed ?? true,
    host: options.host ?? {},
    onEvent: (event) => events.push(event),
    restartDelayMs: 10,
    maxCrashes: 3,
  });
  return { s, children, events, folder };
}
const call = (s: LyreLibraryService, area: string, method: string, ...args: unknown[]) => s.call(area, method, args);

describe("LyreLibraryService", () => {
  it("lets calls wait for the library to open, and passes its change events on", async () => {
    const { s, events } = service();
    s.start();
    expect((await call(s, "library", "listTracks")) as unknown[]).toHaveLength(69);
    await call(s, "boards", "rename", "combat", "Fight");
    await vi.waitFor(() => expect(events).toContainEqual({ type: "changed", areas: ["boards", "history"] }));
    await s.stop();
  });

  it("does the host work the library asks for in the main process", async () => {
    const chooseFiles = vi.fn(async () => null);
    const { s } = service({ host: { chooseFiles } });
    s.start();
    expect(await call(s, "import", "start", { from: "choose-files" })).toMatchObject({ ok: true, value: { cancelled: true } });
    expect(chooseFiles).toHaveBeenCalled();
    await s.stop();
  });

  it("says plainly when the library stops, starts it again, and the library is as it was saved", async () => {
    const { s, children, events } = service();
    s.start();
    await call(s, "boards", "rename", "combat", "Fight");
    children[0].crash();
    await expect(call(s, "boards", "list")).rejects.toThrow(STARTING_AGAIN);
    expect(events).toContainEqual({ type: "library-status", ok: false, message: STARTING_AGAIN });
    await vi.waitFor(() => expect(events).toContainEqual({ type: "library-status", ok: true, message: BACK_AGAIN }));
    const boards = (await call(s, "boards", "list")) as { id: string; name: string }[];
    expect(boards.find((b) => b.id === "combat").name).toBe("Fight");
    expect(children).toHaveLength(2);
    await s.stop();
  });

  it("stops trying after the library keeps stopping, and says what to do", async () => {
    const { s, children, events } = service();
    s.start();
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(children).toHaveLength(i + 1));
      await call(s, "history", "state").catch((): void => undefined);
      children[i].crash();
    }
    await vi.waitFor(() => expect(events).toContainEqual({ type: "library-status", ok: false, message: GAVE_UP }));
    await new Promise((r) => setTimeout(r, 40));
    expect(children).toHaveLength(3);
    await expect(call(s, "boards", "list")).rejects.toThrow(GAVE_UP);
  });

  it("reports a library it cannot open in plain words, without starting again and again", async () => {
    const { s, children, events } = service({
      open: () => {
        throw new LibraryDatabaseError("corrupt", "Your library file is damaged and cannot be opened.");
      },
    });
    s.start();
    await expect(call(s, "boards", "list")).rejects.toThrow("damaged");
    expect(events).toContainEqual({ type: "library-status", ok: false, message: "Your library file is damaged and cannot be opened." });
    expect(children).toHaveLength(1);
  });

  it("brings the old player's library in once, and closes cleanly", async () => {
    const { s, children, events } = service({ seed: false });
    s.start();
    const raw = JSON.stringify({
      playlists: JSON.stringify({
        playlists: { byId: { p1: { id: "p1", title: "Tavern", background: "", tracks: ["x1"] } }, allIds: ["p1"] },
        tracks: { x1: { id: "x1", url: "https://example.com/lute.mp3", title: "Lute" } },
      }),
      soundboards: JSON.stringify({ soundboards: { byId: {}, allIds: [] }, sounds: {} }),
    });
    expect((await s.bringInOldLibrary(raw)).status).toBe("moved");
    expect(events).toContainEqual(expect.objectContaining({ type: "changed" }));
    expect(((await call(s, "playlists", "list")) as { name: string }[]).map((p) => p.name)).toContain("Tavern");
    expect((await s.bringInOldLibrary(raw)).status).toBe("already-done");
    await s.stop();
    expect(children[0].exited).toBe(true);
    await expect(call(s, "boards", "list")).rejects.toThrow();
  });
});
