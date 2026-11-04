import { describe, expect, it, vi } from "vitest";
import { PlayerReplyTimeout, PlayerRequests } from "./playerRequests";
import type { GuardedIpc } from "../security/ipcGuard";

vi.mock("electron", () => ({ ipcMain: {} }));

const fakeIpc: GuardedIpc = {
  on: () => () => undefined,
  handle: () => () => undefined,
  dispose: () => undefined,
};

describe("PlayerRequests.ask (PERF-9)", () => {
  it("fails at once and forgets the request when the player view has just gone", async () => {
    const requests = new PlayerRequests(60_000, fakeIpc);
    const gone = {
      send: () => {
        throw new Error("Object has been destroyed");
      },
    };
    await expect(requests.ask(gone, "playlists")).rejects.toBeInstanceOf(PlayerReplyTimeout);
    expect(requests.pendingCount()).toBe(0);
    requests.destroy();
  });
});
