/**
 * w4-outputs: the Lyre page's side of the outputs: the preload bridge (window.lyre.outputs), the provider that keeps
 * the latest state for every screen, the rail's "Outputs (n/m)" and the fake the screen tests use.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LYRE_OUTPUTS_STATE, NO_OUTPUTS, type LyreOutputs } from "../../common/lyreOutputs";
import { createLyreOutputsBridge } from "./preloadOutputs";
import { OutputsProvider, outputsLabel, useOutputs } from "./OutputsProvider";
import { FakeOutputs, PROTOTYPE_OUTPUTS } from "./testing/fakeOutputs";

function fakeIpc() {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  return {
    sent: [] as unknown[][],
    invoke: vi.fn(async () => PROTOTYPE_OUTPUTS),
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
    expect(await screen.findByText("2 bots, Outputs (1/2)")).toBeInTheDocument();
    fake.move(fake.state.bots[1].id, "1012");
    await act(() => fake.settle());
    expect(screen.getByText("2 bots, Outputs (2/2)")).toBeInTheDocument();
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
    expect(outputsLabel(PROTOTYPE_OUTPUTS)).toBe("Outputs (1/2)");
    const joining: LyreOutputs = { ...PROTOTYPE_OUTPUTS, bots: PROTOTYPE_OUTPUTS.bots.map((b) => ({ ...b, room: b.room && { ...b.room, status: "joining" } })) };
    expect(outputsLabel(joining)).toBe("Outputs (0/2)");
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
