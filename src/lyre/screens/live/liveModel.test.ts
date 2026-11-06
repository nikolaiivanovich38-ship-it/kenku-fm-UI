/**
 * Live's rules without a screen (design/prototype/src/views/live.js): which session Live loads, the rooms and their
 * one status, where each box sends its sound, Off script search, the scene's lists, the pads, the end words and what
 * each key does.
 */
import { describe, expect, it } from "vitest";

import type { AudioProfile } from "../../../common/domain";
import { prototypeSeed } from "../../../common/lyre/seed";
import type { LyreOutputs } from "../../../common/lyreOutputs";
import { EMPTY_NOW_PLAYING } from "../../audio/testing/fakeLyreAudio";
import type { LaneNowPlaying, NowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
import { PROTOTYPE_OUTPUTS, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import { libraryIndex } from "../campaigns/model";
import {
  addRoomChoices,
  boardMenu,
  boxTarget,
  busiestChannel,
  currentBoard,
  defaultLiveSession,
  endWords,
  liveKey,
  liveRooms,
  moodsByUse,
  offScriptSearch,
  padForKey,
  playlistGroups,
  roomStatus,
  selectedList,
  sceneBoards,
  type KeyInput,
  type OffScriptQuery,
} from "./liveModel";

const seed = prototypeSeed();
const index = libraryIndex(seed.tracks, seed.playlists, seed.boards);
const crown = seed.campaigns[0];
const s14 = crown.sessions.find((s) => s.id === "s14")!;
const abbey = s14.scenes[2];

const room = (roomId: string, name: string, over: Partial<RoomNowPlaying> = {}): RoomNowPlaying => ({
  roomId,
  name,
  volume: 0.85,
  music: null,
  ambience: null,
  upNext: null,
  queued: [],
  upNextList: [],
  repeat: { chosen: null, shown: "off" },
  canUndoUpNext: false,
  effects: [],
  ...over,
});
const playing: LaneNowPlaying = { trackId: "t13", title: "Eerie", origin: { kind: "single" }, playlistId: null, position: 1, length: 10, paused: false, loading: false, place: null, playOrder: null, gainDb: 0 };
const withSide = (status: "joining" | "connected"): LyreOutputs => ({
  ...PROTOTYPE_OUTPUTS,
  bots: [PROTOTYPE_OUTPUTS.bots[0], { ...PROTOTYPE_OUTPUTS.bots[1], room: { serverId: "1001", channelId: "1012", status } }],
});

describe("the session Live loads", () => {
  it("keeps the session already loaded", () => {
    expect(defaultLiveSession(seed.campaigns, { campaignId: "sixth", sessionId: "w3" }, undefined)).toEqual({ campaignId: "sixth", sessionId: "w3" });
  });

  it("else the next session of the campaign in hand, else of the first campaign", () => {
    expect(defaultLiveSession(seed.campaigns, null, "masks")).toEqual({ campaignId: "masks", sessionId: "v7" });
    expect(defaultLiveSession(seed.campaigns, null, undefined)).toEqual({ campaignId: "crown", sessionId: "s14" });
  });

  it("a loaded session that has gone falls back to the next one", () => {
    expect(defaultLiveSession(seed.campaigns, { campaignId: "crown", sessionId: "gone" }, undefined)).toEqual({ campaignId: "crown", sessionId: "s14" });
  });
});

describe("rooms: one On air box per bot in a voice channel", () => {
  it("names each room after its channel and finds what it plays", () => {
    const now: NowPlaying = { ...EMPTY_NOW_PLAYING, rooms: [room(TABLE_BOT, "Table", { music: playing })] };
    const rooms = liveRooms(PROTOTYPE_OUTPUTS, now);
    expect(rooms.map((r) => r.name)).toEqual(["Table"]);
    expect(rooms[0].room?.music?.trackId).toBe("t13");
    expect(rooms[0].bot?.id).toBe(TABLE_BOT);
  });

  it("a bot joining a room gets its box at once, saying Joining", () => {
    const rooms = liveRooms(withSide("joining"), EMPTY_NOW_PLAYING);
    expect(rooms.map((r) => r.name)).toEqual(["Table", "Side room"]);
    expect(roomStatus(rooms[1])).toEqual({ text: "Joining", tone: "warn" });
  });

  it("without the outputs (no bots known), the audio host's rooms are the rooms; the table alone is no room", () => {
    expect(liveRooms(null, EMPTY_NOW_PLAYING)).toEqual([]);
    expect(liveRooms(null, { ...EMPTY_NOW_PLAYING, rooms: [room("b1", "Table"), room("b2", "Side room")] }).map((r) => r.name)).toEqual(["Table", "Side room"]);
  });

  it("has one status: Muted, Playing, Paused or Silent", () => {
    const [table] = liveRooms(PROTOTYPE_OUTPUTS, EMPTY_NOW_PLAYING);
    expect(roomStatus(table)).toEqual({ text: "Silent", tone: "idle" });
    expect(roomStatus({ ...table, room: room(TABLE_BOT, "Table", { music: playing }) })).toEqual({ text: "Playing", tone: "live" });
    expect(roomStatus({ ...table, room: room(TABLE_BOT, "Table", { music: { ...playing, paused: true } }) })).toEqual({ text: "Paused", tone: "idle" });
    expect(roomStatus({ ...table, room: room(TABLE_BOT, "Table", { effects: [{ trackId: "f04", title: "Thunder", padKey: "weather/thunder" }] }) }).text).toBe("Playing");
    expect(roomStatus({ ...table, bot: { ...table.bot!, muted: true }, room: room(TABLE_BOT, "Table", { music: playing }) })).toEqual({ text: "Muted", tone: "idle" });
  });

  it("Add a room offers each logged-in bot in no room, with every channel; channels with a room already are not offered", () => {
    const choices = addRoomChoices(PROTOTYPE_OUTPUTS);
    expect(choices.map((c) => c.bot.name)).toEqual(["Lyre Side"]);
    const gull = choices[0].servers[0];
    expect(gull.server).toBe("The Gull and Lantern");
    expect(gull.items.find((i) => i.name === "Table")).toMatchObject({ taken: true });
    expect(gull.items.find((i) => i.name === "Side room")).toMatchObject({ taken: false, sub: "Empty" });
    expect(addRoomChoices(withSide("connected"))).toEqual([]);
  });

  it("the one-click fix when nobody hears anything joins the channel most people are in", () => {
    expect(busiestChannel(PROTOTYPE_OUTPUTS)).toMatchObject({ channelId: "1011", name: "Table", people: 5 });
  });
});

describe("To: where each box plays", () => {
  const rooms = liveRooms(withSide("connected"), EMPTY_NOW_PLAYING);
  it("the first room unless the box chose another that is still there, or all rooms", () => {
    expect(boxTarget(rooms, undefined)).toEqual({ choice: TABLE_BOT, targets: [{ room: TABLE_BOT }], name: "Table" });
    expect(boxTarget(rooms, SIDE_BOT)).toEqual({ choice: SIDE_BOT, targets: [{ room: SIDE_BOT }], name: "Side room" });
    expect(boxTarget(rooms, "all")).toEqual({ choice: "all", targets: [{ room: TABLE_BOT }, { room: SIDE_BOT }], name: "all rooms" });
    expect(boxTarget(rooms.slice(0, 1), SIDE_BOT).name).toBe("Table");
  });

  it("with no room, sound goes to the table (which nobody hears)", () => {
    expect(boxTarget([], undefined)).toEqual({ choice: "table", targets: [{ room: "table" }], name: "Table" });
  });
});

describe("Off script search", () => {
  const music: OffScriptQuery = { q: "", tags: [], lane: "all" };
  it("finds every word in a track's titles, file, artist, album, role and tags", () => {
    const found = offScriptSearch(seed.tracks, { ...music, q: "bells" }).list.map((t) => t.id);
    expect(found).toEqual(expect.arrayContaining(["t42", "b06"]));
    expect(offScriptSearch(seed.tracks, { ...music, q: "drowned bells" }).list.map((t) => t.id)).toEqual(["t42"]);
  });

  it("FX is sound effects and stings", () => {
    expect(offScriptSearch(seed.tracks, { ...music, q: "door", lane: "fx" }).list.map((t) => t.id)).toEqual(["f08", "f10"]);
  });

  it("picked tags must all match; when none has all of them, tracks with some, most first", () => {
    const both = offScriptSearch(seed.tracks, { ...music, tags: [{ group: "mood", value: "Eerie" }, { group: "mood", value: "Dread" }] });
    expect(both.any).toBe(false);
    expect(both.list.map((t) => t.id)).toContain("t13");
    const some = offScriptSearch(seed.tracks, { ...music, tags: [{ group: "mood", value: "Heroic" }, { group: "scene", value: "Ritual" }] });
    expect(some.any).toBe(true);
    expect(some.list.length).toBeGreaterThan(0);
  });

  it("moods are offered most used first", () => {
    const moods = moodsByUse(seed.tracks, seed.tagGroups[0].values);
    expect(moods).toHaveLength(seed.tagGroups[0].values.length);
    expect(moods.indexOf("Tense")).toBeLessThan(moods.indexOf("Pastoral"));
  });
});

describe("Scene music: what to play from", () => {
  it("the scene's own list, the session's and the campaign's playlists (music only, each once) and their single tracks", () => {
    const groups = playlistGroups(abbey, s14, crown, index);
    expect(groups.scene).toEqual(["p-abbey-eerie", "p-abbess"]);
    expect(groups.session).toEqual(["p-wistful"]);
    expect(groups.campaign).toEqual(["p-company", "p-ashen", "p-combat-big"]);
    expect(groups.campaignTracks).toEqual(["t26"]);
    expect(groups.sessionTracks).toEqual([]);
  });

  it("shows the scene unless a session or campaign playlist was chosen", () => {
    const groups = playlistGroups(abbey, s14, crown, index);
    expect(selectedList(null, groups, abbey)).toBe("scene");
    expect(selectedList("p-ashen", groups, abbey)).toBe("p-ashen");
    expect(selectedList("p-gone", groups, abbey)).toBe("scene");
    expect(selectedList(null, groups, { ...abbey, music: [] })).toBe("p-wistful");
  });
});

describe("pads", () => {
  it("a scene's boards, the first shown when it starts; the menu groups this scene, session, campaign, others", () => {
    expect(sceneBoards(abbey, index).map((b) => b.id)).toEqual(["abbey", "weather"]);
    expect(currentBoard(null, abbey, index)?.id).toBe("abbey");
    expect(currentBoard("combat", abbey, index)?.id).toBe("combat");
    const menu = boardMenu(abbey, s14, crown, index);
    expect(menu.map((g) => g.label)).toEqual(["This scene", "This campaign", "Other boards"]);
    expect(menu[1].boards.map((b) => b.id)).toEqual(["combat"]);
  });

  it("a key plays the pad on the board's grid with that key (spare pads have none)", () => {
    expect(padForKey(index.board("abbey")!, "R")?.label).toBe("Stone door grinds");
    expect(padForKey(index.board("weather")!, "x")).toBeNull();
  });
});

describe("what happens at the end, as a tooltip", () => {
  const profile = (over: Partial<AudioProfile>): AudioProfile => ({
    startMs: 0,
    endMs: 190_000,
    after: "next",
    loopStartMs: 0,
    loopCrossfadeMs: 0,
    fadeIn: { ms: 0, shape: 50 },
    fadeOut: { ms: 0, shape: 50 },
    markers: [],
    ...over,
  });
  it("says the end, what follows, and whose setting it is", () => {
    expect(endWords(profile({}), "scene")).toBe("Ends 3:10, then next (scene setting)");
    expect(endWords(profile({ after: "loop", loopStartMs: 64_000 }), "track")).toBe("Ends 3:10, loops from 1:04");
    expect(endWords(profile({ after: "stop" }), "playlist")).toBe("Ends 3:10, then stops (playlist setting)");
  });
});

describe("keys on the live screen", () => {
  const base: KeyInput = { key: " ", shift: false, ctrl: false, alt: false, repeat: false, typing: false, inSearch: false, searchValue: "", onControl: false, keyNav: false, keys1: true, keysOpen: false, searchActive: false };
  const key = (over: Partial<KeyInput>) => liveKey({ ...base, ...over });

  it("Space starts the next scene, unless it presses a button reached with Tab", () => {
    expect(key({})).toEqual({ kind: "nextScene" });
    expect(key({ onControl: true })).toEqual({ kind: "nextScene" });
    expect(key({ onControl: true, keyNav: true })).toEqual({ kind: "none" });
    expect(key({ repeat: true })).toEqual({ kind: "swallow" });
  });

  it("Shift+Esc fades everything, even while typing; Esc alone never fades", () => {
    expect(key({ key: "Escape", shift: true, typing: true })).toEqual({ kind: "fadeAll" });
    expect(key({ key: "Escape" })).toEqual({ kind: "none" });
    expect(key({ key: "Escape", searchActive: true })).toEqual({ kind: "clearSearch" });
    expect(key({ key: "Escape", keysOpen: true })).toEqual({ kind: "closeKeys" });
  });

  it("Esc in the search box clears it, then leaves it", () => {
    expect(key({ key: "Escape", typing: true, inSearch: true, searchValue: "bells" })).toEqual({ kind: "clearSearchBox" });
    expect(key({ key: "Escape", typing: true, inSearch: true })).toEqual({ kind: "leaveSearchBox" });
  });

  it("Ctrl+Z undoes the scene change, except in a text box", () => {
    expect(key({ key: "z", ctrl: true })).toEqual({ kind: "undo" });
    expect(key({ key: "z", ctrl: true, typing: true })).toEqual({ kind: "none" });
  });

  it("/ and pad keys; nothing while typing or with single-key shortcuts off", () => {
    expect(key({ key: "/" })).toEqual({ kind: "focusSearch" });
    expect(key({ key: "r" })).toEqual({ kind: "pad", key: "r" });
    expect(key({ key: "R", shift: true })).toEqual({ kind: "pad", key: "r" });
    expect(key({ key: "r", typing: true })).toEqual({ kind: "none" });
    expect(key({ key: "r", keys1: false })).toEqual({ kind: "none" });
    expect(key({ key: " ", keys1: false })).toEqual({ kind: "none" });
    expect(key({ key: "/", keys1: false })).toEqual({ kind: "none" });
    expect(key({ key: "Escape", shift: true, keys1: false })).toEqual({ kind: "fadeAll" });
    expect(key({ key: "r", alt: true })).toEqual({ kind: "none" });
    expect(key({ key: "F2" })).toEqual({ kind: "pad", key: "f2" });
  });
});
