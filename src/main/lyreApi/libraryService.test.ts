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
import { findBundledFfmpeg } from "../media/bundledFfmpeg";
import { wavBytes, writeFile } from "../media/testing/wavFiles";
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

function service(
  options: { open?: (folder: string) => ReturnType<typeof openLibrary>; seed?: boolean; host?: Record<string, (...a: unknown[]) => unknown>; ffmpegPath?: string | null } = {},
) {
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
    ffmpegPath: options.ffmpegPath ?? null,
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

  it("names the folders library files may be played from: library folders, and the folders of files outside them", async () => {
    const { s } = service();
    s.start();
    expect(await s.mediaFolders()).toEqual(["H:\\Audio\\Scores", "H:\\Audio\\Ambience", "H:\\Audio\\Effects"]);
    const dir = tempFolder();
    fs.mkdirSync(path.join(dir, "Lute"));
    fs.writeFileSync(path.join(dir, "Lute", "01 Lute.flac"), "x");
    await call(s, "import", "start", { from: "paths", paths: [path.join(dir, "Lute", "01 Lute.flac")] });
    expect(await s.mediaFolders()).toContain(path.join(dir, "Lute"));
    await s.stop();
  });

  it("gives new tracks their file-tag title, artist, album and length (DAT-5, music-metadata in the library's process)", async () => {
    const { s } = service();
    s.start();
    const dir = tempFolder();
    const file = writeFile(dir, "07 tavern.wav", wavBytes({ seconds: 1.5 }, { title: "Tavern Warmth", artist: "The Lute Guild", album: "Inns of the North" }));
    const imported = (await call(s, "import", "start", { from: "paths", paths: [file] })) as { value: { trackIds: string[] } };
    const tracks = (await call(s, "library", "listTracks")) as { id: string }[];
    expect(tracks.find((t) => t.id === imported.value.trackIds[0])).toMatchObject({
      metaTitle: "Tavern Warmth",
      artist: "The Lute Guild",
      album: "Inns of the North",
      durationMs: 1500,
    });
    await s.stop();
  });

  it("works out new tracks' loudness peaks with the ffmpeg it is given, and says when they are ready", async () => {
    const { s, events } = service({ ffmpegPath: findBundledFfmpeg(process.cwd()) });
    s.start();
    const file = writeFile(tempFolder(), "swell.wav", wavBytes({ seconds: 2, level: (t) => t / 2 }));
    const imported = (await call(s, "import", "start", { from: "paths", paths: [file] })) as { value: { added: string[] } };
    await vi.waitFor(() => expect(events).toContainEqual({ type: "changed", areas: ["peaks"] }), { timeout: 5000 });
    const levels = (await call(s, "library", "peaksOf", imported.value.added[0])) as number[];
    expect(levels).toHaveLength(1000);
    expect(levels[0]).toBeLessThan(levels[999]);
    await s.stop();
  });

  it("answers no peaks when it has no ffmpeg (a damaged install), and keeps working", async () => {
    const { s } = service({ ffmpegPath: null });
    s.start();
    const file = writeFile(tempFolder(), "swell.wav", wavBytes({ seconds: 1 }));
    const imported = (await call(s, "import", "start", { from: "paths", paths: [file] })) as { value: { added: string[] } };
    expect(await call(s, "library", "peaksOf", imported.value.added[0])).toBeNull();
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

/**
 * A library process played by a script (review 1): it answers each control request after `delayMs`, echoing the
 * request's id, and can be told to stop instead of answering the folder list.
 */
class ScriptedChild extends EventEmitter implements LibraryChild {
  static made = 0;
  readonly id = ++ScriptedChild.made;
  constructor(private readonly script: { dieOnFolders?: (child: ScriptedChild) => boolean; folders?: () => string[]; silent?: boolean } = {}) {
    super();
  }
  postMessage(m: { t?: string; id?: number }) {
    setTimeout(() => {
      if (m.t === "init") this.emit("message", { t: "ready" });
      if (m.t === "media-folders" && !this.script.silent) {
        if (this.script.dieOnFolders?.(this)) this.emit("exit", 134);
        else this.emit("message", { t: "media-folders", id: m.id, folders: this.script.folders?.() ?? ["C:/Music"] });
      }
      if (m.t === "close") this.emit("message", { t: "closed", id: m.id });
    }, 5);
  }
  kill() {
    return true;
  }
}

/** Resolves to the promise's outcome, or "pending" when it has not settled within `ms`. */
function settledWithin<T>(promise: Promise<T>, ms = 300): Promise<{ value: T } | { error: string } | "pending"> {
  return Promise.race([
    promise.then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
}

describe("LyreLibraryService control requests (security review 1)", () => {
  it("answers every one of two overlapping folder requests", async () => {
    const s = new LyreLibraryService({ fork: () => new ScriptedChild(), folder: "x", host: {}, onEvent: () => undefined });
    s.start();
    const first = s.mediaFolders();
    const second = s.mediaFolders();
    expect(await settledWithin(first)).toEqual({ value: ["C:/Music"] });
    expect(await settledWithin(second)).toEqual({ value: ["C:/Music"] });
  });

  it("fails a request still waiting when the library's process stops, and every request once it has given up", async () => {
    const events: LyreEvent[] = [];
    const s = new LyreLibraryService({
      fork: () => new ScriptedChild({ dieOnFolders: () => true }),
      folder: "x",
      host: {},
      onEvent: (event) => events.push(event),
      restartDelayMs: 10,
    });
    s.start();
    const backAgain = () => events.filter((e) => e.type === "library-status" && e.ok).length;
    expect(await settledWithin(s.mediaFolders())).toEqual({ error: STARTING_AGAIN });
    await vi.waitFor(() => expect(backAgain()).toBe(1));
    expect(await settledWithin(s.mediaFolders())).toEqual({ error: STARTING_AGAIN });
    await vi.waitFor(() => expect(backAgain()).toBe(2));
    expect(await settledWithin(s.mediaFolders())).toEqual({ error: GAVE_UP });
    expect(events).toContainEqual({ type: "library-status", ok: false, message: GAVE_UP });
    expect(await settledWithin(s.mediaFolders())).toEqual({ error: GAVE_UP });
  });

  it("fails requests still waiting when it is stopped", async () => {
    const s = new LyreLibraryService({ fork: () => new ScriptedChild({ silent: true }), folder: "x", host: {}, onEvent: () => undefined });
    s.start();
    const waiting = s.mediaFolders();
    await new Promise((r) => setTimeout(r, 20));
    await s.stop(50);
    expect(await settledWithin(waiting)).toEqual({ error: "Lyre's library is closed." });
  });
});
