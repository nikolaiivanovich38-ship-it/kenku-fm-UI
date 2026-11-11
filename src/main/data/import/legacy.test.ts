/**
 * DAT-9: moving the old player's playlists and soundboards (redux-persist key
 * `persist:player`) into the library, once, without changing the old data.
 * Fixtures are shaped like a game master's real library: long descriptive
 * titles, the same file in several playlists under different titles, missing
 * files, web addresses, odd characters, a board too big for the grid.
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlaylistsState, SoundboardsState } from "./legacyShapes";
import { encodeFilePath } from "./legacyShapes";
import { openLibrary, type Library } from "../library";
import { listBackups } from "../backups";
import { makeClock, makeTempFolder } from "../test/helpers";
import { getTrack, listTracks, resolveTrackLocation } from "../repo/tracks";
import { listPlaylistItems, listPlaylists } from "../repo/playlists";
import { getBoardLayout, listBoards } from "../repo/boards";
import { createPlaylist } from "../repo/playlists";
import { importLegacyLibrary, legacyLocation, parseLegacyPlayerState, LEGACY_JOB } from "./legacy";
import { fakeTagReader, writeAudio } from "./testing/fixtures";

let temp: ReturnType<typeof makeTempFolder>;
let library: Library;
let music: string;
const clock = makeClock(new Date(2026, 10, 4, 20, 0, 0).getTime());

beforeEach(() => {
  temp = makeTempFolder("lyre-legacy-");
  music = path.join(temp.folder, "Music");
  library = openLibrary({ folder: path.join(temp.folder, "library"), now: clock.now });
});
afterEach(() => {
  library.close();
  temp.cleanup();
});

const LONG_TITLE =
  "Melancholy tense - the harbour at night after the fire, slow strings under a lone horn, builds twice then settles " +
  "(loops well; fade the last 10 s). Use when the party walks the burned docks, or for any grief scene that needs to keep " +
  "moving. Not for combat: too slow. Pairs with the 'Drowned bells' ambience and the gull pad. ".repeat(3);

/** The old player's state, as a game master's library might hold it. */
function fixture() {
  const file = (relative: string, content?: string) => encodeFilePath(writeAudio(music, relative, content));
  const lostFile = encodeFilePath(path.join(music, "Lost", "Strahd's waltz.flac"));
  const playlists: PlaylistsState = {
    playlists: {
      byId: {
        "pl-combat": { id: "pl-combat", title: "Combat ⚔ — boss fights", background: "battle", tracks: ["t-boss", "t-stream", "t-lost", "t-harbour"] },
        "pl-tavern": { id: "pl-tavern", title: "The Prancing Pony — tavern (night)", background: "tavern", tracks: ["t-harbour2", "t-lute", "t-cafe", "t-ghost"] },
        "pl-rain": { id: "pl-rain", title: "Ambience: rain & storms", background: "https://example.com/rain.jpg", tracks: ["t-rain", "t-wind"] },
        "pl-untitled": { id: "pl-untitled", title: "   ", background: "", tracks: [] },
      },
      allIds: ["pl-combat", "pl-tavern", "pl-rain", "pl-untitled"],
    },
    tracks: {
      "t-boss": { id: "t-boss", url: file("Scores/Boss/01 Dies Irae.flac"), title: "Heroic sting - short rise, don't loop" },
      "t-stream": { id: "t-stream", url: "https://example.com/stream/epic%20battle.mp3", title: "Epic battle (stream)" },
      "t-lost": { id: "t-lost", url: lostFile, title: "Strahd's waltz" },
      "t-harbour": { id: "t-harbour", url: file("Scores/Harbour/harbour.flac"), title: LONG_TITLE },
      "t-harbour2": { id: "t-harbour2", url: file("Scores/Harbour/harbour.flac"), title: "Harbour, sad" },
      "t-lute": { id: "t-lute", url: file("Tavern/lute_and_crowd.ogg"), title: "Lute\u0007 and crowd\nlaughing" },
      "t-cafe": { id: "t-cafe", url: file("Tavern/Café — l'été #2 (100%) 🎻.mp3"), title: "Café — l'été #2 (100%) 🎻" },
      "t-rain": { id: "t-rain", url: file("Ambience/rain.ogg"), title: "Rain on canvas" },
      "t-wind": { id: "t-wind", url: file("Ambience/wind.ogg"), title: "Wind in the pines" },
    },
  };
  const bigIds = Array.from({ length: 40 }, (_, i) => `s-big-${i}`);
  const soundboards: SoundboardsState = {
    soundboards: {
      byId: {
        "sb-weather": { id: "sb-weather", title: "Weather", background: "forest", sounds: ["s-rain", "s-thunder", "s-blob", "s-boss"] },
        "sb-big": { id: "sb-big", title: "Everything", background: "", sounds: bigIds },
      },
      allIds: ["sb-weather", "sb-big"],
    },
    sounds: {
      "s-rain": { id: "s-rain", url: file("Ambience/rain.ogg"), title: "Rain", loop: true, volume: 0.6, fadeIn: 2000, fadeOut: 3000 },
      "s-thunder": { id: "s-thunder", url: file("Sound Effects/thunder.wav"), title: "Thunder", loop: false, volume: 1.7, fadeIn: Number.NaN, fadeOut: 250 },
      "s-blob": { id: "s-blob", url: "blob:file:///6f1c", title: "Bell", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 },
      "s-boss": { id: "s-boss", url: file("Scores/Boss/01 Dies Irae.flac"), title: "Boss sting", loop: false, volume: 0.9, fadeIn: 0, fadeOut: 0 },
      ...Object.fromEntries(
        bigIds.map((id, i) => [id, { id, url: file(`Sound Effects/Big/${i}.wav`), title: `Sound ${i}`, loop: false, volume: 1, fadeIn: 0, fadeOut: 0 }]),
      ),
    },
  };
  return { playlists, soundboards };
}

/** The value redux-persist keeps in localStorage under "persist:player": each slice as a JSON string. */
function persisted(state: ReturnType<typeof fixture>): string {
  return JSON.stringify({
    playlists: JSON.stringify(state.playlists),
    soundboards: JSON.stringify(state.soundboards),
    _persist: JSON.stringify({ version: 1, rehydrated: true }),
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("legacyLocation", () => {
  it.each([
    ["file://C:/Users/Nik/Music/a%20b.mp3", { file: "C:\\Users\\Nik\\Music\\a b.mp3" }],
    ["file:///C:/Users/Nik/Music/%23rain%25.mp3", { file: "C:\\Users\\Nik\\Music\\#rain%.mp3" }],
    ["file:////nas/audio/x.flac", { file: "\\\\nas\\audio\\x.flac" }],
    ["file://nas/audio/x.flac", { file: "\\\\nas\\audio\\x.flac" }],
    ["file:///home/nik/Music/x%2Fy.mp3", { file: "/home/nik/Music/x/y.mp3" }],
    ["file:///home/nik/100%.mp3", { file: "/home/nik/100%.mp3" }],
    ["/music/a.mp3", { file: "/music/a.mp3" }],
    ["H:\\Audio\\a.flac", { file: "H:\\Audio\\a.flac" }],
    [" https://example.com/a.mp3 ", { url: "https://example.com/a.mp3" }],
    ["blob:file:///6f1c", null],
    ["data:audio/mp3;base64,AAAA", null],
    ["music/a.mp3", null],
    ["", null],
    [undefined, null],
  ])("%s", (raw, expected) => {
    expect(legacyLocation(raw)).toEqual(expected);
  });
});

describe("parseLegacyPlayerState", () => {
  it("reads redux-persist's stored value, an already parsed object, or nothing", () => {
    // What localStorage holds has been through JSON (NaN is stored as null).
    const state = JSON.parse(JSON.stringify(fixture())) as ReturnType<typeof fixture>;
    expect(parseLegacyPlayerState(persisted(state))).toEqual(state);
    expect(parseLegacyPlayerState({ playlists: state.playlists, soundboards: state.soundboards })).toEqual(state);
    expect(parseLegacyPlayerState(null)).toEqual({ playlists: null, soundboards: null });
    expect(parseLegacyPlayerState(JSON.stringify({ playlists: JSON.stringify(state.playlists) }))).toEqual({
      playlists: state.playlists,
      soundboards: null,
    });
    expect(() => parseLegacyPlayerState("{not json")).toThrow(/could not be read/);
  });
});

describe("importLegacyLibrary (DAT-9)", () => {
  it("moves playlists, soundboards and their tracks in, keeping ids, order, backgrounds and per-sound settings", async () => {
    const report = await importLegacyLibrary(library, persisted(fixture()));
    const store = library.store;
    expect(report.status).toBe("moved");

    expect(listPlaylists(store).map((p) => [p.id, p.title, p.background, p.lane, p.kind])).toEqual([
      ["pl-combat", "Combat ⚔ — boss fights", "battle", "music", "manual"],
      ["pl-tavern", "The Prancing Pony — tavern (night)", "tavern", "music", "manual"],
      ["pl-rain", "Ambience: rain & storms", "https://example.com/rain.jpg", "amb", "manual"],
      ["pl-untitled", "Untitled playlist", "", "music", "manual"],
    ]);
    const items = (id: string) => listPlaylistItems(store, id).map((item) => (item.kind === "track" ? item.trackId : item.label));
    // The same file under two titles is one track, in both playlists; a track id that points nowhere is left out.
    expect(items("pl-combat")).toEqual(["t-boss", "t-stream", "t-lost", "t-harbour"]);
    expect(items("pl-tavern")).toEqual(["t-harbour", "t-lute", "t-cafe"]);

    const boss = getTrack(store, "t-boss")!;
    expect(boss).toMatchObject({ title: "Heroic sting - short rise, don't loop", kind: "music", isNew: false, fileName: "01 Dies Irae.flac" });
    expect(boss.checksum).toMatch(/^q1:/);
    expect(resolveTrackLocation(store, boss)).toBe(path.join(music, "Scores", "Boss", "01 Dies Irae.flac"));
    expect(resolveTrackLocation(store, getTrack(store, "t-cafe")!)).toBe(path.join(music, "Tavern", "Café — l'été #2 (100%) 🎻.mp3"));
    expect(getTrack(store, "t-cafe")!.title).toBe("Café — l'été #2 (100%) 🎻");
    expect(getTrack(store, "t-lute")!.title).toBe("Lute and crowd laughing");
    expect(getTrack(store, "t-stream")!.location).toEqual({ kind: "url", url: "https://example.com/stream/epic%20battle.mp3" });
    expect(getTrack(store, "t-rain")!.kind).toBe("amb");

    const harbour = getTrack(store, "t-harbour")!;
    expect(harbour.title.length).toBeLessThanOrEqual(500);
    expect(harbour.title.endsWith("…")).toBe(true);
    expect(harbour.notes).toContain(`Full title in the old player: ${LONG_TITLE.trim()}`);
    expect(harbour.notes).toContain("Also called in the old player: Harbour, sad");

    expect(listBoards(store).map((b) => [b.id, b.title, b.background, b.cols, b.rows])).toEqual([
      ["sb-weather", "Weather", "forest", 4, 1],
      ["sb-big", "Everything", "", 4, 8],
    ]);
    const weather = getBoardLayout(store, "sb-weather");
    expect(weather.slots.map((pad) => pad && [pad.id, pad.label, pad.mode, pad.volume, pad.fadeInMs, pad.fadeMs, pad.sound.trackIds])).toEqual([
      ["s-rain", "Rain", "toggle", 0.6, 2000, 3000, ["t-rain"]],
      ["s-thunder", "Thunder", "oneshot", 1, 0, 250, ["s-thunder"]],
      ["s-boss", "Boss sting", "oneshot", 0.9, 0, 0, ["t-boss"]],
      null,
    ]);
    expect(getTrack(store, "s-thunder")!).toMatchObject({ kind: "fx", role: "effect" });
    const big = getBoardLayout(store, "sb-big");
    expect(big.slots.filter(Boolean)).toHaveLength(32);
    expect(big.spare.map((pad) => pad.label)).toEqual(Array.from({ length: 8 }, (_, i) => `Sound ${32 + i}`));

    // 9 old tracks and 44 sounds; one sound was a blob address, and 3 files appear twice: 49 tracks.
    expect(listTracks(store)).toHaveLength(49);
    expect(report.lines).toEqual([
      "Moved 4 playlists (9 tracks) and 2 soundboards (43 sounds) from the old player into your library. The old player's library was not changed.",
      "3 files were in more than one playlist or soundboard; each is in your library once, and everywhere it was before.",
      `1 file could not be found: Strahd's waltz.flac. It is in your library and its playlists; use Find missing files to show Lyre where it is now.`,
      "1 could not be moved: Bell (not a file or web address Lyre can play).",
      "1 playlist entry pointed to a track that no longer exists and was left out (in The Prancing Pony — tavern (night)).",
      '8 sounds did not fit on the grid of "Everything" and wait among its spare pads.',
      "1 title was longer than 500 characters; the full title is in the track's notes.",
      "1 file had different titles in different places; the other titles are in its notes.",
      `A copy of your library was saved first: ${path.basename(report.backupPath!)}.`,
    ]);
    expect(report.summary).toBe(report.lines.join(" "));
  });

  it("takes a backup first, never changes the old data, and runs only once", async () => {
    const state = deepFreeze(fixture());
    const before = JSON.stringify(state);
    const first = await importLegacyLibrary(library, state);
    expect(JSON.stringify(state)).toBe(before);
    const backups = listBackups(library.backupFolder);
    expect(backups.map((b) => b.kind)).toEqual(["import"]);
    expect(first.backupPath).toBe(backups[0].path);
    // The backup is the library as it was: nothing moved yet.
    const copy = openLibrary({ folder: path.join(temp.folder, "copy") });
    copy.close();
    fs.copyFileSync(backups[0].path, path.join(temp.folder, "copy", "library.sqlite"));
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(path.join(temp.folder, "copy", `library.sqlite${suffix}`), { force: true });
    const reopened = openLibrary({ folder: path.join(temp.folder, "copy") });
    expect(listPlaylists(reopened.store)).toEqual([]);
    reopened.close();

    const tracks = listTracks(library.store);
    const again = await importLegacyLibrary(library, state);
    expect(again.status).toBe("already-done");
    expect(again.lines).toEqual(first.lines);
    expect(listTracks(library.store)).toEqual(tracks);
    expect(listBackups(library.backupFolder)).toHaveLength(1);
  });

  it("carries on after a crash and ends with the same library as an uninterrupted move", async () => {
    const raw = persisted(fixture());
    let steps = 0;
    await expect(
      importLegacyLibrary(library, raw, {
        onStepSaved: () => {
          if (++steps === 2) throw new Error("power cut");
        },
      }),
    ).rejects.toThrow(/power cut/);
    expect(library.store.get("SELECT state FROM library_jobs WHERE name = ?", LEGACY_JOB)).toEqual({ state: "running" });
    expect(listPlaylists(library.store).length).toBeLessThan(4);

    const resumed = await importLegacyLibrary(library, raw);
    expect(resumed.status).toBe("moved");

    const other = openLibrary({ folder: path.join(temp.folder, "other"), now: clock.now });
    try {
      const straight = await importLegacyLibrary(other, raw);
      const shape = (lib: Library) => ({
        playlists: listPlaylists(lib.store).map((p) => [p.id, p.title, listPlaylistItems(lib.store, p.id).map((i) => i.kind === "track" && i.trackId)]),
        tracks: listTracks(lib.store).map((x) => [x.id, x.title, x.notes, x.kind, x.location]),
        boards: listBoards(lib.store).map((b) => getBoardLayout(lib.store, b.id)).map((l) => [l.slots.map((p) => p?.id ?? null), l.spare.map((p) => p.id)]),
      });
      expect(shape(library)).toEqual(shape(other));
      expect(resumed.lines.slice(0, -1)).toEqual(straight.lines.slice(0, -1));
      // One backup, taken when the move first started.
      expect(listBackups(library.backupFolder)).toHaveLength(1);
    } finally {
      other.close();
    }
  });

  it("keeps the game master's own playlists and reuses tracks already in the library", async () => {
    createPlaylist(library.store, { title: "Made in Lyre" });
    const first = await importLegacyLibrary(library, persisted(fixture()));
    expect(first.status).toBe("moved");
    expect(listPlaylists(library.store).map((p) => p.title)[0]).toBe("Made in Lyre");
  });

  it("reads embedded tags of the files it finds, without touching the titles (DAT-5)", async () => {
    const reader = fakeTagReader({ "01 Dies Irae.flac": { title: "Dies Irae", artist: "Verdi", durationMs: 130_000 } });
    await importLegacyLibrary(library, persisted(fixture()), { tagReader: reader });
    expect(getTrack(library.store, "t-boss")).toMatchObject({
      title: "Heroic sting - short rise, don't loop",
      metaTitle: "Dies Irae",
      sourceComposer: "Verdi",
      durationMs: 130_000,
    });
    expect(reader.reads.some((p) => p.includes("Strahd"))).toBe(false);
  });

  it("says so when there is nothing to move, and when the old data cannot be read", async () => {
    const empty = await importLegacyLibrary(library, null);
    expect(empty).toMatchObject({ status: "nothing-to-move", lines: ["The old player had no playlists or soundboards to move."] });
    expect(listBackups(library.backupFolder)).toEqual([]);

    const other = openLibrary({ folder: path.join(temp.folder, "other") });
    try {
      const unreadable = await importLegacyLibrary(other, "{broken");
      expect(unreadable.status).toBe("unreadable");
      expect(unreadable.summary).toMatch(/could not be read/);
      // Not marked done: a later version can try again.
      expect(other.store.get("SELECT count(*) AS n FROM library_jobs")).toEqual({ n: 0 });
    } finally {
      other.close();
    }
  });
});
