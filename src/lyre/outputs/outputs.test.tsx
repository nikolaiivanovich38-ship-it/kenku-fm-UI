/**
 * w4-outputs: the Lyre page's side of the outputs: the preload bridge (window.lyre.outputs), the provider that keeps
 * the latest state for every screen, the rail's "Rooms (n/m)" and the fake the screen tests use.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LYRE_OUTPUTS_STATE, NO_OUTPUTS, type LyreOutputs } from "../../common/lyreOutputs";
import { createLyreOutputsBridge } from "./preloadOutputs";
import { OutputsProvider, outputsLabel, useOutputs } from "./OutputsProvider";
import { FakeOutputs, PROTOTYPE_OUTPUTS, SIDE_BOT } from "./testing/fakeOutputs";

function fakeIpc() {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  return {
    sent: [] as unknown[][],
    invoke: vi.fn(async (_channel: string, ..._args: unknown[]): Promise<unknown> => PROTOTYPE_OUTPUTS),
    send(channel: string, ...args: unknown[]) {
      this.sent.push([channel, ...args]);
    },
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    },
    off(channel: string, listener: (event: unknown, ...args: unknown[]) => void) {
      listeners.get(channel)?.delete(listener);
    },
    emit(channel: string, ...args: unknown[]) {
      listeners.get(channel)?.forEach((l) => l({}, ...args));
    },
  };
}

describe("the outputs bridge (preload)", () => {
  it("asks for the outputs, passes on each new state and drops anything that is not one", async () => {
    const ipc = fakeIpc();
    const bridge = createLyreOutputsBridge(ipc);
    expect(await bridge.get()).toEqual(PROTOTYPE_OUTPUTS);
    expect(ipc.invoke).toHaveBeenCalledWith("LYRE_OUTPUTS_GET");
    const seen: LyreOutputs[] = [];
    const stop = bridge.onState((state) => seen.push(state));
    ipc.emit(LYRE_OUTPUTS_STATE, NO_OUTPUTS);
    ipc.emit(LYRE_OUTPUTS_STATE, { bots: "nope" });
    stop();
    ipc.emit(LYRE_OUTPUTS_STATE, PROTOTYPE_OUTPUTS);
    expect(seen).toEqual([NO_OUTPUTS]);
  });

  it("sends each change on its own channel", () => {
    const ipc = fakeIpc();
    const bridge = createLyreOutputsBridge(ipc);
    bridge.move("bot-a", "1012");
    bridge.leave("bot-a");
    bridge.setMuted("bot-a", true);
    bridge.setVolume("bot-a", 0.8);
    bridge.retry("bot-a");
    expect(ipc.sent).toEqual([
      ["LYRE_OUTPUT_MOVE", "bot-a", "1012"],
      ["LYRE_OUTPUT_LEAVE", "bot-a"],
      ["LYRE_OUTPUT_SET_MUTED", "bot-a", true],
      ["LYRE_OUTPUT_SET_VOLUME", "bot-a", 0.8],
      ["LYRE_OUTPUT_RETRY", "bot-a"],
    ]);
  });
});

describe("Settings in Lyre (OUT-8) through the page's bridge", () => {
  it("adds, replaces, renames, removes and puts back bots, answering what the main process said; connects and opens the invite", async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockImplementation(async (channel: string) => (channel === "LYRE_OUTPUTS_GET" ? PROTOTYPE_OUTPUTS : { ok: true, botId: "bot-x" }));
    const bridge = createLyreOutputsBridge(ipc);
    expect(await bridge.addBot("MTAx.new-bot.abcd", "123456789012345678")).toEqual({ ok: true, botId: "bot-x" });
    await bridge.replaceToken("bot-a", "MTAx.secret-part.wxyz");
    await bridge.rename("bot-a", "Side");
    await bridge.setApplicationId("bot-a", null);
    await bridge.remove("bot-a");
    await bridge.restore("bot-a");
    bridge.connect("bot-a");
    bridge.disconnect("bot-a");
    bridge.openInvite("123456789012345678");
    expect(ipc.invoke.mock.calls.map((c) => c[0])).toEqual(["LYRE_BOT_ADD", "LYRE_BOT_SET_TOKEN", "LYRE_BOT_RENAME", "LYRE_BOT_SET_APP_ID", "LYRE_BOT_REMOVE", "LYRE_BOT_RESTORE"]);
    expect(ipc.sent).toEqual([["LYRE_BOT_CONNECT", "bot-a"], ["LYRE_BOT_DISCONNECT", "bot-a"], ["LYRE_BOT_OPEN_INVITE", "123456789012345678"]]);
    ipc.invoke.mockImplementation(async () => ({ token: "leak" }));
    expect(await bridge.addBot("MTAx.new-bot.abcd", null)).toEqual({ ok: false, message: "Lyre could not reach the Discord bots. Close the Lyre tab, open it again and try once more." });
  });

  it("the fake for screen tests does the same in memory: tokens show as their last four characters, Remove has Undo", async () => {
    const fake = new FakeOutputs();
    const added = await fake.addBot("MTAx.new-bot.abcd", "123456789012345678");
    expect(added.ok).toBe(true);
    const third = fake.state.bots[2];
    expect(third).toMatchObject({ name: "Lyre Third", tokenEnd: "abcd", serverIds: [], inviteUrl: expect.stringContaining("client_id=123456789012345678") });
    fake.openInvite("123456789012345678");
    expect((await fake.addBot("MTAx.other.efgh", null)).ok).toBe(true);
    expect(fake.state.bots[3].serverIds).toEqual(["1001"]);
    await fake.replaceToken(SIDE_BOT, "MTAx.secret-part.wxyz");
    expect(fake.state.bots[1].tokenEnd).toBe("wxyz");
    expect(JSON.stringify(fake.state)).not.toContain("secret-part");
    expect(await fake.remove(SIDE_BOT)).toEqual({ ok: true, botId: SIDE_BOT });
    expect(fake.state.bots.map((b) => b.id)).not.toContain(SIDE_BOT);
    await fake.restore(SIDE_BOT);
    expect(fake.state.bots[1].id).toBe(SIDE_BOT);
    fake.disconnect(SIDE_BOT);
    expect(fake.state.bots[1].login).toBe("offline");
    fake.connect(SIDE_BOT);
    expect(fake.state.bots[1].login).toBe("ready");
    expect(await fake.addBot("nope", null)).toEqual({ ok: false, message: expect.stringContaining("Reset Token") });
  });
});

function Probe() {
  const { outputs } = useOutputs();
  return <p>{outputs ? `${outputs.bots.length} bots, ${outputsLabel(outputs)}` : "loading"}</p>;
}

describe("OutputsProvider", () => {
  it("loads the outputs once and follows every change", async () => {
    const fake = new FakeOutputs();
    render(
      <OutputsProvider client={fake}>
        <Probe />
      </OutputsProvider>,
    );
    expect(await screen.findByText("2 bots, Rooms (1/2)")).toBeInTheDocument();
    fake.move(fake.state.bots[1].id, "1012");
    await act(() => fake.settle());
    expect(screen.getByText("2 bots, Rooms (2/2)")).toBeInTheDocument();
  });

  it("works without outputs (tests and pages without the bridge)", () => {
    render(
      <OutputsProvider client={null}>
        <Probe />
      </OutputsProvider>,
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
  });
});

describe("outputsLabel", () => {
  it("counts the bots connected in a voice channel, of all bots", () => {
    expect(outputsLabel(PROTOTYPE_OUTPUTS)).toBe("Rooms (1/2)");
    const joining: LyreOutputs = { ...PROTOTYPE_OUTPUTS, bots: PROTOTYPE_OUTPUTS.bots.map((b) => ({ ...b, room: b.room && { ...b.room, status: "joining" } })) };
    expect(outputsLabel(joining)).toBe("Rooms (0/2)");
  });
});

describe("FakeOutputs", () => {
  it("joins as Discord does: joining first, connected a moment later; leaving, muting and volume at once", async () => {
    const fake = new FakeOutputs();
    const side = fake.state.bots[1].id;
    fake.move(side, "1013");
    expect(fake.state.bots[1].room).toEqual({ serverId: "1001", channelId: "1013", status: "joining" });
    await fake.settle();
    expect(fake.state.bots[1].room?.status).toBe("connected");
    fake.setMuted(side, true);
    fake.setVolume(side, 0.4);
    fake.leave(side);
    expect(fake.state.bots[1]).toMatchObject({ muted: true, volume: 0.4, room: null });
    expect(fake.calls.map((c) => c[0])).toEqual(["move", "setMuted", "setVolume", "leave"]);
  });
});
