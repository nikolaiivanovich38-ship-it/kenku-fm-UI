/**
 * The in-memory LyreApi: the contract every implementation passes, plus what only the fake has (choosers it is
 * told what to answer, files arriving in a watched folder) and a check that the typed seed is the prototype's data.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

import { lyreApiContract, valueOf } from "./contract";
import { createFakeLyreApi, type FakeLyreOptions } from "./fake";
import { prototypeSeed } from "./seed";
import { trackNamesOf } from "./lookup";
import type { LyreEvent } from "./api";

const fixtureOptions: FakeLyreOptions = {
  missingTrackIds: ["t43"],
  folderFiles: { "D:\\Moved": ["07 Memories of Mother.flac", "cover.jpg"] },
};

lyreApiContract("in-memory fake", () => ({
  api: createFakeLyreApi(fixtureOptions),
  newAudioFiles: ["D:\\Incoming\\Ambience\\harbour_night.wav", "D:\\Incoming\\Dune\\02 Leaving Caladan.flac"],
  notAudioFile: "D:\\Incoming\\notes.txt",
  missingTrackId: "t43",
  relinkFolder: "D:\\Moved",
  folderToWatch: "H:\\Audio\\Incoming",
  transferFiles: { saveTo: "D:\\Shared\\The Sunken Crown.lyre", notLyreFile: "D:\\Shared\\photo.jpg" },
}));

describe("the seed is the prototype's sample data", () => {
  // data.js defines a global LYRE_DATA; run it in a sandbox, as src/main/data/repo/domain.test.ts does.
  const source = fs.readFileSync(path.join(__dirname, "../../../design/prototype/src/data.js"), "utf8");
  const sandbox: { LYRE_DATA?: Record<string, unknown> } = {};
  vm.runInNewContext(`${source}; this.LYRE_DATA = LYRE_DATA;`, sandbox);
  const proto = sandbox.LYRE_DATA as {
    tracks: { id: string; kind: string; title: string; file: string; dur: number; tags: Record<string, string[]>; energy: number; folder: string }[];
    playlists: { id: string; name: string; items?: string[] }[];
    boards: { id: string; cols: number; rows: number; slots: ({ id: string; label: string; key: string } | null)[]; spare: { id: string }[] }[];
    campaigns: { id: string; sessions: { id: string; n: number; scenes: { id: string; name: string; music: string[]; amb: string }[] }[] }[];
    tagValues: Record<string, string[]>;
    orders: Record<string, Record<string, { shuffle: boolean; repeat: string }>>;
    sceneNames: Record<string, Record<string, string>>;
    moved: { from: string; playlists: number; tracks: number; boards: number; pads: number; bookmarks: number; notMoved: [string, string][] };
  };
  const seed = prototypeSeed();

  it("has every track with the same title, file, length, energy, folder and tags", () => {
    expect(seed.tracks.map((t) => t.id)).toEqual(proto.tracks.map((t) => t.id));
    for (const [i, t] of proto.tracks.entries()) {
      const s = seed.tracks[i];
      expect([s.kind, s.title, s.fileName, s.durationMs, s.energy ?? 0, s.folder, s.tags]).toEqual([t.kind, t.title, t.file, Math.round(t.dur * 1000), t.energy, t.folder, t.tags]);
    }
  });

  it("has every tag value, playlist, board and campaign tree", () => {
    expect(Object.fromEntries(seed.tagGroups.map((g) => [g.id, g.values]))).toEqual(proto.tagValues);
    expect(seed.playlists.map((p) => [p.id, p.name, p.kind === "manual" ? p.trackIds : null])).toEqual(proto.playlists.map((p) => [p.id, p.name, p.items ?? null]));
    expect(seed.boards.map((b) => [b.id, b.cols, b.rows, b.slots.map((p) => p && [p.id, p.label, p.key]), b.spare.map((p) => p.id)])).toEqual(
      proto.boards.map((b) => [b.id, b.cols, b.rows, b.slots.map((p) => p && [p.id, p.label, p.key]), b.spare.map((p) => p.id)]),
    );
    const scenes = (c: { sessions: { id: string; scenes: { id: string; name: string }[] }[] }) => c.sessions.map((s) => [s.id, s.scenes.map((x) => [x.id, x.name])]);
    expect(seed.campaigns.map(scenes)).toEqual(proto.campaigns.map(scenes));
    expect(seed.campaigns[0].sessions[2].scenes[2].music.map((r) => r.id)).toEqual(proto.campaigns[0].sessions[2].scenes[2].music);
  });

  it("has the round 5 samples: play orders, names in scenes, shapes, missing files, tracks on hand, a pad put aside, the move report", () => {
    const p = proto as unknown as {
      tracks: { id: string; shape?: string; missing?: boolean }[];
      playlists: { id: string; order?: { shuffle: boolean; repeat: string } }[];
      boards: { spare: { id: string; aside?: boolean }[] }[];
      campaigns: { id: string; tracks: string[]; sessions: { tracks: string[] }[] }[];
    };
    expect(seed.playOrders).toEqual(proto.orders);
    expect(trackNamesOf(seed.campaigns)).toEqual(proto.sceneNames);
    expect(seed.tracks.filter((t) => t.shape).map((t) => [t.id, t.shape])).toEqual(p.tracks.filter((t) => t.shape).map((t) => [t.id, t.shape]));
    expect(seed.missing).toEqual(p.tracks.filter((t) => t.missing).map((t) => t.id));
    expect(seed.playlists.map((x) => [x.id, x.order])).toEqual(p.playlists.map((x) => [x.id, x.order ?? null]));
    expect(seed.boards.flatMap((b) => b.spare.map((x) => [x.id, x.aside]))).toEqual(p.boards.flatMap((b) => b.spare.map((x) => [x.id, !!x.aside])));
    expect(seed.campaigns.map((c) => [c.trackIds, c.sessions.map((s) => s.trackIds)])).toEqual(p.campaigns.map((c) => [c.tracks, c.sessions.map((s) => s.tracks)]));
    const m = proto.moved;
    expect(seed.moved.from).toBe(m.from);
    expect(seed.moved.copied.map((r) => r.count)).toEqual([m.playlists, m.tracks, m.boards, m.pads, m.bookmarks]);
    expect(seed.moved.notBrought.map((r) => [r.what, r.why])).toEqual(m.notMoved);
  });

  it("DAT-13: has each track's loudness as the prototype draws it, so Lyre suggests the prototype's shapes", () => {
    // core.js needs a page only once it draws; its rules run with these stand-ins.
    const page: unknown = new Proxy(function () {}, { get: (_t, key): unknown => (key === Symbol.toPrimitive ? () => "" : page), apply: (): unknown => page });
    const nothing = (): undefined => undefined;
    const box: Record<string, unknown> = {
      Math, JSON, Date, console, setTimeout, clearTimeout, setInterval: nothing, clearInterval: nothing, requestAnimationFrame: nothing, addEventListener: nothing,
      document: page, navigator: {}, location: { hash: "" }, localStorage: { getItem: (): null => null, setItem: nothing }, matchMedia: () => ({ matches: false, addEventListener: nothing }),
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(`${source}; this.LYRE_DATA = LYRE_DATA;`, box);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../../design/prototype/src/core.js"), "utf8"), box);
    const L = box.L as { data: { tracks: { id: string }[] }; suggestedShape(t: unknown): string; levels(t: unknown): number[] };
    expect(seed.tracks.map((t) => [t.id, t.suggestedShape])).toEqual(L.data.tracks.map((t) => [t.id, L.suggestedShape(t)]));
    // The levels are the prototype's curve spread over 1,000 points, as the library keeps a track's peaks.
    const t02 = L.data.tracks.find((t) => t.id === "t02");
    expect(seed.peaks.t02).toHaveLength(1000);
    expect(seed.peaks.t02[0]).toBeCloseTo(L.levels(t02)[0], 2);
    expect(seed.peaks.t02[999]).toBeCloseTo(L.levels(t02)[47], 2);
    expect(seed.tracks.find((t) => t.id === "t02")).toMatchObject({ shape: null, suggestedShape: "peaksThenFalls" });
  });
});

describe("the fake's sample library", () => {
  it("DAT-13: starts with every sample track's peaks worked out, as a library that has read its files", async () => {
    const api = createFakeLyreApi();
    expect(await api.library.peaksOf("t02")).toEqual(prototypeSeed().peaks.t02);
    expect((await api.library.listTracks()).find((t) => t.id === "t02")?.suggestedShape).toBe("peaksThenFalls");
  });
});

describe("in-memory fake only", () => {
  it("DAT-13: answers the prototype's loudness as a track's peaks, so it suggests the design's shapes", async () => {
    const api = createFakeLyreApi();
    await api.library.peaksOf("t02");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await api.library.peaksOf("t02"))?.length).toBe(1000);
    expect((await api.library.listTracks()).find((t) => t.id === "t02")).toMatchObject({ shape: null, suggestedShape: "peaksThenFalls" });
  });

  it("asks its chooser for files or a folder; closing the chooser imports nothing", async () => {
    let answer: string[] | null = null;
    const api = createFakeLyreApi({ choose: { files: () => answer, folder: () => "D:\\Albums" }, folderFiles: { "D:\\Albums": ["01 One.flac", "02 Two.mp3"] } });
    expect(valueOf(await api.import.start({ from: "choose-files" }))).toMatchObject({ cancelled: true, trackIds: [] });
    answer = ["D:\\x\\Song.ogg"];
    expect(valueOf(await api.import.start({ from: "choose-files" })).added).toHaveLength(1);
    const folder = valueOf(await api.import.start({ from: "choose-folder" }));
    expect(folder.added).toHaveLength(2);
    const tracks = await api.library.listTracks();
    expect(tracks.find((t) => t.id === folder.added[0])).toMatchObject({ metaTitle: "One", fileName: "01 One.flac", folder: "D:\\Albums", kind: "music" });
    expect(valueOf(await api.import.watchFolder({ from: "choose-folder" })).path).toBe("D:\\Albums");
  });

  it("files arriving in a watched folder become New tracks and are announced", async () => {
    const api = createFakeLyreApi();
    const events: LyreEvent[] = [];
    api.subscribe((e) => events.push(e));
    valueOf(await api.import.watchFolder({ from: "path", path: "H:\\Audio\\Incoming" }));
    const ids = await api.arrive("H:\\Audio\\Incoming", ["02 Peaceful Waters.flac"]);
    expect(ids).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toContainEqual({ type: "watched-files", folder: "H:\\Audio\\Incoming", trackIds: ids });
    expect((await api.library.listTracks()).find((t) => t.id === ids[0])).toMatchObject({ isNew: true, metaTitle: "Peaceful Waters" });
  });

  it("returns copies, so a screen changing what it was given changes nothing", async () => {
    const api = createFakeLyreApi();
    const [first] = await api.library.listTracks();
    first.tags.mood.push("Changed");
    expect((await api.library.listTracks())[0].tags.mood).not.toContain("Changed");
  });
});
