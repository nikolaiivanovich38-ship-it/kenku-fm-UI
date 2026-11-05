/**
 * DAT-11: the database hands out the shared domain shapes (src/common/domain),
 * so the engine and the screens apply the same rules to stored data as the
 * prototype did to its sample data. The prototype's own sample data
 * (design/prototype/src/data.js) is loaded through the repository write
 * functions, then read back as domain objects and compared with the same data
 * turned into domain objects directly.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseKeyOfPlace,
  playlistTracks,
  resolvePlayOrder,
  resolveProfile,
  sceneSequence,
  usesOfBoard,
  usesOfPlaylist,
  usesOfTrack,
  type AudioProfileInput,
  type DomainCampaign,
  type DomainLookup,
  type DomainPlaylist,
  type DomainTrack,
  type PlayOrder,
  type PlaylistRule,
  type SoundRef,
  type TrackShape,
} from "../../../common/domain";
import { makeTestStore } from "../test/testStore";
import type { Store } from "../store";
import { createTracks, updateTrack } from "./tracks";
import { createTag, listTagGroups, listTags, tagTracks } from "./tags";
import { addTracksToPlaylist, createPlaylist, listPlaylistTrackIds } from "./playlists";
import { addPad, createBoard, getBoardLayout } from "./boards";
import {
  addSceneBoards,
  addSceneMusic,
  addToCampaign,
  addToSession,
  createCampaign,
  createScene,
  createSession,
  setSceneAmbience,
} from "./campaigns";
import { getProfileOverrides, setProfileOverride } from "./profiles";
import { getPlayOrderOverrides, setPlayOrder } from "./playOrders";
import { getTrackNames, setSceneTrackName } from "./sceneNames";
import { getDomainCampaign, getDomainLookup, listDomainCampaigns, listUses } from "./domain";

/* The prototype's sample data, as the prototype defines it (seconds, display names). */
type ProtoProfile = {
  start: number;
  end: number;
  after: "loop" | "next" | "stop";
  loopStart: number;
  loopXfade?: number;
  fadeIn: { dur: number; shape: number };
  fadeOut: { dur: number; shape: number };
  markers: { at: number; label: string }[];
};
type ProtoTrack = {
  id: string;
  kind: "music" | "amb" | "fx";
  title: string;
  metaTitle: string;
  file: string;
  folder: string;
  dur: number;
  tags: Record<string, string[]>;
  energy: number;
  role: string;
  loop: string;
  profile?: ProtoProfile;
  /** Round 5 (DAT-13): the shape the game master chose. */
  shape?: TrackShape;
};
type ProtoRule = { conds: { group: string; match: "any" | "all" | "none"; values: string[] }[]; energy?: [number, number]; notRole?: string };
type ProtoPlaylist = { id: string; name: string; kind: "manual" | "dynamic"; lane: "music" | "amb" | "fx"; items?: string[]; rule?: ProtoRule; order?: PlayOrder };
type ProtoPad = { id: string; label: string; icon: string; color: string; key: string; mode: string; sound: { kind: string; files: string[]; order?: string }; vol: number; fade: number; aside?: boolean };
type ProtoBoard = { id: string; name: string; cols: number; rows: number; slots: (ProtoPad | null)[]; spare: ProtoPad[] };
type ProtoScene = { id: string; name: string; when: string; music: string[]; amb: string; boards: string[]; notes: string };
type ProtoSession = { id: string; n: number; name: string; date: string; status: "played" | "next" | "draft"; playlists: string[]; boards: string[]; tracks: string[]; scenes: ProtoScene[] };
type ProtoCampaign = {
  id: string;
  name: string;
  system: string;
  theme: string;
  blurb: string;
  obsidian: { vault: string; note: string; sessions: string };
  playlists: string[];
  boards: string[];
  tracks: string[];
  sessions: ProtoSession[];
};
type ProtoData = {
  tagGroups: { id: string; name: string }[];
  tracks: ProtoTrack[];
  playlists: ProtoPlaylist[];
  boards: ProtoBoard[];
  campaigns: ProtoCampaign[];
  profiles: Record<string, Record<string, ProtoProfile>>;
  /** Round 5 (PLY-13): play order chosen in one place, by place key then playlist id. */
  orders: Record<string, Record<string, PlayOrder>>;
  /** Round 5 (DAT-14): a track's name in one scene, by scene key then track id. */
  sceneNames: Record<string, Record<string, string>>;
};

function loadPrototypeData(): ProtoData {
  const file = path.resolve(__dirname, "../../../../design/prototype/src/data.js");
  return vm.runInNewContext(`${fs.readFileSync(file, "utf8")}\n;LYRE_DATA`) as ProtoData;
}

const ROLE: Record<string, DomainTrack["role"]> = {
  "": null,
  Sting: "sting",
  "Loop bed": "loop_bed",
  Underscore: "underscore",
  Transition: "transition",
  Effect: "effect",
};
const MODE: Record<string, string> = { oneshot: "oneshot", toggle: "toggle", hold: "hold", retrigger: "retrigger" };
const ms = (seconds: number) => Math.round(seconds * 1000);

function toProfile(p: ProtoProfile): AudioProfileInput {
  return {
    startMs: ms(p.start),
    endMs: ms(p.end),
    after: p.after,
    loopStartMs: ms(p.loopStart),
    ...(p.loopXfade === undefined ? {} : { loopCrossfadeMs: ms(p.loopXfade) }),
    fadeIn: { ms: ms(p.fadeIn.dur), shape: p.fadeIn.shape },
    fadeOut: { ms: ms(p.fadeOut.dur), shape: p.fadeOut.shape },
    markers: p.markers.map((m) => ({ atMs: ms(m.at), label: m.label })),
  };
}

/** Loads the prototype data through the repository; returns how prototype ids map to database ones. */
function loadIntoDatabase(store: Store, data: ProtoData) {
  // Tag groups: the new library already has Mood, Leitmotif and Scene type.
  const groups = listTagGroups(store);
  const groupId: Record<string, string> = {};
  for (const g of data.tagGroups) groupId[g.id] = groups.find((x) => x.name === g.name)!.id;
  const tagId = (protoGroup: string, name: string) => {
    const existing = listTags(store, { groupId: groupId[protoGroup] }).find((x) => x.name === name);
    return existing ? existing.id : createTag(store, { groupId: groupId[protoGroup], name }).id;
  };

  createTracks(
    store,
    data.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      metaTitle: t.metaTitle,
      file: { path: `${t.folder}\\${t.file}` },
      durationMs: ms(t.dur),
      energy: t.energy || null,
      role: ROLE[t.role],
      loopable: (t.loop || null) as DomainTrack["loop"],
      profile: t.profile ? toProfile(t.profile) : null,
    })),
  );
  for (const t of data.tracks) {
    const ids = Object.entries(t.tags).flatMap(([g, names]) => names.map((name) => tagId(g, name)));
    if (ids.length) void tagTracks(store, [t.id], ids);
    if (t.shape) updateTrack(store, t.id, { shape: t.shape });
  }

  const rule = (r: ProtoRule) => toRule(r, groupId);
  for (const p of data.playlists) {
    if (p.kind === "manual") {
      createPlaylist(store, { id: p.id, title: p.name, kind: "manual", lane: p.lane });
      addTracksToPlaylist(store, p.id, p.items!);
    } else {
      createPlaylist(store, { id: p.id, title: p.name, kind: "dynamic", lane: p.lane, rule: rule(p.rule!) });
    }
    if (p.order) setPlayOrder(store, p.id, null, p.order);
  }

  // Pad sounds name files; a file that is not in the library yet is added as a sound effect.
  const fxByFile = new Map(data.tracks.filter((t) => t.kind === "fx").map((t) => [t.file, t.id]));
  const fileTrack = (file: string) => {
    let id = fxByFile.get(file);
    if (!id) {
      id = createTracks(store, [{ kind: "fx", metaTitle: file, file: { path: `H:\\Audio\\Effects\\${file}` } }])[0].id;
      fxByFile.set(file, id);
    }
    return id;
  };
  const padInput = (p: ProtoPad) => ({
    id: p.id,
    label: p.label,
    icon: p.icon,
    color: p.color,
    hotkey: p.key || null,
    mode: MODE[p.mode],
    sound: {
      kind: p.sound.kind,
      trackIds: p.sound.files.map(fileTrack),
      order: p.sound.order === "roundrobin" ? "in_turn" : "random",
    },
    volume: p.vol / 100,
    fadeMs: ms(p.fade),
  });
  for (const b of data.boards) {
    createBoard(store, { id: b.id, title: b.name, cols: b.cols, rows: b.rows });
    b.slots.forEach((p, i) => {
      if (p) addPad(store, b.id, { ...padInput(p), at: { row: Math.floor(i / b.cols), col: i % b.cols } } as never);
    });
    // Every spare pad of the sample was put there by hand (round 5: "Mugs clink stays in Spare pads, where you put it").
    for (const p of b.spare) addPad(store, b.id, { ...padInput(p), at: "spare" } as never);
  }

  const trackIds = new Set(data.tracks.map((t) => t.id));
  const ref = (id: string): SoundRef => (trackIds.has(id) ? { kind: "track", id } : { kind: "playlist", id });
  for (const c of data.campaigns) {
    createCampaign(store, {
      id: c.id,
      name: c.name,
      theme: c.theme as never,
      system: c.system,
      description: c.blurb,
      obsidian: { vault: c.obsidian.vault, note: c.obsidian.note, sessionsFolder: c.obsidian.sessions },
      firstSessionNumber: c.sessions[0]?.n ?? 1,
    });
    addToCampaign(store, c.id, { playlistIds: c.playlists, boardIds: c.boards, trackIds: c.tracks });
    for (const s of c.sessions) {
      createSession(store, { id: s.id, campaignId: c.id, name: s.name, date: s.date || null, status: s.status });
      addToSession(store, s.id, { playlistIds: s.playlists, boardIds: s.boards, trackIds: s.tracks });
      for (const sc of s.scenes) {
        createScene(store, { id: sc.id, sessionId: s.id, name: sc.name, startsWhen: sc.when, notes: sc.notes });
        addSceneMusic(store, sc.id, sc.music.map(ref));
        if (sc.amb) setSceneAmbience(store, sc.id, ref(sc.amb));
        addSceneBoards(store, sc.id, sc.boards);
      }
    }
  }
  for (const [key, byTrack] of Object.entries(data.profiles)) {
    const [, campaignId, sessionId, sceneId] = key.split(":");
    for (const [trackId, p] of Object.entries(byTrack)) {
      setProfileOverride(store, { kind: "scene", campaignId, sessionId, sceneId }, trackId, toProfile(p));
    }
  }
  for (const [key, byPlaylist] of Object.entries(data.orders)) {
    for (const [playlistId, order] of Object.entries(byPlaylist)) setPlayOrder(store, playlistId, parseKeyOfPlace(key), order);
  }
  for (const [key, byTrack] of Object.entries(data.sceneNames)) {
    const sceneId = key.split(":")[3];
    for (const [trackId, name] of Object.entries(byTrack)) setSceneTrackName(store, sceneId, trackId, name);
  }
  return { groupId };
}

function toRule(r: ProtoRule, groupId: Record<string, string>): PlaylistRule {
  return {
    conds: r.conds.map((c) => ({ group: groupId[c.group], match: c.match, values: c.values })),
    ...(r.energy ? { energy: r.energy } : {}),
    ...(r.notRole === "Sting" ? { leaveOutStings: true } : {}),
  };
}

/* The same data as domain objects, built directly. */
function expectedPlaylist(p: ProtoPlaylist, groupId: Record<string, string>): DomainPlaylist {
  const order = p.order ? { shuffle: p.order.shuffle, repeat: p.order.repeat } : null;
  return p.kind === "manual"
    ? { id: p.id, name: p.name, lane: p.lane, order, kind: "manual", trackIds: p.items! }
    : { id: p.id, name: p.name, lane: p.lane, order, kind: "dynamic", rule: toRule(p.rule!, groupId) };
}

function expectedTrack(t: ProtoTrack, groupId: Record<string, string>): DomainTrack {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    metaTitle: t.metaTitle,
    fileName: t.file,
    durationMs: ms(t.dur),
    role: ROLE[t.role],
    loop: (t.loop || null) as DomainTrack["loop"],
    energy: t.energy || null,
    tags: Object.fromEntries(Object.entries(t.tags).map(([g, v]) => [groupId[g], [...v].sort()])),
    profile: t.profile ? toProfile(t.profile) : null,
    shape: t.shape ?? null,
    // The prototype makes up a loudness curve for its suggestion (core.js L.levels); the database has no peaks here.
    suggestedShape: null,
  };
}

function expectedCampaigns(data: ProtoData): DomainCampaign[] {
  const trackIds = new Set(data.tracks.map((t) => t.id));
  const ref = (id: string): SoundRef => (trackIds.has(id) ? { kind: "track", id } : { kind: "playlist", id });
  return data.campaigns.map((c) => ({
    id: c.id,
    playlistIds: c.playlists,
    boardIds: c.boards,
    trackIds: c.tracks,
    sessions: c.sessions.map((s) => ({
      id: s.id,
      campaignId: c.id,
      playlistIds: s.playlists,
      boardIds: s.boards,
      trackIds: s.tracks,
      scenes: s.scenes.map((sc) => ({
        id: sc.id,
        name: sc.name,
        music: sc.music.map(ref),
        ambience: sc.amb ? ref(sc.amb) : null,
        boardIds: sc.boards,
      })),
    })),
  }));
}

const sortTags = (t: DomainTrack): DomainTrack => ({
  ...t,
  tags: Object.fromEntries(Object.entries(t.tags).map(([g, v]) => [g, [...v].sort()])),
});

let t: ReturnType<typeof makeTestStore>;
let data: ProtoData;
let groupId: Record<string, string>;
let lookup: DomainLookup;
let protoLookup: DomainLookup;
let campaigns: DomainCampaign[];
let protoCampaigns: DomainCampaign[];

beforeAll(() => {
  t = makeTestStore();
  data = loadPrototypeData();
  ({ groupId } = loadIntoDatabase(t.store, data));
  lookup = getDomainLookup(t.store);
  campaigns = listDomainCampaigns(t.store);
  protoCampaigns = expectedCampaigns(data);
  const protoTracks = new Map(data.tracks.map((x) => [x.id, expectedTrack(x, groupId)]));
  const protoPlaylists = new Map(data.playlists.map((p) => [p.id, expectedPlaylist(p, groupId)]));
  protoLookup = {
    track: (id) => protoTracks.get(id),
    playlist: (id) => protoPlaylists.get(id),
    tracks: () => protoTracks.values(),
  };
});
afterAll(() => t.close());

describe("domain shapes from the database (DAT-11, DAT-12)", () => {
  it("gives every track as the shared DomainTrack", () => {
    for (const p of data.tracks) {
      expect(sortTags(lookup.track(p.id)!), p.id).toEqual(expectedTrack(p, groupId));
    }
    expect(lookup.track("missing")).toBeUndefined();
    // Every track, including the pad sounds added as effects.
    expect([...lookup.tracks()].length).toBeGreaterThan(data.tracks.length);
  });

  it("gives manual and dynamic playlists with their lane and rule", () => {
    for (const p of data.playlists) expect(lookup.playlist(p.id), p.id).toEqual(expectedPlaylist(p, groupId));
    expect(lookup.playlist("p-coast")).toEqual({ id: "p-coast", name: "Coast road travel", lane: "music", order: null, kind: "manual", trackIds: ["t23", "t03", "t10", "t29"] });
    expect(lookup.playlist("a-inn")).toMatchObject({ lane: "amb", kind: "manual", trackIds: ["b03", "b08"] });
    expect(lookup.playlist("p-combat-big")).toEqual({
      id: "p-combat-big",
      name: "Combat: big and loopable",
      lane: "music",
      order: { shuffle: true, repeat: "all" },
      kind: "dynamic",
      rule: { conds: [{ group: groupId.scene, match: "any", values: ["Combat"] }], energy: [4, 5], leaveOutStings: true },
    });
    expect(lookup.playlist("missing")).toBeUndefined();
  });

  it("plays the same tracks from every playlist as the in-memory data", () => {
    for (const p of data.playlists) {
      const fromDb = playlistTracks(lookup.playlist(p.id)!, lookup).map((x) => x.id);
      const fromMemory = playlistTracks(protoLookup.playlist(p.id)!, protoLookup).map((x) => x.id);
      expect(fromDb, p.id).toEqual(fromMemory);
    }
    // A dynamic rule really selects: big combat music without stings.
    expect(playlistTracks(lookup.playlist("p-combat-big")!, lookup).map((x) => x.id)).toEqual(
      expect.arrayContaining(["t04", "t06", "t08", "t31"]),
    );
    expect(playlistTracks(lookup.playlist("p-combat-big")!, lookup).map((x) => x.id)).not.toContain("t39");
  });

  it("works out every playlist's tracks in the database exactly as the shared rule does", () => {
    for (const p of data.playlists) {
      expect(listPlaylistTrackIds(t.store, p.id), p.id).toEqual(playlistTracks(protoLookup.playlist(p.id)!, protoLookup).map((x) => x.id));
    }
  });

  it("gives the campaign trees in order", () => {
    expect(campaigns).toEqual(protoCampaigns);
    expect(getDomainCampaign(t.store, "crown")).toEqual(protoCampaigns[0]);
    expect(getDomainCampaign(t.store, "missing")).toBeNull();
  });

  it("finds where things are used exactly as the in-memory data does", () => {
    for (const p of data.playlists) expect(usesOfPlaylist(p.id, campaigns), p.id).toEqual(usesOfPlaylist(p.id, protoCampaigns));
    for (const b of data.boards) expect(usesOfBoard(b.id, campaigns), b.id).toEqual(usesOfBoard(b.id, protoCampaigns));
    for (const x of data.tracks) expect(usesOfTrack(x.id, campaigns), x.id).toEqual(usesOfTrack(x.id, protoCampaigns));
    expect(usesOfBoard("abbey", campaigns)).toHaveLength(4);
    // The database's own answer (listUses, through its indexes) is the same, in the same order.
    for (const p of data.playlists) expect(listUses(t.store, { playlistId: p.id }), p.id).toEqual(usesOfPlaylist(p.id, protoCampaigns));
    for (const b of data.boards) expect(listUses(t.store, { boardId: b.id }), b.id).toEqual(usesOfBoard(b.id, protoCampaigns));
    for (const x of data.tracks) expect(listUses(t.store, { trackId: x.id }), x.id).toEqual(usesOfTrack(x.id, protoCampaigns));
  });

  it("plays every scene's music in the same order", () => {
    for (const c of campaigns)
      for (const s of c.sessions)
        for (const sc of s.scenes) {
          const proto = protoCampaigns.find((x) => x.id === c.id)!.sessions.find((x) => x.id === s.id)!.scenes.find((x) => x.id === sc.id)!;
          expect(sceneSequence(sc, lookup), sc.id).toEqual(sceneSequence(proto, protoLookup));
        }
  });

  it("gives profile overrides by place key, and the shared rule picks the scene's own", () => {
    const overrides = getProfileOverrides(t.store);
    expect(Object.keys(overrides)).toEqual(["sc:crown:s14:sc3"]);
    const t13 = lookup.track("t13")!;
    const inScene = resolveProfile(t13, [{ kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" }], overrides);
    expect(inScene.source).toBe("scene");
    expect(inScene.profile).toMatchObject({ endMs: 190_000, after: "next" });
    const elsewhere = resolveProfile(t13, [{ kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc4" }], overrides);
    expect(elsewhere).toMatchObject({ source: "track", profile: { endMs: 318_000, after: "loop", loopStartMs: 64_000 } });
  });
});

describe("design round 5 samples from the database (PLY-13, DAT-14, DAT-13, ORG-12, SFX-11)", () => {
  it("gives the play order chosen in each place, and resolvePlayOrder answers as it does on the prototype's data", () => {
    const overrides = getPlayOrderOverrides(t.store);
    expect(overrides).toEqual(data.orders);
    const places = [null, ...Object.keys(data.orders).map(parseKeyOfPlace), parseKeyOfPlace("sc:crown:s14:sc4"), parseKeyOfPlace("cp:crown")];
    for (const p of data.playlists) {
      for (const place of places) {
        expect(resolvePlayOrder(p.id, lookup.playlist(p.id)!.order, place, overrides), `${p.id} ${JSON.stringify(place)}`).toEqual(
          resolvePlayOrder(p.id, p.order ?? null, place, data.orders),
        );
      }
    }
  });

  it("gives the names tracks have in scenes, keyed as trackNameIn takes them", () => {
    expect(getTrackNames(t.store)).toEqual(data.sceneNames);
  });

  it("gives the shapes the game master chose", () => {
    expect([...lookup.tracks()].filter((x) => x.shape).map((x) => [x.id, x.shape])).toEqual([
      ["t06", "builds"],
      ["t15", "fallsAway"],
    ]);
  });

  it("keeps tracks on hand and a pad put aside by hand", () => {
    expect(campaigns.find((c) => c.id === "crown")!.trackIds).toEqual(["t26"]);
    expect(listUses(t.store, { trackId: "t26" })).toEqual(usesOfTrack("t26", protoCampaigns));
    expect(listUses(t.store, { trackId: "t26" })[0]).toEqual({ level: "campaign", campaignId: "crown" });
    for (const b of data.boards) {
      expect(getBoardLayout(t.store, b.id).spare.map((p) => [p.id, p.putAside]), b.id).toEqual(b.spare.map((p) => [p.id, !!p.aside]));
    }
  });
});
