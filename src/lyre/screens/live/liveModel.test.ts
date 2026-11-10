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
  boxTarget,
  busiestChannel,
  channelChoices,
  currentBoard,
  defaultLiveSession,
  endWords,
  findSearch,
  LIVE_KEYS,
  liveKey,
  liveRooms,
  moodsByUse,
  offScriptSearch,
  padForKey,
  padStepWords,
  roomStatus,
  sceneBoards,
  trayContents,
  upNextRows,
  type KeyInput,
  type OffScriptQuery,
} from "./liveModel";
import type { UpNextEntryNow } from "../../audio/lyreAudio";

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
  played: [],
  ...over,
});
const playing: LaneNowPlaying = { trackId: "t13", title: "Eerie", origin: { kind: "single" }, playlistId: null, position: 1, length: 10, paused: false, loading: false, place: null, playOrder: null, gainDb: 0, level: 1 };
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

  it("Must 2: a room whose voice channel has nobody in it says Nobody there, before Muted or Playing", () => {
    const rooms = liveRooms(withSide("connected"), EMPTY_NOW_PLAYING);
    expect(rooms[1].nobody).toBe(true);
    expect(rooms[0].nobody).toBe(false);
    expect(roomStatus({ ...rooms[1], room: room(SIDE_BOT, "Side room", { music: playing }) })).toEqual({ text: "Nobody there", tone: "warn" });
  });

  it("Add a room offers each logged-in bot in no room, with every channel; channels with a room already are not offered", () => {
    const choices = addRoomChoices(PROTOTYPE_OUTPUTS);
    expect(choices.map((c) => c.bot.name)).toEqual(["Lyre Side"]);
    const gull = choices[0].servers[0];
    expect(gull.server).toBe("The Gull and Lantern");
    expect(gull.items.find((i) => i.name === "Table")).toMatchObject({ taken: true });
    expect(gull.items.find((i) => i.name === "Side room")).toMatchObject({ taken: false, sub: "empty" });
    // Must 2: in a bot's own menu, where the players are is marked (the channel most people are in).
    const own = channelChoices(PROTOTYPE_OUTPUTS, PROTOTYPE_OUTPUTS.bots[0])[0].items;
    expect(own.filter((i) => i.sub.endsWith(" · players")).map((i) => `${i.name} ${i.sub}`)).toEqual(["Table 5 people · players"]);
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

describe("the trays: Session playlists and Campaign playlists", () => {
  it("each holds its music playlists (each once) and its single tracks (ORG-12)", () => {
    const ss = trayContents(s14, index);
    expect(ss.playlists.every((id) => index.playlist(id)?.lane === "music")).toBe(true);
    expect(new Set(ss.playlists).size).toBe(ss.playlists.length);
    const cp = trayContents(crown, index);
    expect(cp.tracks.map((id) => index.track(id)?.title)).toContain("Ominous song, the villain's calling card (short)");
  });
});

describe("Find a track or playlist (ORG-14)", () => {
  const all: OffScriptQuery = { q: "", tags: [], lane: "all" };
  it("finds playlists by name as well as tracks; nothing until there are words or tags", () => {
    expect(findSearch(index, all)).toBeNull();
    const r = findSearch(index, { ...all, q: "abbess" })!;
    expect(r.playlists.map((p) => p.name)).toContain("The Abbess");
    expect(r.count).toBe(r.playlists.length + r.tracks.length);
  });

  it("the Music, Ambience and FX filter narrows playlists too; a picked tag finds a playlist one of whose tracks has it", () => {
    expect(findSearch(index, { ...all, q: "abbess", lane: "amb" })!.playlists).toEqual([]);
    const tense = findSearch(index, { ...all, tags: [{ group: "mood", value: "Tense" }] })!;
    expect(tense.playlists.length).toBeGreaterThan(0);
    for (const p of tense.playlists) expect(index.tracksOf(p).some((t) => (t.tags.mood ?? []).includes("Tense"))).toBe(true);
  });
});

describe("Up next: the room's running list, folded to stay short (PLY-16, part 6)", () => {
  const plan = (n: number): UpNextEntryNow => ({ ref: { kind: "plan", key: `p${n}` }, kind: "planned", trackIds: [`t${n}`], title: `Planned ${n}`, playlistId: null, rest: false });
  const added = (n: number): UpNextEntryNow => ({ ref: { kind: "added", itemId: `a${n}` }, kind: "added", trackIds: [`x${n}`], title: `Added ${n}`, playlistId: null, rest: false });
  const titles = (rows: ReturnType<typeof upNextRows>) => rows.rows.map((r) => (r.kind === "entry" ? r.entry.title : r.kind === "more" ? `${r.n} more` : `ambience ${r.at}`));

  it("shows the plan's next track only, then how many more planned, then what was added", () => {
    const r = upNextRows([plan(1), plan(2), plan(3), added(1)], 0, false);
    expect(titles(r)).toEqual(["Planned 1", "2 more", "Added 1"]);
    expect(r.fewer).toBe(false);
  });

  it("past four lines it is one line: the first entry and how many more; unfolded, everything and Show fewer", () => {
    const list = [plan(1), plan(2), added(1), added(2), added(3), added(4)];
    const folded = upNextRows(list, 0, false);
    expect(titles(folded)).toEqual(["Planned 1", "5 more"]);
    expect(folded.rows[1]).toMatchObject({ kind: "more", inline: true });
    const open = upNextRows(list, 0, true);
    expect(titles(open)).toEqual(["Planned 1", "Planned 2", "Added 1", "Added 2", "Added 3", "Added 4"]);
    expect(open.fewer).toBe(true);
  });

  it("ambience waiting for Next on the ambience is at the bottom", () => {
    const r = upNextRows([plan(1)], 2, false);
    expect(r.rows.map((x) => x.kind)).toEqual(["entry", "ambience", "ambience"]);
  });

  it("empty when nothing is to come", () => {
    expect(upNextRows([], 0, false).rows).toEqual([]);
  });
});

describe("pads", () => {
  it("a scene's boards, the first shown when it starts", () => {
    expect(sceneBoards(abbey, index).map((b) => b.id)).toEqual(["abbey", "weather"]);
    expect(currentBoard(null, abbey, index)?.id).toBe("abbey");
    expect(currentBoard("weather", abbey, index)?.id).toBe("weather");
    // Current scene shows the scene's boards only: a board chosen before that is not one of them gives way.
    expect(currentBoard("combat", abbey, index)?.id).toBe("abbey");
    expect(currentBoard(null, null, index)).toBeNull();
  });

  it("a pad's fade step is said when it is pressed (PLY-8)", () => {
    const pad = index.board("weather")!.slots.find((p) => p)!;
    expect(padStepWords({ ...pad, steps: null })).toBeNull();
    expect(padStepWords({ ...pad, steps: [{ do: "sound" }, { do: "fade", level: 0.3, ms: 2000 }] })).toBe("Music down to 30% over 2 s");
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
  const base: KeyInput = {
    key: " ",
    name: "Space",
    code: "Space",
    shift: false,
    ctrl: false,
    alt: false,
    repeat: false,
    typing: false,
    inSearch: false,
    searchValue: "",
    onControl: false,
    onSceneName: false,
    keyNav: false,
    keys1: true,
    keysOpen: false,
    findOpen: false,
    searchActive: false,
    keys: LIVE_KEYS,
  };
  const key = (over: Partial<KeyInput>) => liveKey({ ...base, ...over });

  it("Space starts the next scene, unless it presses a button reached with Tab", () => {
    expect(key({})).toEqual({ kind: "nextScene" });
    expect(key({ onControl: true })).toEqual({ kind: "nextScene" });
    expect(key({ onControl: true, keyNav: true })).toEqual({ kind: "none" });
    expect(key({ repeat: true })).toEqual({ kind: "swallow" });
  });

  it("Shift+Esc fades everything, even while typing; Esc alone never fades", () => {
    expect(key({ key: "Escape", name: "Shift+Esc", shift: true, typing: true })).toEqual({ kind: "fadeAll" });
    expect(key({ key: "Escape", name: "Esc" })).toEqual({ kind: "none" });
    expect(key({ key: "Escape", name: "Esc", searchActive: true })).toEqual({ kind: "clearSearch" });
    expect(key({ key: "Escape", name: "Esc", keysOpen: true })).toEqual({ kind: "closeKeys" });
  });

  it("Esc in Find clears it, then closes its results and leaves it; Esc elsewhere closes the results first", () => {
    expect(key({ key: "Escape", name: "Esc", typing: true, inSearch: true, searchValue: "bells" })).toEqual({ kind: "clearSearchBox" });
    expect(key({ key: "Escape", name: "Esc", typing: true, inSearch: true, searchActive: true })).toEqual({ kind: "clearSearchBox" });
    expect(key({ key: "Escape", name: "Esc", typing: true, inSearch: true })).toEqual({ kind: "leaveSearchBox" });
    expect(key({ key: "Escape", name: "Esc", findOpen: true, searchActive: true })).toEqual({ kind: "closeFind" });
  });

  it("Ctrl+Z undoes the last change, except in a text box", () => {
    expect(key({ key: "z", name: "Ctrl+Z", ctrl: true })).toEqual({ kind: "undo" });
    expect(key({ key: "z", name: "Ctrl+Z", ctrl: true, typing: true })).toEqual({ kind: "none" });
  });

  it("/ and pad keys; nothing while typing or with single-key shortcuts off", () => {
    expect(key({ key: "/", name: "/" })).toEqual({ kind: "focusSearch" });
    expect(key({ key: "r", name: "R" })).toEqual({ kind: "pad", key: "r" });
    expect(key({ key: "R", name: "Shift+R", shift: true })).toEqual({ kind: "pad", key: "r" });
    expect(key({ key: "r", name: "R", typing: true })).toEqual({ kind: "none" });
    expect(key({ key: "r", name: "R", keys1: false })).toEqual({ kind: "none" });
    expect(key({ keys1: false })).toEqual({ kind: "none" });
    expect(key({ key: "/", name: "/", keys1: false })).toEqual({ kind: "none" });
    expect(key({ key: "Escape", name: "Shift+Esc", shift: true, keys1: false })).toEqual({ kind: "fadeAll" });
    expect(key({ key: "r", name: "Alt+R", alt: true, code: "KeyR" })).toEqual({ kind: "none" });
    expect(key({ key: "F2", name: "F2" })).toEqual({ kind: "pad", key: "f2" });
  });

  it("Alt+1 to Alt+7 go to a box, in the order the boxes are named in Keys (On air first)", () => {
    expect(key({ key: "1", name: "Alt+1", alt: true, code: "Digit1" })).toEqual({ kind: "goBox", box: 0 });
    expect(key({ key: "3", name: "Alt+3", alt: true, code: "Digit3", typing: true })).toEqual({ kind: "goBox", box: 2 });
    expect(key({ key: "8", name: "Alt+8", alt: true, code: "Digit8" })).toEqual({ kind: "none" });
  });

  it("Right unfolds the scene whose name has focus, Left folds it (SHW-7)", () => {
    expect(key({ key: "ArrowRight", name: "Right", onSceneName: true })).toEqual({ kind: "unfoldScene" });
    expect(key({ key: "ArrowLeft", name: "Left", onSceneName: true })).toEqual({ kind: "foldScene" });
    expect(key({ key: "ArrowLeft", name: "Left" })).toEqual({ kind: "none" });
  });

  it("UX-12: the keys follow Settings › Keyboard shortcuts", () => {
    const keys = { ...LIVE_KEYS, nextScene: "N", find: "F" };
    expect(key({ keys })).toEqual({ kind: "none" });
    expect(key({ key: "n", name: "N", keys })).toEqual({ kind: "nextScene" });
    expect(key({ key: "f", name: "F", keys })).toEqual({ kind: "focusSearch" });
    // A key with Ctrl works even with single-key shortcuts off, and from a button reached with Tab.
    const ctrl = { ...LIVE_KEYS, nextScene: "Ctrl+N" };
    expect(key({ key: "n", name: "Ctrl+N", ctrl: true, keys: ctrl, keys1: false, onControl: true, keyNav: true })).toEqual({ kind: "nextScene" });
  });
});
