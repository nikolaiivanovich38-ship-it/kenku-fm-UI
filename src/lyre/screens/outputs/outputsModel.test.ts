/** The Outputs screen's words and rules, from design/prototype/src/views/outputs.js. */
import { describe, expect, it } from "vitest";

import type { LyreOutputs } from "../../../common/lyreOutputs";
import type { LaneNowPlaying, RoomNowPlaying } from "../../audio/lyreAudio";
import { PROTOTYPE_OUTPUTS, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import { bringItems, chimeMessage, heardTwice, moveMessage, outputName, people, pill, roomItems, swapPair, viewOf } from "./outputsModel";

const withBots = (change: (bots: LyreOutputs["bots"]) => LyreOutputs["bots"]): LyreOutputs => ({ ...PROTOTYPE_OUTPUTS, bots: change(PROTOTYPE_OUTPUTS.bots) });
const sideIn = (channelId: string, status: "connected" | "joining" = "connected") =>
  withBots(([table, side]) => [table, { ...side, room: { serverId: channelId.startsWith("102") ? "1002" : "1001", channelId, status } }]);
const room = (over: Partial<RoomNowPlaying>): RoomNowPlaying => ({ roomId: TABLE_BOT, name: "Table", music: null, ambience: null, upNext: null, queued: [], effects: [], ...over });
const lane = (paused = false): LaneNowPlaying => ({ trackId: "t1", title: "Tavern", origin: { kind: "single" } as never, playlistId: null, position: 1, length: 9, paused, loading: false, place: null, playOrder: null });

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
