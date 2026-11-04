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
  playlistTracks,
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
  type PlaylistRule,
  type SoundRef,
} from "../../../common/domain";
import { makeTestStore } from "../test/testStore";
import type { Store } from "../store";
import { createTracks } from "./tracks";
import { createTag, listTagGroups, listTags, tagTracks } from "./tags";
import { addTracksToPlaylist, createPlaylist } from "./playlists";
import { addPad, createBoard } from "./boards";
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
import { getDomainCampaign, getDomainLookup, listDomainCampaigns } from "./domain";

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
};
type ProtoRule = { conds: { group: string; match: "any" | "all" | "none"; values: string[] }[]; energy?: [number, number]; notRole?: string };
type ProtoPlaylist = { id: string; name: string; kind: "manual" | "dynamic"; lane: "music" | "amb" | "fx"; items?: string[]; rule?: ProtoRule };
type ProtoPad = { id: string; label: string; icon: string; color: string; key: string; mode: string; sound: { kind: string; files: string[]; order?: string }; vol: number; fade: number };
type ProtoBoard = { id: string; name: string; cols: number; rows: number; slots: (ProtoPad | null)[]; spare: ProtoPad[] };
type ProtoScene = { id: string; name: string; when: string; music: string[]; amb: string; boards: string[]; notes: string };
type ProtoSession = { id: string; n: number; name: string; date: string; status: "played" | "next" | "draft"; playlists: string[]; boards: string[]; scenes: ProtoScene[] };
type ProtoCampaign = {
  id: string;
  name: string;
  system: string;
  theme: string;
  blurb: string;
  obsidian: { vault: string; note: string; sessions: string };
  playlists: string[];
  boards: string[];
  sessions: ProtoSession[];
};
type ProtoData = {
  tagGroups: { id: string; name: string }[];
  tracks: ProtoTrack[];
  playlists: ProtoPlaylist[];
  boards: ProtoBoard[];
  campaigns: ProtoCampaign[];
  profiles: Record<string, Record<string, ProtoProfile>>;
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
const MODE: Record<string, string> = { oneshot: "oneshot", toggle: "toggle", hold: "hold", retrigger: "restart" };
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
    if (ids.length) tagTracks(store, [t.id], ids);
  }

  const rule = (r: ProtoRule) => toRule(r, groupId);
  for (const p of data.playlists) {
    if (p.kind === "manual") {
      createPlaylist(store, { id: p.id, title: p.name, kind: "manual", lane: p.lane });
      addTracksToPlaylist(store, p.id, p.items!);
    } else {
      createPlaylist(store, { id: p.id, title: p.name, kind: "dynamic", lane: p.lane, rule: rule(p.rule!) });
    }
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
    });
    addToCampaign(store, c.id, { playlistIds: c.playlists, boardIds: c.boards });
    for (const s of c.sessions) {
      createSession(store, { id: s.id, campaignId: c.id, number: s.n, name: s.name, date: s.date || null, status: s.status });
      addToSession(store, s.id, { playlistIds: s.playlists, boardIds: s.boards });
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
  return p.kind === "manual"
    ? { id: p.id, name: p.name, lane: p.lane, kind: "manual", trackIds: p.items! }
    : { id: p.id, name: p.name, lane: p.lane, kind: "dynamic", rule: toRule(p.rule!, groupId) };
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
  };
}

function expectedCampaigns(data: ProtoData): DomainCampaign[] {
  const trackIds = new Set(data.tracks.map((t) => t.id));
  const ref = (id: string): SoundRef => (trackIds.has(id) ? { kind: "track", id } : { kind: "playlist", id });
  return data.campaigns.map((c) => ({
    id: c.id,
    playlistIds: c.playlists,
    boardIds: c.boards,
    sessions: c.sessions.map((s) => ({
      id: s.id,
      campaignId: c.id,
      playlistIds: s.playlists,
      boardIds: s.boards,
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
    expect(lookup.playlist("p-coast")).toEqual({ id: "p-coast", name: "Coast road travel", lane: "music", kind: "manual", trackIds: ["t23", "t03", "t10", "t29"] });
    expect(lookup.playlist("a-inn")).toMatchObject({ lane: "amb", kind: "manual", trackIds: ["b03", "b08"] });
    expect(lookup.playlist("p-combat-big")).toEqual({
      id: "p-combat-big",
      name: "Combat: big and loopable",
      lane: "music",
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
