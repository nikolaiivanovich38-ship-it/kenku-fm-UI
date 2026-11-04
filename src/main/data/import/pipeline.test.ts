/**
 * EDT-6 (backend) and DAT-5: adding files or whole folders to the library.
 * Real files in a temporary folder; tags come from a fake reader.
 */
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempFolder } from "../test/helpers";
import { makeTestStore } from "../test/testStore";
import { addRoot } from "../repo/roots";
import { createTrack, getTrack, listNewTrackIds, listTracks, updateTrack } from "../repo/tracks";
import { search } from "../repo/search";
import { importAudio, locationsInLibrary, refreshEmbeddedTags, type ImportProgress } from "./pipeline";
import { fileKey } from "./audioFiles";
import { fakeTagReader, writeAudio } from "./testing/fixtures";

let temp: ReturnType<typeof makeTempFolder>;
let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  temp = makeTempFolder("lyre-import-");
  t = makeTestStore();
});
afterEach(() => {
  t.close();
  temp.cleanup();
});

describe("importAudio (EDT-6)", () => {
  it("adds a whole folder, audio only, as new tracks with their file facts, kind guessed from the folder", async () => {
    const audio = path.join(temp.folder, "Audio");
    writeAudio(audio, "Scores/Bear McCreary/01 Galadriel.flac");
    writeAudio(audio, "Ambience/Rain/heavy rain.ogg");
    writeAudio(audio, "Sound Effects/door creak.wav");
    writeAudio(audio, "Scores/cover.jpg");
    const result = await importAudio(t.store, { paths: [audio] });

    expect(result.added).toHaveLength(3);
    expect(result.alreadyInLibrary).toEqual([]);
    expect(result.problems).toEqual([]);
    const tracks = result.trackIds.map((id) => getTrack(t.store, id)!);
    expect(tracks.map((x) => [x.fileName, x.kind, x.role, x.isNew, x.title])).toEqual([
      ["heavy rain.ogg", "amb", null, true, ""],
      ["01 Galadriel.flac", "music", null, true, ""],
      ["door creak.wav", "fx", "effect", true, ""],
    ]);
    expect(tracks[1]).toMatchObject({
      metaTitle: "Galadriel",
      location: { kind: "absolute", path: path.join(audio, "Scores", "Bear McCreary", "01 Galadriel.flac") },
      fileSize: expect.any(Number),
      fileMtimeMs: expect.any(Number),
      checksum: expect.stringMatching(/^q1:/),
    });
    expect(listNewTrackIds(t.store).sort()).toEqual([...result.added].sort());
    expect(result.summary).toBe("Added 3 tracks.");
  });

  it("reads embedded tags into the file-tag title, artist, album and length, never into the game master's title (DAT-5)", async () => {
    const reader = fakeTagReader({
      "07.flac": { title: "Wings of Kynareth", artist: "Jeremy Soule", album: "Oblivion", trackNumber: 7, durationMs: 155_000, moods: ["Peaceful"] },
      "broken.mp3": "throw",
    });
    const a = writeAudio(temp.folder, "Scores/07.flac");
    const b = writeAudio(temp.folder, "Scores/broken.mp3");
    const result = await importAudio(t.store, { paths: [a, b] }, { tagReader: reader });
    const [first, second] = result.trackIds.map((id) => getTrack(t.store, id)!);
    expect(first).toMatchObject({
      title: "",
      metaTitle: "Wings of Kynareth",
      sourceComposer: "Jeremy Soule",
      sourceAlbum: "Oblivion",
      durationMs: 155_000,
    });
    // A file whose tags cannot be read is still added, named after its file.
    expect(second).toMatchObject({ title: "", metaTitle: "broken", durationMs: null });
    expect(result.problems).toEqual([{ path: b, reason: "its tags could not be read (added without them)" }]);
    // Mood and genre tags come back as hints for tag suggestions (DAT-4), not as tags.
    expect(result.tagHints).toEqual({ [first.id]: ["Peaceful"] });
    expect(search(t.store, "kynar").map((hit) => hit.id)).toEqual([first.id]);
    expect(search(t.store, "soule").map((hit) => hit.id)).toEqual([first.id]);
  });

  it("puts tracks of an album in disc and track order", async () => {
    const reader = fakeTagReader({
      "b.flac": { trackNumber: 2, discNumber: 1 },
      "a.flac": { trackNumber: 1, discNumber: 2 },
      "c.flac": { trackNumber: 1, discNumber: 1 },
    });
    const album = path.join(temp.folder, "Album");
    for (const name of ["a.flac", "b.flac", "c.flac"]) writeAudio(album, name);
    const result = await importAudio(t.store, { paths: [album] }, { tagReader: reader });
    expect(result.trackIds.map((id) => getTrack(t.store, id)!.fileName)).toEqual(["c.flac", "b.flac", "a.flac"]);
  });

  it("reuses a file already in the library, and lists a file given twice once", async () => {
    const a = writeAudio(temp.folder, "Music/a.mp3");
    const b = writeAudio(temp.folder, "Music/b.mp3");
    const existing = createTrack(t.store, { title: "Mine", file: { path: a } });
    const result = await importAudio(t.store, { paths: [a, path.join(temp.folder, "Music"), b] });
    expect(result.alreadyInLibrary).toEqual([existing.id]);
    expect(result.added).toHaveLength(1);
    expect(result.trackIds).toEqual([existing.id, result.added[0]]);
    expect(getTrack(t.store, existing.id)).toMatchObject({ title: "Mine", isNew: false });
    expect(listTracks(t.store)).toHaveLength(2);
    expect(result.summary).toBe("Added 1 track. 1 was already in your library.");
  });

  it("recognises a file already in the library under a library folder, and stores new ones relative to it", async () => {
    const scores = path.join(temp.folder, "Scores");
    const root = addRoot(t.store, { name: "Scores", path: scores });
    const a = writeAudio(scores, "Witcher/Silver for Monsters.flac");
    const first = await importAudio(t.store, { paths: [scores] });
    expect(getTrack(t.store, first.added[0])!.location).toEqual({ kind: "root", rootId: root.id, path: "Witcher/Silver for Monsters.flac" });
    const second = await importAudio(t.store, { paths: [a] });
    expect(second.added).toEqual([]);
    expect(second.alreadyInLibrary).toEqual(first.added);
  });

  it("says in plain words what could not be added", async () => {
    const a = writeAudio(temp.folder, "a.mp3");
    const notes = writeAudio(temp.folder, "notes.txt");
    const result = await importAudio(t.store, { paths: [a, notes, path.join(temp.folder, "gone.flac")] });
    expect(result.summary).toBe(
      "Added 1 track. 2 could not be added: notes.txt (not an audio file Lyre can play), gone.flac (not found).",
    );
  });

  it("reports progress for a progress bar, ending at the total", async () => {
    for (let i = 0; i < 25; i++) writeAudio(temp.folder, `Music/${i}.mp3`);
    const seen: ImportProgress[] = [];
    await importAudio(t.store, { paths: [temp.folder] }, { onProgress: (p) => seen.push(p), batchSize: 10 });
    expect(seen[0]).toMatchObject({ phase: "finding", done: 0 });
    const counted = seen.filter((p) => p.phase !== "finding");
    expect(counted.every((p) => p.total === 25)).toBe(true);
    expect(counted.map((p) => p.done)).toEqual([...counted.map((p) => p.done)].sort((x, y) => x - y));
    expect(seen.filter((p) => p.phase === "saving").map((p) => p.done)).toEqual([10, 20, 25]);
    expect(seen[seen.length - 1]).toEqual({ phase: "done", done: 25, total: 25, message: "Added 25 tracks." });
  });

  it("can be cancelled: what was saved stays, and the result says so", async () => {
    for (let i = 0; i < 30; i++) writeAudio(temp.folder, `Music/${i}.mp3`);
    const controller = new AbortController();
    const result = await importAudio(
      t.store,
      { paths: [temp.folder] },
      {
        batchSize: 10,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "saving" && p.done === 10) controller.abort();
        },
      },
    );
    expect(result.cancelled).toBe(true);
    expect(result.added).toHaveLength(10);
    expect(listTracks(t.store)).toHaveLength(10);
    expect(result.summary).toBe("Stopped. Added 10 tracks before stopping.");
  });

  it("is not an undo step, and clears the undo history (DB review item 10)", async () => {
    const { UndoHistory } = await import("../undo");
    const history = new UndoHistory(t.store);
    createTrack(t.store, { title: "Before", file: { path: path.join(temp.folder, "before.mp3") } });
    expect(history.state().canUndo).toBe(true);
    await importAudio(t.store, { paths: [writeAudio(temp.folder, "a.mp3")] });
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("gives the same track count when the same folder is imported twice, also written in other letter case (DB review item 4)", async () => {
    const folder = path.join(temp.folder, "Scores");
    for (const name of ["a.flac", "b.flac", "Sub/c.flac"]) writeAudio(folder, name);
    await importAudio(t.store, { paths: [folder] });
    const again = await importAudio(t.store, { paths: [folder] });
    expect(again.added).toEqual([]);
    expect(again.alreadyInLibrary).toHaveLength(3);
    expect(listTracks(t.store)).toHaveLength(3);
    const existing = createTrack(t.store, { file: { path: "H:\\Audio\\Rain.flac" } });
    expect(locationsInLibrary(t.store).get(fileKey("h:/audio/RAIN.flac"))).toBe(existing.id);
  });
});

describe("refreshEmbeddedTags (DAT-5 for tracks already in the library)", () => {
  it("fills the file-tag title and length from the file, artist and album only where empty, and leaves the title alone", async () => {
    const a = writeAudio(temp.folder, "a.flac");
    const track = createTrack(t.store, { title: "Melancholy tense - harbour at night (loops well)", file: { path: a } });
    updateTrack(t.store, track.id, { sourceAlbum: "My own album name" });
    const reader = fakeTagReader({ "a.flac": { title: "Harbour", artist: "Inon Zur", album: "Fallout 4", durationMs: 200_000 } });
    const result = await refreshEmbeddedTags(t.store, [track.id], reader);
    expect(getTrack(t.store, track.id)).toMatchObject({
      title: "Melancholy tense - harbour at night (loops well)",
      metaTitle: "Harbour",
      sourceComposer: "Inon Zur",
      sourceAlbum: "My own album name",
      durationMs: 200_000,
    });
    expect(result).toEqual({ updated: 1, unreadable: [], missing: [] });
  });
});
