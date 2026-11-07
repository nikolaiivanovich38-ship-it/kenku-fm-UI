/** The Outputs screen's words and rules, from design/prototype/src/views/outputs.js. */
import { describe, expect, it } from "vitest";

import type { LyreOutputs } from "../../../common/lyreOutputs";
import type { LaneNowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
import { PROTOTYPE_OUTPUTS, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import {
  addBotChoice,
  bringItems,
  busiestChannel,
  chimeMessage,
  heardTwice,
  kickLosesSound,
  meterFill,
  moveLosesSound,
  moveMessage,
  nobodyThere,
  outputName,
  people,
  pill,
  roomItems,
  roomToRestore,
  swapPair,
  viewOf,
} from "./outputsModel";

const withBots = (change: (bots: LyreOutputs["bots"]) => LyreOutputs["bots"]): LyreOutputs => ({ ...PROTOTYPE_OUTPUTS, bots: change(PROTOTYPE_OUTPUTS.bots) });
const sideIn = (channelId: string, status: "connected" | "joining" = "connected") =>
  withBots(([table, side]) => [table, { ...side, room: { serverId: channelId.startsWith("102") ? "1002" : "1001", channelId, status } }]);
const room = (over: Partial<RoomNowPlaying>): RoomNowPlaying => ({ roomId: TABLE_BOT, name: "Table", volume: 1, music: null, ambience: null, upNext: null, queued: [], upNextList: [], repeat: { chosen: null, shown: "off" }, canUndoUpNext: false, effects: [], played: [], ...over });
const lane = (paused = false): LaneNowPlaying => ({ trackId: "t1", title: "Tavern", origin: { kind: "single" } as never, playlistId: null, position: 1, length: 9, paused, loading: false, place: null, playOrder: null, gainDb: 0, level: 1 });

describe("outputsModel", () => {
  it("names an output after its room, or after the bot while it is in none", () => {
    const view = viewOf(PROTOTYPE_OUTPUTS);
    expect(view.bots.map((b) => [outputName(b), b.where])).toEqual([
      ["Table", "The Gull and Lantern › Table"],
      ["Lyre Side", ""],
    ]);
    expect(view.bots[0].listeners).toEqual(["Nik", "Aster", "Bram", "Corin", "Dalia"]);
    expect(view.channelCount).toBe(6);
    expect(view.inRooms).toBe(1);
  });

  it("counts people as the prototype words them", () => {
    expect([people(0), people(1), people(5)]).toEqual(["Nobody here", "1 person", "5 people"]);
  });

  it("gives one status pill per box: Playing, Paused, Silent, Muted, Joining, Not in a room", () => {
    const [table, side] = viewOf(PROTOTYPE_OUTPUTS).bots;
    expect(pill(table, undefined)).toEqual({ text: "Silent", tone: "idle" });
    expect(pill(table, room({ music: lane() }))).toEqual({ text: "Playing", tone: "live" });
    expect(pill(table, room({ effects: [{ trackId: "t9", title: "Door", padKey: null }] }))).toEqual({ text: "Playing", tone: "live" });
    expect(pill(table, room({ music: lane(true) }))).toEqual({ text: "Paused", tone: "idle" });
    expect(pill({ ...table, bot: { ...table.bot, muted: true } }, room({ music: lane() }))).toEqual({ text: "Muted", tone: "idle" });
    expect(pill(side, undefined)).toEqual({ text: "Not in a room", tone: "idle" });
    expect(pill(viewOf(sideIn("1012", "joining")).bots[1], undefined)).toEqual({ text: "Joining", tone: "warn" });
    const failed = withBots(([t, s]) => [t, { ...s, room: { serverId: "1001", channelId: "1012", status: "error", error: "No permission" } }]);
    expect(pill(viewOf(failed).bots[1], undefined)).toEqual({ text: "Could not join", tone: "warn" });
    const offline = withBots(([t, s]) => [t, { ...s, login: "offline" }]);
    expect(pill(viewOf(offline).bots[1], undefined)).toEqual({ text: "Not connected", tone: "idle" });
  });

  it("lists every voice channel for the Room menu, grouped by server, with people and warnings", () => {
    const outputs = viewOf(PROTOTYPE_OUTPUTS);
    const groups = roomItems(outputs, outputs.bots[1]);
    expect(groups.map((g) => g.server)).toEqual(["The Gull and Lantern", "Night court"]);
    expect(groups[0].items.map((i) => [i.name, i.here, i.sub, i.warn])).toEqual([
      ["Table", false, "5 people", "Lyre Table is here: players would hear it twice"],
      ["Side room", false, "", "Empty: nobody would hear it"],
      ["Whispers", false, "", "Empty: nobody would hear it"],
      ["AFK", false, "1 person", ""],
    ]);
    const table = roomItems(outputs, outputs.bots[0])[0].items[0];
    expect([table.here, table.sub, table.warn]).toEqual([true, "Here now · 5 people", ""]);
  });

  it("offers Bring… for the bots not in a channel, saying what moving means", () => {
    const outputs = viewOf(PROTOTYPE_OUTPUTS);
    expect(bringItems(outputs, "1001", "1013")).toEqual([
      { botId: TABLE_BOT, name: "Lyre Table", sub: "Leaves Table", warn: "Empty: nobody would hear it" },
      { botId: SIDE_BOT, name: "Lyre Side", sub: "Not in a room now", warn: "Empty: nobody would hear it" },
    ]);
    expect(bringItems(outputs, "1001", "1011")).toEqual([{ botId: SIDE_BOT, name: "Lyre Side", sub: "Not in a room now", warn: "Lyre Table is here: players would hear it twice" }]);
  });

  it("swaps only two bots in two different rooms", () => {
    expect(swapPair(viewOf(PROTOTYPE_OUTPUTS))).toBeNull();
    expect(swapPair(viewOf(sideIn("1012")))?.map((b) => b.bot.name)).toEqual(["Lyre Table", "Lyre Side"]);
    expect(swapPair(viewOf(sideIn("1011")))).toBeNull();
  });

  it("warns when two bots are in one room", () => {
    const both = viewOf(sideIn("1011"));
    expect(heardTwice(both, both.bots[0]).map((b) => b.bot.name)).toEqual(["Lyre Side"]);
    expect(heardTwice(viewOf(PROTOTYPE_OUTPUTS), viewOf(PROTOTYPE_OUTPUTS).bots[0])).toEqual([]);
  });

  it("words a move as the prototype does", () => {
    const outputs = viewOf(PROTOTYPE_OUTPUTS);
    const [table, side] = outputs.bots;
    expect(moveMessage(outputs, side, "1012")).toBe("Lyre Side is joining Side room. Nobody is there yet.");
    expect(moveMessage(outputs, side, "1011")).toBe("Lyre Side is joining Table, where Lyre Table already plays: players will hear it twice");
    expect(moveMessage(outputs, side, "1014")).toBe("Lyre Side is joining AFK");
    expect(moveMessage(outputs, table, "1011")).toBe("Lyre Table is already in Table");
  });

  it("words the Test chime: only in that room, how many hear it, or why not", () => {
    const outputs = viewOf(PROTOTYPE_OUTPUTS);
    expect(chimeMessage(outputs.bots[0])).toEqual({ ok: true, toast: "Test chime in Table only (5 people there)", say: "Test chime played in The Gull and Lantern › Table" });
    expect(chimeMessage(outputs.bots[1])).toEqual({ ok: false, toast: "Lyre Side is not in a voice channel. Choose a room first." });
    expect(chimeMessage(viewOf(sideIn("1012", "joining")).bots[1])).toEqual({ ok: false, toast: "Lyre Side is still joining. Try again in a moment." });
    expect(chimeMessage(viewOf(sideIn("1012")).bots[1])).toEqual({ ok: true, toast: "Test chime in Side room only: nobody is there to hear it", say: "Test chime played in The Gull and Lantern › Side room" });
    const muted = viewOf(withBots(([t, s]) => [{ ...t, muted: true }, s])).bots[0];
    expect(chimeMessage(muted)).toEqual({ ok: false, toast: "Table is muted: unmute it to hear the test chime" });
  });
});

// --- w6-rooms ---

describe("round 6 (OUT-7): Add bot and Kick in the voice channels", () => {
  it("Add bot with one free bot puts that bot there in one click", () => {
    const view = viewOf(PROTOTYPE_OUTPUTS);
    expect(addBotChoice(view, "1001", "1012")).toEqual({ one: SIDE_BOT, choices: [{ botId: SIDE_BOT, name: "Lyre Side", leaves: null }] });
  });

  it("with two free bots, Add bot offers a short choice of them", () => {
    const both = withBots(([t, s]) => [{ ...t, room: null }, s]);
    const choice = addBotChoice(viewOf(both), "1001", "1013");
    expect(choice.one).toBeNull();
    expect(choice.choices.map((c) => c.name)).toEqual(["Lyre Table", "Lyre Side"]);
  });

  it("with no bot free, the choice moves a bot and says which room it leaves", () => {
    const choice = addBotChoice(viewOf(sideIn("1012")), "1001", "1013");
    expect(choice.one).toBeNull();
    expect(choice.choices).toEqual([
      { botId: TABLE_BOT, name: "Lyre Table", leaves: "Table" },
      { botId: SIDE_BOT, name: "Lyre Side", leaves: "Side room" },
    ]);
  });

  it("never offers a bot that is logged out or cannot see that server, nor one already there", () => {
    const out = withBots(([t, s]) => [t, { ...s, login: "offline" }]);
    expect(addBotChoice(viewOf(out), "1001", "1012").choices.map((c) => c.name)).toEqual(["Lyre Table"]);
    const blind = withBots(([t, s]) => [t, { ...s, serverIds: ["1002"] }]);
    expect(addBotChoice(viewOf(blind), "1001", "1012").choices.map((c) => c.name)).toEqual(["Lyre Table"]);
    expect(addBotChoice(viewOf(PROTOTYPE_OUTPUTS), "1001", "1011").choices.map((c) => c.name)).toEqual(["Lyre Side"]);
  });

  it("kicking or moving a bot needs an Undo only when the players there were hearing something", () => {
    const [table, side] = viewOf(sideIn("1012")).bots;
    expect(kickLosesSound(table, room({ music: lane() }))).toBe(true);
    expect(kickLosesSound(table, room({ music: lane(true) }))).toBe(false);
    expect(kickLosesSound(table, room({}))).toBe(false);
    // Side room has nobody in it: nobody loses anything.
    expect(kickLosesSound(side, room({ roomId: SIDE_BOT, music: lane() }))).toBe(false);
    expect(moveLosesSound(table, room({ ambience: lane() }), "1013")).toBe(true);
    expect(moveLosesSound(table, room({ ambience: lane() }), "1011")).toBe(false);
  });

  it("Undo of a Kick puts the bot back in its channel with what it played, from where it was", () => {
    const [table] = viewOf(PROTOTYPE_OUTPUTS).bots;
    const playing = room({
      music: { ...lane(), trackId: "t-anthem", position: 42.5, playlistId: "p-company", origin: { kind: "playlist", playlistId: "p-company", at: 2, place: { kind: "campaign", campaignId: "crown" } } as never, place: { kind: "campaign", campaignId: "crown" } as never },
      ambience: { ...lane(), trackId: "a-rain", position: 3, origin: { kind: "single" } as never },
    });
    expect(roomToRestore(table, playing)).toEqual({
      botId: TABLE_BOT,
      channelId: "1011",
      lanes: [
        { trackId: "t-anthem", fromMs: 42500, from: { playlistId: "p-company", place: { kind: "campaign", campaignId: "crown" } }, place: { kind: "campaign", campaignId: "crown" } },
        { trackId: "a-rain", fromMs: 3000, from: undefined, place: undefined },
      ],
    });
    const scene = room({ music: { ...lane(), origin: { kind: "scene", scene: { campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, at: 1 } as never } });
    expect(roomToRestore(table, scene)!.lanes[0].from).toEqual({ scene: { campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, at: 1 });
    expect(roomToRestore(viewOf(PROTOTYPE_OUTPUTS).bots[1], room({}))).toBeNull();
  });
});

describe("round 6 review, Must 2: a room in a channel with nobody in it", () => {
  it("says Nobody there, and offers the channel with the most players and no other bot (two people or more)", () => {
    const view = viewOf(sideIn("1012"));
    const side = view.bots[1];
    expect(nobodyThere(side)).toBe(true);
    expect(nobodyThere(view.bots[0])).toBe(false);
    // Table has Lyre Table in it; AFK has one person: nothing to offer.
    expect(busiestChannel(view, side)).toBeNull();
    const freeTable = viewOf(withBots(([t, s]) => [{ ...t, room: null }, { ...s, room: { serverId: "1001", channelId: "1012", status: "connected" } }]));
    expect(busiestChannel(freeTable, freeTable.bots[1])).toEqual({ serverId: "1001", channelId: "1011", name: "Table", people: 5, where: "The Gull and Lantern › Table" });
  });
});

describe("OUT-10: the level meter", () => {
  it("fills by loudness in decibels: silence empty, -48 dB and below empty, full scale full", () => {
    expect(meterFill(0)).toBe(0);
    expect(meterFill(0.003)).toBe(0);
    expect(meterFill(1)).toBe(1);
    expect(meterFill(2)).toBe(1);
    expect(meterFill(0.5)).toBeCloseTo(1 - 6.02 / 48, 2);
    expect(meterFill(Number.NaN)).toBe(0);
  });
});
