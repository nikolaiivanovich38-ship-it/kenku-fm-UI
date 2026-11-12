/**
 * The main-process LyreApi (WP5, wave 3 step 2) over the real library (src/main/data): it passes the same contract
 * as the in-memory fake, on a fresh library seeded from the prototype's sample data, with real files for imports
 * and relinking. In the app it runs in the library's utility process (libraryProcess.ts); here in-process, for speed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { MessageChannel, type MessagePort } from "worker_threads";

import { lyreApiContract, valueOf, type ContractFixture } from "../../common/lyre/contract";
import { lyreApiOverPort, serveLyreApi, type PortLike } from "../../common/lyre/rpc";
import { prototypeSeed } from "../../common/lyre/seed";
import { LEGACY_CATCH_UP_JOB, LibraryBusyError, NotFoundError, ValidationError, catchUpLegacyLibrary, importLegacyLibrary, openLibrary, type PeakReader } from "../data";
import { createLibraryApi, refusalFor, type LibraryHost } from "./libraryApi";
import { seedLibrary } from "./seedLibrary";

/** A host with no person to ask: choosers answer what the test says. */
function testHost(over: Partial<LibraryHost> = {}): LibraryHost {
  return { chooseFiles: async () => null, chooseFolder: async () => null, showItemInFolder: () => undefined, chooseSaveFile: async () => null, chooseLyreFile: async () => null, ...over };
}

async function seededLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-api-"));
  const library = openLibrary({ folder: path.join(dir, "library") });
  await seedLibrary(library, prototypeSeed());
  const write = (relative: string) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `not really audio: ${relative}`);
    return file;
  };
  return { dir, library, write };
}

/** Stands in for ffmpeg in the contract: the fixture's files are not really audio (ffmpegPeaks.test.ts runs the real one). */
const madeUpPeakReader: PeakReader = { read: async (file) => Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + file.length) % 256) };

async function contractFixture(): Promise<ContractFixture> {
  const { dir, library, write } = await seededLibrary();
  fs.mkdirSync(path.join(dir, "watch"));
  const api = createLibraryApi(library, testHost(), { peakReader: madeUpPeakReader });
  return {
    api,
    newAudioFiles: [write("in/Ambience/harbour_night.wav"), write("in/Dune/02 Leaving Caladan.flac")],
    notAudioFile: write("in/notes.txt"),
    missingTrackId: "t43",
    relinkFolder: path.dirname(write("moved/07 Memories of Mother.flac")),
    folderToWatch: path.join(dir, "watch"),
    transferFiles: { saveTo: path.join(dir, "Shared", "The Sunken Crown.lyre"), notLyreFile: write("Shared/photo.jpg") },
    failNextWrite: () => api.failNextWrite(),
    close: () => {
      api.stopBackgroundWork();
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

lyreApiContract("main-process LyreApi over the library", contractFixture);

/** As in the app: the library serves the API over a port (libraryProcess.ts) and the main process calls through it. */
lyreApiContract("main-process LyreApi over the library, across a message port", async () => {
  const fixture = await contractFixture();
  const { port1, port2 } = new MessageChannel();
  const wrap = (port: MessagePort): PortLike => ({
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      port.on("message", listener);
      return () => port.off("message", listener);
    },
  });
  const server = serveLyreApi(fixture.api, wrap(port1));
  const client = lyreApiOverPort(wrap(port2));
  return {
    ...fixture,
    api: client.api,
    close: async () => {
      client.close();
      server.close();
      port1.close();
      port2.close();
      await fixture.close?.();
    },
  };
});

describe("main-process LyreApi only", () => {
  it("DAT-15: measures every track not measured yet in the background, a while after it starts, and says so", async () => {
    const { dir, library, write } = await seededLibrary();
    const file = write("new/Bells.wav");
    // t43 is one of the three new sample tracks, not measured yet; its file is put where the library finds it.
    const added = { id: "t43" };
    library.store.changeWithoutHistory(() => library.store.run("UPDATE tracks SET root_id = NULL, path = ? WHERE id = ?", file, added.id));
    const measured: string[] = [];
    const api = createLibraryApi(library, testHost(), {
      peakReader: madeUpPeakReader,
      loudnessReader: { measure: async (f) => (measured.push(f), { lufs: -19.5, truePeakDb: -4 }) },
      loudnessSweepAfterMs: 10,
    });
    const events: string[][] = [];
    api.subscribe((e) => e.type === "changed" && events.push(e.areas));
    try {
      await vi.waitFor(() => expect(measured).toContain(file), { timeout: 3000 });
      await vi.waitFor(async () => expect((await api.library.listTracks()).find((t) => t.id === added.id)?.loudness).toEqual({ lufs: -19.5, truePeakDb: -4 }));
      await vi.waitFor(() => expect(events).toContainEqual(["peaks"]));
    } finally {
      api.stopBackgroundWork();
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("asks its host for files and folders, and to open a track's folder", async () => {
    const { dir, library, write } = await seededLibrary();
    const files = [write("pick/01 One.flac")];
    const shown: string[] = [];
    const api = createLibraryApi(library, testHost({ chooseFiles: async () => files, chooseFolder: async () => path.join(dir, "pick"), showItemInFolder: (p) => shown.push(p) }));
    expect(valueOf(await api.import.start({ from: "choose-files" })).added).toHaveLength(1);
    const again = valueOf(await api.import.start({ from: "choose-folder" }));
    expect(again.alreadyInLibrary).toHaveLength(1);
    const id = again.alreadyInLibrary[0];
    valueOf(await api.library.showInFolder(id));
    expect(shown).toEqual([files[0]]);
    const closed = createLibraryApi(library, testHost());
    expect(valueOf(await closed.import.start({ from: "choose-files" }))).toMatchObject({ cancelled: true, trackIds: [] });
    expect(valueOf(await closed.import.watchFolder({ from: "choose-folder" }))).toBeNull();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("DAT-13: a seeded library has the sample tracks' peaks, so it suggests the prototype's shapes", async () => {
    const { dir, library } = await seededLibrary();
    const api = createLibraryApi(library, testHost());
    const seed = prototypeSeed();
    expect((await api.library.listTracks()).map((t) => [t.id, t.suggestedShape])).toEqual(seed.tracks.map((t) => [t.id, t.suggestedShape]));
    expect(await api.library.peaksOf("t02")).toEqual(seed.peaks.t02);
    expect((await api.library.search({ text: "", shapes: ["peaksThenFalls"], limit: 100 })).trackIds).toContain("t02");
    // Security review w4 (could): words and a Shape together. The words asked the data layer for 100,000 results,
    // which it refuses (at most 1,000), so this threw.
    const lists = await api.library.listTracks();
    const steady = new Set(lists.filter((t) => (t.shape ?? t.suggestedShape) === "steady").map((t) => t.id));
    const words = (await api.library.search({ text: "the", limit: 1000 })).trackIds;
    const both = await api.library.search({ text: "the", shapes: ["steady"], limit: 3 });
    expect(both.total).toBe(words.filter((id) => steady.has(id)).length);
    expect(both.total).toBeGreaterThan(3);
    expect(both.trackIds).toEqual(words.filter((id) => steady.has(id)).slice(0, 3));
    // A lane narrows a Shape search too.
    const ambience = await api.library.search({ text: "", shapes: ["steady"], lane: "amb", limit: 100 });
    expect(ambience.trackIds.length).toBeGreaterThan(0);
    expect(ambience.trackIds.every((id) => lists.find((t) => t.id === id)?.kind === "amb" && steady.has(id))).toBe(true);
    api.stopBackgroundWork();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("turns the library's errors into refusals in plain words, and passes on faults", () => {
    expect(refusalFor(new ValidationError("name", "name cannot be empty."))).toEqual({ code: "invalid", message: "name cannot be empty.", field: "name" });
    expect(refusalFor(new NotFoundError("playlist", "p1")).code).toBe("not-found");
    expect(refusalFor(new LibraryBusyError("Tag 5,000 tracks"))).toMatchObject({ code: "busy", message: expect.stringContaining("Tag 5,000 tracks") });
    expect(refusalFor(new Error("disk I/O error"))).toBeNull();
  });

  it("keeps a session's number in step with its place, from the campaign's first session number", async () => {
    const { dir, library } = await seededLibrary();
    const api = createLibraryApi(library, testHost());
    valueOf(await api.sessions.move("crown", "s12", 3));
    expect((await api.campaigns.get("crown")).sessions.map((s) => [s.id, s.number])).toEqual([["s13", 12], ["s14", 13], ["s15", 14], ["s12", 15]]);
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("relinking only what the library planned (security review 4)", () => {
    async function planned() {
      const { dir, library, write } = await seededLibrary();
      const folder = path.dirname(write("moved/07 Memories of Mother.flac"));
      const api = createLibraryApi(library, testHost());
      const plan = valueOf(await api.import.planRelink({ from: "path", path: folder }));
      const match = plan.matches.find((m) => m.trackId === "t43");
      const done = () => {
        library.close();
        fs.rmSync(dir, { recursive: true, force: true });
      };
      return { dir, library, api, match, done };
    }
    const pathOf = (library: ReturnType<typeof openLibrary>, id: string) => library.store.get<{ path: string | null }>("SELECT path FROM tracks WHERE id = ?", id)?.path;

    it("refuses a match the plan did not offer, and changes nothing", async () => {
      const { library, api, done } = await planned();
      const before = pathOf(library, "t43");
      const answer = await api.import.applyRelink([{ trackId: "t43", to: "/etc/passwd" }]);
      expect(answer).toMatchObject({ ok: false, refusal: { code: "invalid" } });
      expect((answer as { refusal: { message: string } }).refusal.message).toMatch(/Look for the missing files again/);
      expect(pathOf(library, "t43")).toBe(before);
      done();
    });

    it("applies a planned match once, keeping the file's facts; the plan is then used up", async () => {
      const { library, api, match, done } = await planned();
      valueOf(await api.import.applyRelink([{ trackId: match.trackId, to: match.to }]));
      const row = library.store.get<{ file_size: number | null }>("SELECT file_size FROM tracks WHERE id = 't43'");
      expect(row?.file_size).toBe(fs.statSync(match.to).size);
      expect(await api.import.applyRelink([{ trackId: match.trackId, to: match.to }])).toMatchObject({ ok: false, refusal: { code: "invalid" } });
      done();
    });

    it("refuses an old plan's match after the library has started again (the plan is not kept)", async () => {
      const { library, match, done } = await planned();
      const restarted = createLibraryApi(library, testHost());
      expect(await restarted.import.applyRelink([{ trackId: match.trackId, to: match.to }])).toMatchObject({ ok: false, refusal: { code: "invalid" } });
      done();
    });
  });
});

describe("FND-16 (0.5.1): What came across, as the old window and player go", () => {
  const oldPlayer = (playlists: Record<string, { title: string; tracks: string[] }>, tracks: Record<string, { url: string; title: string }>) =>
    JSON.stringify({
      playlists: JSON.stringify({
        playlists: { byId: Object.fromEntries(Object.entries(playlists).map(([id, p]) => [id, { id, background: "", ...p }])), allIds: Object.keys(playlists) },
        tracks: Object.fromEntries(Object.entries(tracks).map(([id, t]) => [id, { id, ...t }])),
      }),
      soundboards: JSON.stringify({ soundboards: { byId: {}, allIds: [] }, sounds: {} }),
    });

  it("lists the old bookmarks, what came across later, and the tracks that are only a web address", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-moved-"));
    const library = openLibrary({ folder: path.join(dir, "library") });
    const api = createLibraryApi(library, testHost());
    try {
      expect(await api.transfer.movedReport()).toBeNull();
      const lute = { url: "https://example.com/lute.mp3", title: "Lute" };
      await importLegacyLibrary(library, oldPlayer({ p1: { title: "Tavern", tracks: ["x1"] } }, { x1: lute }));
      // An older Lyre made the first move (no catch-up record); the old player has gained a playlist since.
      library.store.run("DELETE FROM library_jobs WHERE name = ?", LEGACY_CATCH_UP_JOB);
      await catchUpLegacyLibrary(library, oldPlayer({ p1: { title: "Tavern", tracks: ["x1"] }, p2: { title: "Road", tracks: ["x2"] } }, { x1: lute, x2: { url: "https://example.com/cart.mp3", title: "Cart" } }));
      fs.writeFileSync(
        path.join(dir, "library", "old-window.json"),
        JSON.stringify({ movedAt: 5, bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/", folder: "Ambience" }], tokenMoved: false, tokenNoteSeen: false }),
      );
      const report = await api.transfer.movedReport();
      expect(report?.copied.map((r) => [r.what, r.count, r.nowIn])).toEqual([
        ["Playlists", 1, "Playlists (Manual)"],
        ["Tracks", 1, "Library"],
        ["Soundboards", 0, "Pad boards"],
        ["Sounds", 0, "Pads on those boards"],
        ["Bookmarks", 1, "Listed to copy"],
      ]);
      expect(report?.bookmarks).toEqual([{ title: "Tabletop Audio", url: "https://tabletopaudio.com/", folder: "Ambience" }]);
      expect(report?.later?.lines[0]).toMatch(/Brought in 1 playlist added in the old player since your first start: Road\./);
      expect(report?.webOnly).toEqual([
        { id: "x1", title: "Lute", url: "https://example.com/lute.mp3" },
        { id: "x2", title: "Cart", url: "https://example.com/cart.mp3" },
      ]);
    } finally {
      api.stopBackgroundWork();
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows what came across later when its only news is a file it left out (CR51-11)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-moved-"));
    const library = openLibrary({ folder: path.join(dir, "library") });
    const api = createLibraryApi(library, testHost());
    try {
      const lute = { url: "https://example.com/lute.mp3", title: "Lute" };
      await importLegacyLibrary(library, oldPlayer({ p1: { title: "Tavern", tracks: ["x1"] } }, { x1: lute }));
      library.store.run("DELETE FROM library_jobs WHERE name = ?", LEGACY_CATCH_UP_JOB);
      const planted = { url: `file://${path.join(dir, "elsewhere", "planted.flac")}`, title: "Planted" };
      await catchUpLegacyLibrary(library, oldPlayer({ p1: { title: "Tavern", tracks: ["x1", "x9"] } }, { x1: lute, x9: planted }));
      const report = await api.transfer.movedReport();
      expect(report?.later?.lines.join(" ")).toMatch(/1 file was left out because it is in a folder your library does not use: planted\.flac\./);
    } finally {
      api.stopBackgroundWork();
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the bookmarks alone for someone whose old player was empty", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-moved-"));
    const library = openLibrary({ folder: path.join(dir, "library") });
    const api = createLibraryApi(library, testHost());
    try {
      fs.writeFileSync(path.join(dir, "library", "old-window.json"), JSON.stringify({ movedAt: 7, bookmarks: [{ title: "YouTube", url: "https://www.youtube.com/" }], tokenMoved: false, tokenNoteSeen: false }));
      const report = await api.transfer.movedReport();
      expect(report).toMatchObject({ at: 7, copied: [{ what: "Bookmarks", count: 1 }], later: null, webOnly: [] });
    } finally {
      api.stopBackgroundWork();
      library.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
