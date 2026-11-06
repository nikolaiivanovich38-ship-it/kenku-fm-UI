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
  options: {
    open?: (folder: string) => ReturnType<typeof openLibrary>;
    seed?: boolean;
    host?: Record<string, (...a: unknown[]) => unknown>;
    ffmpegPath?: string | null;
    folder?: string;
    offerRestore?: (words: string) => Promise<boolean>;
  } = {},
) {
  const folder = options.folder ?? tempFolder();
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
    offerRestore: options.offerRestore,
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
    const lute = writeFile(path.join(dir, "Lute"), "01 Lute.wav", wavBytes({ seconds: 0.5 }));
    await call(s, "import", "start", { from: "paths", paths: [lute] });
    expect(await s.mediaFolders()).toContain(path.join(dir, "Lute"));
    await s.stop();
  });

  it("names the one file Find missing files asks to check beside the folders, once asked, until it closes (security review w4, Should 5; SEC-17)", async () => {
    const { s } = service();
    s.start();
    const castamere = "E:\\Music\\Scores\\Ramin Djawadi\\Game of Thrones, Season 3\\18 The Rains of Castamere.flac";
    expect(await s.mediaFolders()).not.toContain(castamere);
    await call(s, "import", "planRelink", { from: "path", path: "E:\\Music\\Scores" });
    expect(await s.mediaFolders()).not.toContain(castamere);
    await call(s, "import", "previewFound", "t26");
    expect(await s.mediaFolders()).toEqual(["H:\\Audio\\Scores", "H:\\Audio\\Ambience", "H:\\Audio\\Effects", castamere]);
    await call(s, "import", "endRelinkPreview");
    expect(await s.mediaFolders()).not.toContain(castamere);
    await call(s, "import", "planRelink", { from: "path", path: "E:\\Music\\Scores" });
    await call(s, "import", "previewFound", "t26");
    await call(s, "import", "planRelink", { from: "path", path: "E:\\Elsewhere" });
    expect(await s.mediaFolders()).not.toContain(castamere);
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

  it("saves a .lyre file only where the save dialog says, never at a path the page names (security review w4)", async () => {
    const dir = tempFolder();
    const chosen = path.join(dir, "Chosen.lyre");
    const chooseSaveFile = vi.fn(async () => chosen);
    const { s } = service({ seed: false, host: { chooseSaveFile } });
    s.start();
    const named = path.join(dir, "Named by the page.lyre");
    expect(await call(s, "transfer", "save", { scope: { kind: "library" }, includeAudio: false, path: named })).toMatchObject({ ok: true, value: { path: chosen } });
    expect(chooseSaveFile).toHaveBeenCalled();
    expect(fs.existsSync(named)).toBe(false);
    expect(fs.existsSync(chosen)).toBe(true);
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
    expect(events).toContainEqual({ type: "library-status", ok: false, message: expect.stringMatching(/^Your library file is damaged and cannot be opened\. No backup was found to put back\./) });
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

describe("a damaged library offers its latest backup (security review 8)", () => {
  /** A library folder with one backup holding a board named "Kept", then a library file that is not a database. */
  async function damagedWithBackup() {
    const folder = tempFolder();
    const library = openLibrary({ folder });
    const { seedLibrary } = await import("./seedLibrary");
    const { prototypeSeed } = await import("../../common/lyre/seed");
    await seedLibrary(library, prototypeSeed());
    library.store.changeWithoutHistory(() => library.store.run("UPDATE boards SET title = 'Kept' WHERE id = 'combat'"));
    await library.backupNow();
    library.close();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(path.join(folder, `library.sqlite${suffix}`), { force: true });
    fs.writeFileSync(path.join(folder, "library.sqlite"), "this is not a database ".repeat(200));
    return folder;
  }

  it("asks in plain words, puts the backup back when told to, keeps the damaged file, and works again", async () => {
    const folder = await damagedWithBackup();
    const offers: string[] = [];
    const { s, events } = service({ folder, seed: false, offerRestore: async (words) => (offers.push(words), true) });
    s.start();
    await vi.waitFor(() => expect(events).toContainEqual({ type: "library-status", ok: true, message: BACK_AGAIN }), { timeout: 5000 });
    expect(offers[0]).toMatch(/damaged/);
    const boards = (await call(s, "boards", "list")) as { id: string; name: string }[];
    expect(boards.find((b) => b.id === "combat")?.name).toBe("Kept");
    expect(fs.readdirSync(folder).some((name) => name.startsWith("library-damaged-"))).toBe(true);
    await s.stop();
  });

  it("leaves everything as it is when the game master says not now", async () => {
    const folder = await damagedWithBackup();
    const { s, events } = service({ folder, seed: false, offerRestore: async () => false });
    s.start();
    await vi.waitFor(() => expect(events.some((e) => e.type === "library-status" && !e.ok)).toBe(true));
    await new Promise((r) => setTimeout(r, 100));
    await expect(call(s, "boards", "list")).rejects.toThrow(/damaged/);
    expect(fs.readdirSync(folder).some((name) => name.startsWith("library-damaged-"))).toBe(false);
  });

  it("stops using a library the background check finds damaged, and offers the backup", async () => {
    const folder = tempFolder();
    const backups = path.join(folder, "backups");
    const offers: string[] = [];
    const open = (f: string) => {
      const library = openLibrary({ folder: f });
      return {
        ...library,
        checkIntegrity: async () => ({ status: "corrupt" as const, error: new LibraryDatabaseError("corrupt", "Your library file is damaged and cannot be opened.", { latestBackup: null }) }),
      };
    };
    const { s, events } = service({ folder, open, offerRestore: async (words) => (offers.push(words), false) });
    s.start();
    await vi.waitFor(() => expect(events.some((e) => e.type === "library-status" && !e.ok)).toBe(true), { timeout: 5000 });
    await expect(call(s, "boards", "list")).rejects.toThrow(/damaged/);
    // No backup yet: nothing to offer, and the words say so.
    expect(offers).toEqual([]);
    expect(events.find((e) => e.type === "library-status" && !e.ok)).toMatchObject({ message: expect.stringMatching(/No backup/) });
    void backups;
  });
});
