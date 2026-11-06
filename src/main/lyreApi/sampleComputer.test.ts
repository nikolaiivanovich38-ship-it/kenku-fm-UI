/**
 * Test builds of the sample library (CUE_DESK_LYRE_SEED=prototype): the prototype's computer, whose files are not on
 * the test machine. Every sample file is there except the three that moved (t19, t26, t37); E:\Music\Scores holds
 * t19 (same name and size) and t26 (same name, another size); Choose a file… finds "Curse of Strahd from Sam.lyre".
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { valueOf } from "../../common/lyre/contract";
import { prototypeSeed } from "../../common/lyre/seed";
import { openLibrary } from "../data";
import { createLibraryApi, type LibraryHost } from "./libraryApi";
import { SAMPLE_FILE_BYTES, SAMPLE_SHARED_FILE, sampleComputer, writeSampleSharedFile } from "./sampleComputer";
import { seedLibrary } from "./seedLibrary";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

async function sampleApi() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-sample-"));
  const library = openLibrary({ folder: path.join(dir, "library") });
  const seed = prototypeSeed();
  await seedLibrary(library, seed, { sample: true });
  const shared = await writeSampleSharedFile(path.join(dir, "Documents", "Lyre"));
  const host: LibraryHost = { chooseFiles: async () => null, chooseFolder: async () => null, showItemInFolder: () => undefined, chooseSaveFile: async (name) => path.join(dir, name), chooseLyreFile: async () => shared };
  const api = createLibraryApi(library, host, { files: sampleComputer(seed), transfer: { today: () => Date.UTC(2026, 10, 5, 12) } });
  cleanups.push(() => {
    api.stopBackgroundWork();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { api, dir, shared };
}

describe("the sample computer of a test build", () => {
  it("has every sample file but the three that moved, each about 9 MB", async () => {
    const { api } = await sampleApi();
    expect((await api.import.findMissing()).map((m) => m.id).sort()).toEqual(["t19", "t26", "t37"]);
    expect((await api.library.listTracks()).find((t) => t.id === "t41")?.sizeBytes).toBe(SAMPLE_FILE_BYTES);
    const abbess = await api.transfer.estimate({ kind: "playlist", playlistId: "p-abbess" });
    expect(abbess).toMatchObject({ audioFiles: 5, audioBytes: 45_000_000 });
  });

  it("finds t19 by name and size and t26 by name only in E:\\Music\\Scores", async () => {
    const { api } = await sampleApi();
    const plan = valueOf(await api.import.planRelink({ from: "path", path: "E:\\Music\\Scores" }));
    expect(plan.matches.map((m) => [m.trackId, m.confidence, m.to])).toEqual([
      ["t26", "name", "E:\\Music\\Scores\\Ramin Djawadi\\Game of Thrones, Season 3\\18 The Rains of Castamere.flac"],
      ["t19", "likely", "E:\\Music\\Scores\\Wojciech Kilar\\Bram Stoker's Dracula\\07 The Storm.flac"],
    ]);
    expect(plan.notFound).toEqual(["t37"]);
    valueOf(await api.import.applyRelink([plan.matches[1]]));
    expect((await api.import.findMissing()).map((m) => m.id).sort()).toEqual(["t26", "t37"]);
  });

  it("lets the page preview only the file found for a row to check, while that plan lasts (security review w4, Should 5)", async () => {
    const { api } = await sampleApi();
    const events: string[][] = [];
    api.subscribe((event) => event.type === "changed" && events.push(event.areas));
    expect(api.previewableFiles()).toEqual([]);
    const plan = valueOf(await api.import.planRelink({ from: "path", path: "E:\\Music\\Scores" }));
    // t26 matches by name only ("check it"); t19 by name and size is not offered for a preview.
    expect(api.previewableFiles()).toEqual([plan.matches[0].to]);
    // The main process refreshes its list of what the page may read.
    expect(events).toContainEqual(["folders"]);
    valueOf(await api.import.applyRelink([plan.matches[1]]));
    expect(api.previewableFiles()).toEqual([]);
  });

  it("says what came across from Kenku FM 1.5.5, with the three missing files", async () => {
    const { api } = await sampleApi();
    const report = await api.transfer.movedReport();
    expect(report).toMatchObject({ from: "Kenku FM 1.5.5", at: Date.UTC(2026, 10, 5, 18, 42) });
    expect(report?.copied.map((r) => [r.what, r.count, r.nowIn])).toEqual([["Playlists", 9, "Playlists (Manual)"], ["Tracks", 212, "Library"], ["Soundboards", 4, "Pad boards"], ["Sounds", 37, "Pads on those boards"], ["Bookmarks", 6, "Website tabs"]]);
    expect(report?.missing.map((m) => m.id).sort()).toEqual(["t19", "t26", "t37"]);
  });

  it("saves The Abbess with its audio files as a 45 MB file, and the whole library on 5 Nov 2026", async () => {
    const { api, dir } = await sampleApi();
    const abbess = valueOf(await api.transfer.save({ scope: { kind: "playlist", playlistId: "p-abbess" }, includeAudio: true }));
    expect(abbess?.summary).toBe(`Saved The Abbess.lyre (45 MB) in ${dir}.`);
    const all = valueOf(await api.transfer.save({ scope: { kind: "library" }, includeAudio: false }));
    expect(all?.summary).toMatch(/^Saved Lyre library 2026-11-05\.lyre \(\d+ KB\) in /);
  });

  it("files saved with their audio start like real FLAC and WAV files, so Bring in unpacks them (security review w4)", async () => {
    const { api, dir } = await sampleApi();
    const saved = valueOf(await api.transfer.save({ scope: { kind: "playlist", playlistId: "p-abbess" }, includeAudio: true, path: path.join(dir, "Abbess.lyre") }));
    const opened = valueOf(await api.transfer.open({ from: "path", path: saved?.path ?? "" }));
    const report = valueOf(await api.transfer.bringIn(opened?.id ?? "", { all: "keepBoth" }));
    expect(report.summary).toContain("5 audio files were unpacked next to your library.");
  });

  it("offers Sam's shared file: a campaign, three playlists (two you have), a board, 38 tracks (8 you have) and three new tag values", async () => {
    const { api, shared } = await sampleApi();
    expect(path.basename(shared)).toBe(SAMPLE_SHARED_FILE);
    const opened = valueOf(await api.transfer.open({ from: "choose-file" }));
    expect(opened?.fileName).toBe("Curse of Strahd from Sam.lyre");
    expect(opened?.items.map((i) => [i.kind, i.name, i.status])).toEqual([
      ["campaign", "Curse of Strahd", "new"],
      ["playlist", "Barovia mist", "new"],
      ["playlist", "Gothic dread", "duplicate"],
      ["playlist", "Castle corridors", "duplicate"],
      ["board", "Ravenloft", "new"],
      ["tracks", "38 tracks", "duplicate"],
      ["tags", "3 new tag values", "new"],
    ]);
    expect(opened?.items.find((i) => i.kind === "tags")?.detail).toBe("Mood: Gothic · Leitmotif: Strahd, Ireena");
    expect(opened?.items.find((i) => i.kind === "campaign")?.detail).toBe("2 sessions, 9 scenes");
    const report = valueOf(await api.transfer.bringIn(opened?.id ?? "", { all: "keepBoth" }));
    expect(report.summary).toBe('Brought in Curse of Strahd, 3 playlists, a pad board, 3 tag values and 38 tracks (8 as copies). 3 copies named "(from Sam)". The audio files were not in the file: Find missing files finds them on this computer.');
  });
});
