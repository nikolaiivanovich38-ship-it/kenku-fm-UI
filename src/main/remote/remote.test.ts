import Fastify, { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRemote } from ".";
import { PlayerRequests } from "./playerRequests";
import {
  fakeIpcMain,
  fakePage,
  fromMainFrame,
  type FakePage,
} from "../security/testing/fakeIpc";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

/** The reply channel the player answers each GET request on. */
const REPLY_FOR: Record<string, string> = {
  PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST: "PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY",
  PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST: "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY",
  PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST: "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REPLY",
  PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST: "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY",
};

const playlists = {
  playlists: [{ id: "p1", title: "Tavern", background: "file:///bg.jpg", tracks: ["t1"] }],
  tracks: [{ id: "t1", title: "Lute", url: "file:///lute.mp3" }],
};
const playlistPlayback = {
  playing: true,
  volume: 0.5,
  muted: false,
  shuffle: false,
  repeat: "playlist",
  track: { id: "t1", url: "file:///lute.mp3", title: "Lute", duration: 120, progress: 3 },
  playlist: { id: "p1", title: "Tavern" },
};
const soundboards = {
  soundboards: [{ id: "s1", title: "Combat", background: "", sounds: ["x1"] }],
  sounds: [
    { id: "x1", title: "Sword", url: "file:///sword.ogg", loop: false, volume: 1, fadeIn: 0, fadeOut: 0 },
  ],
};
const soundboardPlayback = {
  sounds: [
    {
      id: "x1",
      url: "file:///sword.ogg",
      title: "Sword",
      loop: false,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      duration: 2,
      progress: 1,
    },
  ],
};
const ANSWERS: Record<string, unknown> = {
  PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST: playlists,
  PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST: playlistPlayback,
  PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST: soundboards,
  PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST: soundboardPlayback,
};

/** A player view that answers requests the way the real player does. */
function fakePlayer({ answer = true } = {}) {
  const page: FakePage = fakePage("player-view");
  const requests: { channel: string; args: unknown[] }[] = [];
  page.send = vi.fn((channel: string, ...args: unknown[]) => {
    requests.push({ channel, args });
    if (answer && REPLY_FOR[channel]) {
      queueMicrotask(() =>
        fakeIpcMain.deliver(REPLY_FOR[channel], fromMainFrame(page), ANSWERS[channel], ...args),
      );
    }
  });
  return { page, requests };
}

let app: FastifyInstance;
let view: FakePage | undefined;
let requests: PlayerRequests;

async function startRemote(timeoutMs = 50) {
  requests = new PlayerRequests(timeoutMs);
  app = Fastify();
  const manager = { fastify: app, getView: () => view, requests };
  registerRemote(manager as never);
  await app.ready();
}

beforeEach(() => {
  fakeIpcMain.reset();
});

afterEach(async () => {
  requests?.destroy();
  await app?.close();
  view = undefined;
});

const GET_ROUTES = [
  ["/v1/playlist", playlists],
  ["/v1/playlist/playback", playlistPlayback],
  ["/v1/soundboard", soundboards],
  ["/v1/soundboard/playback", soundboardPlayback],
] as const;

describe("remote API GET routes (PERF-9)", () => {
  it.each(GET_ROUTES)("answers %s with the player's reply, unchanged", async (url, expected) => {
    view = fakePlayer().page;
    await startRemote();
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.body).toBe(JSON.stringify(expected));
  });

  it.each([
    ["/v1/playlist", "playlists"],
    ["/v1/playlist/playback", "playback"],
    ["/v1/soundboard", "soundboards"],
    ["/v1/soundboard/playback", "playback"],
  ])("answers %s with the same timeout error as before when the player is silent", async (url, what) => {
    view = fakePlayer({ answer: false }).page;
    await startRemote();
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(408);
    expect(response.body).toBe(
      JSON.stringify({
        statusCode: 408,
        error: "Request Timeout",
        message: `Unable to retrieve ${what} in a reasonable time`,
      }),
    );
  });

  it.each(GET_ROUTES)("answers %s with 503 when there is no player", async (url) => {
    await startRemote();
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(
      JSON.stringify({
        statusCode: 503,
        error: "Service Unavailable",
        message: "Unable to connect to Lyre",
      }),
    );
  });

  it("leaves no reply listeners behind after requests time out", async () => {
    view = fakePlayer({ answer: false }).page;
    await startRemote();
    const before = fakeIpcMain.listenerCount("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY");
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "GET", url: "/v1/playlist/playback" });
    }
    expect(fakeIpcMain.listenerCount("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY")).toBe(before);
    expect(requests.pendingCount()).toBe(0);
  });

  it("gives each of several simultaneous requests its own reply", async () => {
    const player = fakePlayer({ answer: false });
    view = player.page;
    await startRemote(1000);
    const first = app.inject({ method: "GET", url: "/v1/playlist/playback" });
    const second = app.inject({ method: "GET", url: "/v1/playlist/playback" });
    await vi.waitFor(() => expect(player.requests).toHaveLength(2));
    const [a, b] = player.requests.map((request) => request.args[0]);
    expect(a).not.toBe(b);

    // The player answers the second request first.
    const secondState = { ...playlistPlayback, volume: 0.2 };
    fakeIpcMain.deliver("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY", fromMainFrame(player.page), secondState, b);
    fakeIpcMain.deliver("PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY", fromMainFrame(player.page), playlistPlayback, a);

    expect((await first).body).toBe(JSON.stringify(playlistPlayback));
    expect((await second).body).toBe(JSON.stringify(secondState));
  });

  it("ignores replies from anything but the player view", async () => {
    const player = fakePlayer({ answer: false });
    view = player.page;
    await startRemote();
    const pending = app.inject({ method: "GET", url: "/v1/playlist" });
    await vi.waitFor(() => expect(player.requests).toHaveLength(1));
    const id = player.requests[0].args[0];
    const forged = { playlists: [] as unknown[], tracks: [] as unknown[] };
    fakeIpcMain.deliver("PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY", fromMainFrame(fakePage(null)), forged, id);
    fakeIpcMain.deliver("PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY", fromMainFrame(fakePage("main-window")), forged, id);
    expect((await pending).statusCode).toBe(408);
  });
});

describe("remote API commands are unchanged", () => {
  it("passes play and playback commands to the player", async () => {
    const player = fakePlayer();
    view = player.page;
    await startRemote();
    const play = await app.inject({ method: "PUT", url: "/v1/playlist/play", payload: { id: "p1" } });
    expect(play.statusCode).toBe(200);
    expect(play.body).toBe(JSON.stringify({ id: "p1" }));
    const volume = await app.inject({ method: "PUT", url: "/v1/playlist/playback/volume", payload: { volume: 3 } });
    expect(volume.body).toBe(JSON.stringify({ volume: 3 }));
    expect(player.requests).toEqual([
      { channel: "PLAYER_REMOTE_PLAYLIST_PLAY", args: ["p1"] },
      { channel: "PLAYER_REMOTE_PLAYLIST_PLAYBACK_VOLUME", args: [1] },
    ]);
  });
});
