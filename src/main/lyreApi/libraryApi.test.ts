/**
 * The main-process LyreApi (WP5, wave 3 step 2) over the real library (src/main/data): it passes the same contract
 * as the in-memory fake, on a fresh library seeded from the prototype's sample data, with real files for imports
 * and relinking. In the app it runs in the library's utility process (libraryProcess.ts); here in-process, for speed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import { MessageChannel, type MessagePort } from "worker_threads";

import { lyreApiContract, valueOf, type ContractFixture } from "../../common/lyre/contract";
import { lyreApiOverPort, serveLyreApi, type PortLike } from "../../common/lyre/rpc";
import { prototypeSeed } from "../../common/lyre/seed";
import { LibraryBusyError, NotFoundError, ValidationError, openLibrary, type PeakReader } from "../data";
import { createLibraryApi, refusalFor, type LibraryHost } from "./libraryApi";
import { seedLibrary } from "./seedLibrary";

/** A host with no person to ask: choosers answer what the test says. */
function testHost(over: Partial<LibraryHost> = {}): LibraryHost {
  return { chooseFiles: async () => null, chooseFolder: async () => null, showItemInFolder: () => undefined, ...over };
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
