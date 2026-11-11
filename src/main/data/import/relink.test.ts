/**
 * DAT-8: finding tracks whose files have gone, and pointing them at their new
 * place in bulk, by name, size and checksum under a folder the game master
 * chooses; applying the result is one undo step.
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempFolder } from "../test/helpers";
import { makeTestStore } from "../test/testStore";
import { UndoHistory } from "../undo";
import { addRoot } from "../repo/roots";
import { createTrack, getTrack, resolveTrackLocation } from "../repo/tracks";
import { readFileFacts } from "./fileFacts";
import { applyRelink, findMissingTracks, planRelink } from "./relink";
import { writeAudio } from "./testing/fixtures";

let temp: ReturnType<typeof makeTempFolder>;
let t: ReturnType<typeof makeTestStore>;
let history: UndoHistory;
beforeEach(() => {
  temp = makeTempFolder("lyre-relink-");
  t = makeTestStore();
  history = new UndoHistory(t.store);
});
afterEach(() => {
  t.close();
  temp.cleanup();
});

/** A track for a file that existed with these bytes and is then moved (or deleted when `to` is null). */
async function trackMovedTo(relativeFrom: string, to: string | null, content: string, extra: Record<string, unknown> = {}) {
  const from = writeAudio(path.join(temp.folder, "Old"), relativeFrom, content);
  const facts = await readFileFacts(from);
  const track = createTrack(t.store, { title: path.basename(relativeFrom), file: facts, ...extra });
  if (to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } else fs.rmSync(from);
  return track;
}

describe("findMissingTracks", () => {
  it("lists tracks whose files are not there, not web addresses or files that are", async () => {
    const here = createTrack(t.store, { file: { path: writeAudio(temp.folder, "here.mp3") } });
    const gone = await trackMovedTo("gone.mp3", null, "gone");
    createTrack(t.store, { url: "https://example.com/a.mp3" });
    const missing = await findMissingTracks(t.store);
    expect(missing.map((m) => m.id)).toEqual([gone.id]);
    expect(missing[0]).toMatchObject({ fileName: "gone.mp3", path: path.join(temp.folder, "Old", "gone.mp3"), size: 4 });
    expect(here).toBeDefined();
  });
});

describe("planRelink and applyRelink (DAT-8)", () => {
  it("matches by name, size and checksum under the chosen folder, also renamed files by their content", async () => {
    const newHome = path.join(temp.folder, "New");
    const moved = await trackMovedTo("Witcher/Silver for Monsters.flac", path.join(newHome, "Scores", "Witcher", "Silver for Monsters.flac"), "silver");
    const renamed = await trackMovedTo("door.wav", path.join(newHome, "Fx", "door creak (old).wav"), "door bytes");
    const changed = await trackMovedTo("rain.ogg", null, "rain v1");
    writeAudio(newHome, "Ambience/rain.ogg", "rain v2 is longer"); // same name, different file
    const lost = await trackMovedTo("lost.mp3", null, "lost");

    const missing = await findMissingTracks(t.store);
    const plan = await planRelink(t.store, missing, newHome);
    // In the order of the tracks' names, as findMissingTracks lists them.
    expect(plan.matches).toEqual([
      expect.objectContaining({ trackId: renamed.id, to: path.join(newHome, "Fx", "door creak (old).wav"), confidence: "sure" }),
      // Round 5 (DAT-8): the same name with another size is offered, not ticked ("Same name, different size: check it").
      expect.objectContaining({ trackId: changed.id, to: path.join(newHome, "Ambience", "rain.ogg"), confidence: "name" }),
      expect.objectContaining({ trackId: moved.id, to: path.join(newHome, "Scores", "Witcher", "Silver for Monsters.flac"), confidence: "sure" }),
    ]);
    expect(plan.notFound).toEqual([lost.id]);
    expect(plan.summary).toBe("Found 3 of 4 missing files. 1 was not found in that folder.");
  });

  it("matches by name alone when the library never knew the file's size (moved in from the old player), and says so", async () => {
    const newHome = path.join(temp.folder, "New");
    const track = createTrack(t.store, { title: "Strahd's waltz", file: { path: path.join(temp.folder, "Lost", "Strahd's waltz.flac") } });
    const found = writeAudio(newHome, "Barovia/Strahd's waltz.flac", "waltz");
    const plan = await planRelink(t.store, await findMissingTracks(t.store), newHome);
    expect(plan.matches).toEqual([expect.objectContaining({ trackId: track.id, to: found, confidence: "name" })]);
  });

  it("looks through the files a probe gives, so a test build can stand in for a computer (the sample library)", async () => {
    const track = createTrack(t.store, { title: "Storm", file: { path: "H:\\Audio\\Scores\\07 The Storm.flac", size: 9_000_000 } });
    const sized = createTrack(t.store, { title: "Rains", file: { path: "H:\\Audio\\Scores\\18 Rains.flac", size: 9_000_000 } });
    createTrack(t.store, { title: "Here", file: { path: "H:\\Audio\\Scores\\here.flac", size: 9_000_000 } });
    const files = new Map([
      ["H:\\Audio\\Scores\\here.flac", 9_000_000],
      ["E:\\Music\\Scores\\Kilar\\07 The Storm.flac", 9_000_000],
      ["E:\\Music\\Scores\\Djawadi\\18 Rains.flac", 8_400_000],
    ]);
    const probe = {
      exists: async (p: string) => files.has(p),
      facts: async (p: string) => ({ path: p, size: files.get(p) ?? 0, mtimeMs: 0, checksum: `q1:${p}` }),
      audioFilesUnder: async (folder: string) => [...files.keys()].filter((p) => p.startsWith(`${folder}\\`)),
    };
    const missing = await findMissingTracks(t.store, { probe });
    expect(missing.map((m) => m.id).sort()).toEqual([track.id, sized.id].sort());
    const plan = await planRelink(t.store, missing, "E:\\Music\\Scores", { probe });
    expect(plan.matches.map((m) => [m.trackId, m.confidence])).toEqual([
      [sized.id, "name"],
      [track.id, "likely"],
    ]);
  });

  it("prefers the candidate whose folders match the old path, reports a tie, and never uses a file already in the library", async () => {
    const newHome = path.join(temp.folder, "New");
    const a = await trackMovedTo("Witcher/theme.flac", null, "w");
    const b = await trackMovedTo("Skyrim/main.flac", null, "s", { title: "Main" });
    const witcher = writeAudio(newHome, "Witcher/theme.flac", "w");
    writeAudio(newHome, "Other/theme.flac", "w");
    writeAudio(newHome, "One/main.flac", "s");
    writeAudio(newHome, "Two/main.flac", "s");
    const taken = writeAudio(newHome, "Taken/main.flac", "s");
    createTrack(t.store, { title: "Already here", file: { path: taken } });

    const plan = await planRelink(t.store, await findMissingTracks(t.store), newHome);
    expect(plan.matches.map((m) => [m.trackId, m.to])).toEqual([[a.id, witcher]]);
    expect(plan.ambiguous).toEqual([
      { trackId: b.id, candidates: [path.join(newHome, "One", "main.flac"), path.join(newHome, "Two", "main.flac")] },
    ]);
    expect(plan.summary).toBe("Found 1 of 2 missing files. 1 has more than one possible file: choose which.");
  });

  it("relinks as one undo step, storing the new place under a library folder when it is in one", async () => {
    const newHome = path.join(temp.folder, "New");
    const root = await addRoot(t.store, { name: "New", path: newHome });
    const one = await trackMovedTo("a.flac", path.join(newHome, "x", "a.flac"), "a");
    const two = await trackMovedTo("b.flac", path.join(newHome, "y", "b.flac"), "b");
    const plan = await planRelink(t.store, await findMissingTracks(t.store), newHome);
    const before = [getTrack(t.store, one.id), getTrack(t.store, two.id)];

    await applyRelink(t.store, plan.matches);
    expect(getTrack(t.store, one.id)!.location).toEqual({ kind: "root", rootId: root.id, path: "x/a.flac" });
    expect(resolveTrackLocation(t.store, getTrack(t.store, two.id)!)).toBe(path.join(newHome, "y", "b.flac"));
    expect(await findMissingTracks(t.store)).toEqual([]);
    expect(history.state().undoLabel).toBe("Relink 2 files");

    await history.undo();
    expect([getTrack(t.store, one.id), getTrack(t.store, two.id)]).toEqual(before);
  });

  it("refuses a relink to a file another track already has", async () => {
    const other = createTrack(t.store, { file: { path: writeAudio(temp.folder, "x.flac") } });
    const gone = await trackMovedTo("y.flac", null, "y");
    expect(() => applyRelink(t.store, [{ trackId: gone.id, to: path.join(temp.folder, "x.flac") }])).toThrow(/already has/);
    expect(getTrack(t.store, other.id)).not.toBeNull();
  });
});
