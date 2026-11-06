/**
 * Security review of wave 4 (reviews/w4-review.md), DAT-7: a .lyre file comes from someone else, so Lyre treats it as
 * hostile. These tests are the review's probes (lyre.probe.ts) made into checks.
 * - Must 1: bringing a file in writes nothing but audio. Only entries with an audio extension whose first bytes are
 *   that format are unpacked; the unpacked file's extension comes from the entry, never from the track's file name.
 * - Should 2: one audio part named by many tracks is unpacked once; the parts' sizes must fit inside the file.
 * - Should 3: bringing in many playlists, boards and campaigns takes linear time, in batches.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { crc32 } from "zlib";
import { afterEach, describe, expect, it } from "vitest";

import { isRefused, type LyreApi, type OpenedFile, type WriteResult } from "../../common/lyre/api";
import { valueOf } from "../../common/lyre/contract";
import { openLibrary, type Library } from "../data";
import { AUDIO_EXTENSIONS } from "../data/import/audioFiles";
import { createLibraryApi, type LibraryHost, type LibraryApiOptions } from "../lyreApi/libraryApi";
import { looksLikeAudio } from "./audioBytes";
import { writeZip } from "./zip";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const host: LibraryHost = { chooseFiles: async () => null, chooseFolder: async () => null, showItemInFolder: () => undefined, chooseSaveFile: async () => null, chooseLyreFile: async () => null };

interface Rig {
  dir: string;
  brought: string;
  library: Library;
  api: LyreApi & { stopBackgroundWork(): void };
}

function rig(transfer: LibraryApiOptions["transfer"] = {}): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-hostile-"));
  const library = openLibrary({ folder: path.join(dir, "library") });
  const brought = path.join(dir, "Brought in");
  const api = createLibraryApi(library, host, { transfer: { broughtInFolder: brought, ...transfer } });
  cleanups.push(() => {
    api.stopBackgroundWork();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, brought, library, api };
}

const track = (i: number, over: Record<string, unknown> = {}) => ({ id: `t${i}`, kind: "music", title: `T${i}`, metaTitle: "", fileName: `a${i}.mp3`, durationMs: 1000 + i * 2000, role: null, loop: null, energy: null, tags: {}, profile: null, shape: null, artist: "", album: "", folder: "", notes: "", sizeBytes: null, ...over });
const manifest = (audio: unknown[]) => ({ format: "lyre-library-file", version: 1, madeWith: "Lyre 0.4.0", savedAt: 1, scope: { kind: "library" }, title: "x", counts: { tracks: 0, playlists: 0, boards: 0, campaigns: 0, sessions: 0, scenes: 0, tagGroups: 0 }, audio });
const libraryJson = (o: Record<string, unknown>) => ({ tracks: [], tagGroups: [], playlists: [], boards: [], campaigns: [], overrides: {}, playOrders: {}, ...o });

async function lyreFile(dir: string, name: string, audio: unknown[], library: Record<string, unknown>, parts: { name: string; bytes: Buffer }[] = []): Promise<string> {
  const file = path.join(dir, name);
  await writeZip(file, [{ name: "lyre.json", bytes: Buffer.from(JSON.stringify(manifest(audio))), deflate: true }, { name: "library.json", bytes: Buffer.from(JSON.stringify(libraryJson(library))), deflate: true }, ...parts]);
  return file;
}

/** Every file under a folder, relative to it. */
function filesUnder(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => path.relative(folder, path.join(e.parentPath, e.name)));
}
const bytesUnder = (folder: string) => filesUnder(folder).reduce((n, f) => n + fs.statSync(path.join(folder, f)).size, 0);

async function openAndBringIn(api: LyreApi, file: string, choices = {}) {
  const opened = valueOf(await api.transfer.open({ from: "path", path: file })) as OpenedFile;
  return api.transfer.bringIn(opened.id, choices);
}

function refusal(result: WriteResult<unknown>) {
  if (!isRefused(result)) throw new Error("expected a refusal");
  return result.refusal;
}

/** The first bytes of a real file of each kind (enough for the check; the rest does not matter). */
const MP3 = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.alloc(200, 0x55)]);
const FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(200, 1)]);
const PROGRAM = Buffer.from("MZ\x90\x00 this is a Windows program, not audio", "latin1");

describe("Must 1: a .lyre file never writes anything but audio", () => {
  it("does not unpack a program under a track named .exe, .lnk or .hta, and says so", async () => {
    const { api, dir, brought } = rig();
    const tracks = [track(1, { fileName: "Session notes.pdf.exe" }), track(2, { fileName: "open me.lnk" }), track(3, { fileName: "x.hta" })];
    const file = await lyreFile(dir, "Strahd from Sam.lyre", tracks.map((t, i) => ({ entry: `audio/0000${i + 1}.mp3`, trackId: t.id, bytes: PROGRAM.length })), { tracks }, tracks.map((_, i) => ({ name: `audio/0000${i + 1}.mp3`, bytes: PROGRAM })));
    const report = valueOf(await openAndBringIn(api, file));
    expect(filesUnder(brought)).toEqual([]);
    expect(report.summary).toContain("3 audio files in it were not audio Lyre can play, so Lyre left them out.");
    expect(report.summary).not.toContain("unpacked");
    expect(report.missingFiles).toBe(3);
  });

  it("names an unpacked file with the extension of its entry, not the track's file name", async () => {
    const { api, dir, brought } = rig();
    const tracks = [track(1, { fileName: "Session notes.pdf.exe" }), track(2, { fileName: "Theme.flac" })];
    const file = await lyreFile(dir, "Sam.lyre", [{ entry: "audio/00001.mp3", trackId: "t1", bytes: MP3.length }, { entry: "audio/00002.flac", trackId: "t2", bytes: FLAC.length }], { tracks }, [{ name: "audio/00001.mp3", bytes: MP3 }, { name: "audio/00002.flac", bytes: FLAC }]);
    const report = valueOf(await openAndBringIn(api, file));
    expect(filesUnder(brought).sort()).toEqual([path.join("Sam", "Session notes.pdf.mp3"), path.join("Sam", "Theme.flac")]);
    expect((await api.library.listTracks()).map((t) => t.fileName).sort()).toEqual(["Session notes.pdf.mp3", "Theme.flac"]);
    expect(report.summary).toContain("2 audio files were unpacked next to your library.");
    expect(report.missingFiles).toBe(0);
  });

  it("does not unpack an entry without an audio extension", async () => {
    const { api, dir, brought } = rig();
    const tracks = [track(1, { fileName: "notes" })];
    const file = await lyreFile(dir, "Sam.lyre", [{ entry: "audio/00001", trackId: "t1", bytes: MP3.length }], { tracks }, [{ name: "audio/00001", bytes: MP3 }]);
    const report = valueOf(await openAndBringIn(api, file));
    expect(filesUnder(brought)).toEqual([]);
    expect(report.summary).toContain("1 audio file in it was not audio Lyre can play, so Lyre left it out.");
  });

  it("keeps a part's audio extension when a track of the same name is already there", async () => {
    const { api, dir, brought } = rig();
    const tracks = [track(1, { fileName: "Theme.exe" }), track(2, { fileName: "Theme.mp3" })];
    const file = await lyreFile(dir, "Sam.lyre", [{ entry: "audio/00001.mp3", trackId: "t1", bytes: MP3.length }, { entry: "audio/00002.mp3", trackId: "t2", bytes: MP3.length }], { tracks }, [{ name: "audio/00001.mp3", bytes: MP3 }, { name: "audio/00002.mp3", bytes: MP3 }]);
    valueOf(await openAndBringIn(api, file));
    expect(filesUnder(brought).sort()).toEqual([path.join("Sam", "Theme (2).mp3"), path.join("Sam", "Theme.mp3")]);
  });

  it("knows the first bytes of every kind of audio Lyre plays, and refuses programs, scripts and archives", () => {
    for (const ext of AUDIO_EXTENSIONS) {
      for (const head of [PROGRAM, Buffer.from("#!/bin/sh\n"), Buffer.from("PK\u0003\u0004"), Buffer.from("<html><script>"), Buffer.alloc(0)]) expect(looksLikeAudio(ext, head), `${ext} ${head.subarray(0, 4).toString("latin1")}`).toBe(false);
    }
    const heads: Record<string, Buffer> = {
      ".flac": FLAC,
      ".mp3": MP3,
      ".wav": Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ", "latin1"),
      ".ogg": Buffer.from("OggS\u0000\u0002"),
      ".oga": Buffer.from("OggS\u0000\u0002"),
      ".opus": Buffer.from("OggS\u0000\u0002"),
      ".m4a": Buffer.from("\u0000\u0000\u0000 ftypM4A ", "latin1"),
      ".aac": Buffer.from([0xff, 0xf1, 0x50, 0x80]),
      ".wma": Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]),
      ".asf": Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]),
      ".aif": Buffer.from("FORM\u0000\u0000\u0000\u0000AIFF", "latin1"),
      ".aiff": Buffer.from("FORM\u0000\u0000\u0000\u0000AIFF", "latin1"),
      ".aifc": Buffer.from("FORM\u0000\u0000\u0000\u0000AIFC", "latin1"),
      ".mka": Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]),
      ".ape": Buffer.from("MAC \u0096\u000f", "latin1"),
      ".wv": Buffer.from("wvpk"),
      ".tta": Buffer.from("TTA1"),
      ".ac3": Buffer.from([0x0b, 0x77, 0x00, 0x00]),
      ".mpc": Buffer.from("MPCK"),
    };
    expect(Object.keys(heads).sort()).toEqual([...AUDIO_EXTENSIONS].sort());
    for (const [ext, head] of Object.entries(heads)) expect(looksLikeAudio(ext, head), ext).toBe(true);
    // An MP3 without tags starts with a frame; some start after a few zero bytes.
    expect(looksLikeAudio(".mp3", Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
    expect(looksLikeAudio(".mp3", Buffer.concat([Buffer.alloc(32), Buffer.from([0xff, 0xfb, 0x90, 0x64])]))).toBe(true);
    // The extension is what Lyre looks at: FLAC bytes under .mp3 are not an MP3.
    expect(looksLikeAudio(".mp3", FLAC)).toBe(false);
    expect(looksLikeAudio(".exe", MP3)).toBe(false);
  });
});

/**
 * A zip whose central directory lists `names`, every one pointing at the same stored part (zip entries that overlap):
 * each says it holds all of `data`, so together they claim far more than the file.
 */
function overlappingZip(file: string, head: { name: string; bytes: Buffer }[], names: string[], data: Buffer) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const local = (name: Buffer, bytes: Buffer, crc: number) => {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(bytes.length, 18);
    h.writeUInt32LE(bytes.length, 22);
    h.writeUInt16LE(name.length, 26);
    return h;
  };
  const centralEntry = (name: Buffer, size: number, crc: number, at: number) => {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(at, 42);
    central.push(c, name);
  };
  for (const e of [...head, { name: names[0], bytes: data }]) {
    const name = Buffer.from(e.name);
    const crc = crc32(e.bytes) >>> 0;
    parts.push(local(name, e.bytes, crc), name, e.bytes);
    if (e.name === names[0]) names.forEach((n) => centralEntry(Buffer.from(n), e.bytes.length, crc, offset));
    else centralEntry(name, e.bytes.length, crc, offset);
    offset += 30 + name.length + e.bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(head.length + names.length, 8);
  end.writeUInt16LE(head.length + names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, directory, end]));
}

describe("Should 2: a file cannot make Lyre write more than it holds", () => {
  const FIVE_MB = Buffer.concat([MP3, Buffer.alloc(5 * 1024 * 1024 - MP3.length, 7)]);

  it("unpacks one audio part named by 200 tracks once (the review's 5 MB file that wrote 1 GB), shared by them", async () => {
    const { api, dir, brought } = rig();
    const tracks = Array.from({ length: 200 }, (_, i) => track(i));
    const playlist = { id: "p", name: "All of them", lane: "music", notes: "", order: null, kind: "manual", trackIds: tracks.map((t) => t.id) };
    const file = await lyreFile(dir, "amp.lyre", tracks.map((t) => ({ entry: "audio/00001.mp3", trackId: t.id, bytes: FIVE_MB.length })), { tracks, playlists: [playlist] }, [{ name: "audio/00001.mp3", bytes: FIVE_MB }]);
    const report = valueOf(await openAndBringIn(api, file, { all: "keepBoth" }));
    expect(bytesUnder(brought)).toBeLessThanOrEqual(fs.statSync(file).size);
    expect(filesUnder(brought)).toEqual([path.join("amp", "a0.mp3")]);
    const [only] = await api.library.listTracks();
    expect((await api.library.listTracks()).length).toBe(1);
    expect((await api.playlists.list()).find((p) => p.name === "All of them")).toMatchObject({ trackIds: [only.id] });
    expect(report.summary).toContain("1 audio file was unpacked next to your library.");
    expect(report.summary).toContain("199 tracks in it used the same audio file as another track, so Lyre brought them in as that track.");
  });

  it("refuses a file whose audio parts overlap: together they say they hold more than the file", async () => {
    const { api, dir, brought } = rig();
    const tracks = Array.from({ length: 200 }, (_, i) => track(i));
    const names = tracks.map((_, i) => `audio/${String(i + 1).padStart(5, "0")}.mp3`);
    const file = path.join(dir, "overlap.lyre");
    overlappingZip(file, [
      { name: "lyre.json", bytes: Buffer.from(JSON.stringify(manifest(tracks.map((t, i) => ({ entry: names[i], trackId: t.id, bytes: FIVE_MB.length }))))) },
      { name: "library.json", bytes: Buffer.from(JSON.stringify(libraryJson({ tracks }))) },
    ], names, FIVE_MB);
    expect(refusal(await api.transfer.open({ from: "path", path: file })).message).toBe('"overlap.lyre" is damaged: part of it was changed or cannot be read, so Lyre cannot tell what is in it. Nothing was brought in. Ask for the file again.');
    expect(filesUnder(brought)).toEqual([]);
  });

  it("refuses to bring in audio when the drive has no room for it, before writing any", async () => {
    const { api, dir, brought } = rig({ freeBytes: async () => 1000 });
    const tracks = [track(1)];
    const file = await lyreFile(dir, "Big.lyre", [{ entry: "audio/00001.mp3", trackId: "t1", bytes: FIVE_MB.length }], { tracks }, [{ name: "audio/00001.mp3", bytes: FIVE_MB }]);
    const opened = valueOf(await api.transfer.open({ from: "path", path: file })) as OpenedFile;
    expect(refusal(await api.transfer.bringIn(opened.id, {}))).toEqual({ code: "invalid", message: "There is not enough room on the drive for the audio files in \"Big.lyre\" (5 MB). Make room, then bring it in again. Nothing was brought in." });
    expect(filesUnder(brought)).toEqual([]);
    expect(await api.library.listTracks()).toEqual([]);
  });
});
