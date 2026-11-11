/**
 * SEC-4: what the remote-control server lets through. Every request needs the secret code, may not come from a
 * web page or a borrowed web address, and is rate-limited; bodies are JSON only; answers carry no file addresses.
 */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAllowedHost, stripFileAddresses } from "./remoteServer";
import { createRemoteServer } from "./remoteServer";
import { PlayerRequests } from "./playerRequests";

vi.mock("electron", async () => {
  const { fakeIpcMain } = await import("../security/testing/fakeIpc");
  return { ipcMain: fakeIpcMain };
});

const CODE = "AB01-CD23-EF45-GH67-JK89";
const PORT = 3333;
const GOOD = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${CODE}` };

let app: FastifyInstance;
let requests: PlayerRequests;
let now = 0;
const sent: { channel: string; args: unknown[] }[] = [];
const view = { isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) };

async function start() {
  requests = new PlayerRequests(50);
  app = createRemoteServer({
    host: { getView: () => view as never, requests },
    code: () => CODE,
    port: () => PORT,
    now: () => now,
  });
  await app.ready();
}

afterEach(async () => {
  sent.length = 0;
  now = 0;
  requests?.destroy();
  await app?.close();
});

const put = (headers: Record<string, string>, payload: unknown = { id: "p1" }) =>
  app.inject({ method: "PUT", url: "/v1/playlist/play", headers, payload: payload as never });

describe("remote control: the secret code (SEC-4)", () => {
  it("lets a request with the right code through", async () => {
    await start();
    const response = await put(GOOD);
    expect(response.statusCode).toBe(200);
    expect(sent).toEqual([{ channel: "PLAYER_REMOTE_PLAYLIST_PLAY", args: ["p1"] }]);
  });

  it.each([
    ["no code", { host: GOOD.host }],
    ["a wrong code", { ...GOOD, authorization: "Bearer AB01-CD23-EF45-GH67-JK88" }],
    ["the code without Bearer", { ...GOOD, authorization: CODE }],
    ["another kind of login", { ...GOOD, authorization: `Basic ${Buffer.from(`x:${CODE}`).toString("base64")}` }],
  ])("refuses %s with 401 and says where to find the code, and does nothing", async (_, headers) => {
    await start();
    const response = await put(headers);
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe('Bearer realm="Lyre"');
    expect(response.json().message).toMatch(/secret code.*Settings/);
    expect(sent).toEqual([]);
  });

  it("asks for the code on GET routes too", async () => {
    await start();
    for (const url of ["/v1/playlist", "/v1/playlist/playback", "/v1/soundboard", "/v1/soundboard/playback"]) {
      const response = await app.inject({ method: "GET", url, headers: { host: GOOD.host } });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("asks for the code before saying whether an address exists", async () => {
    await start();
    expect((await app.inject({ method: "GET", url: "/nothing", headers: { host: GOOD.host } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/nothing", headers: GOOD })).statusCode).toBe(404);
  });

  it("after 10 wrong codes in 10 minutes refuses even the right one for a while, then lets it in", async () => {
    await start();
    for (let i = 0; i < 10; i++) {
      expect((await put({ ...GOOD, authorization: "Bearer WRONG" })).statusCode).toBe(401);
    }
    const locked = await put(GOOD);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(locked.json().message).toMatch(/Too many wrong codes/);
    now += 10 * 60 * 1000 + 1;
    expect((await put(GOOD)).statusCode).toBe(200);
  });
});

describe("remote control: requests from web pages and borrowed addresses (SEC-4)", () => {
  it("refuses a request that says it comes from a web page, even with the code", async () => {
    await start();
    for (const origin of ["https://attacker.example", "null", "http://127.0.0.1:3333"]) {
      const response = await put({ ...GOOD, origin });
      expect(response.statusCode, origin).toBe(403);
      expect(response.json().message).toMatch(/web pages/);
    }
    expect(sent).toEqual([]);
  });

  it("refuses a request addressed to a web name (DNS rebinding), even with the code", async () => {
    await start();
    for (const host of ["attacker.example", "attacker.example:3333", "127.0.0.1.nip.io:3333", "127.0.0.1:4444", ""]) {
      const response = await put({ ...GOOD, host });
      expect(response.statusCode, host).toBe(403);
    }
    expect(sent).toEqual([]);
  });

  it.each([
    ["127.0.0.1:3333", true],
    ["localhost:3333", true],
    ["LOCALHOST:3333", true],
    ["[::1]:3333", true],
    ["192.168.1.20:3333", true],
    ["[fe80::1]:3333", true],
    ["127.0.0.1", false],
    ["127.0.0.1:80", false],
    ["evil.localhost:3333", false],
    ["1.2.3.4.example:3333", false],
    ["[::1]", false],
    ["::1:3333", false],
    ["127.0.0.1:3333:3333", false],
  ])("Host %s for port 3333: allowed %s", (host, allowed) => {
    expect(isAllowedHost(host, 3333)).toBe(allowed);
  });

  it("allows a Host without a port only on port 80", () => {
    expect(isAllowedHost("127.0.0.1", 80)).toBe(true);
    expect(isAllowedHost(undefined, 80)).toBe(false);
  });
});

describe("remote control: changes come as proper requests (SEC-4)", () => {
  it("refuses a text/plain body, the kind any web page can send without asking", async () => {
    await start();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/playlist/play",
      headers: { ...GOOD, "content-type": "text/plain" },
      payload: JSON.stringify({ id: "p1" }),
    });
    expect(response.statusCode).toBe(415);
    expect(sent).toEqual([]);
  });

  it("refuses a form body", async () => {
    await start();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/playlist/play",
      headers: { ...GOOD, "content-type": "application/x-www-form-urlencoded" },
      payload: "id=p1",
    });
    expect(response.statusCode).toBe(415);
  });

  it("allows 600 requests a minute from one address, then asks it to slow down", async () => {
    await start();
    for (let i = 0; i < 600; i++) {
      expect((await put(GOOD)).statusCode).toBe(200);
    }
    const slow = await put(GOOD);
    expect(slow.statusCode).toBe(429);
    expect(slow.json().message).toMatch(/Too many requests/);
    now += 60_001;
    expect((await put(GOOD)).statusCode).toBe(200);
  });
});

describe("remote control: answers do not show where files are (SEC-4)", () => {
  it("removes every file address and track or sound address from an answer", () => {
    const answer = {
      playlists: [{ id: "p1", title: "Tavern", background: "file:///C:/Users/nik/bg.jpg", tracks: ["t1"] }],
      tracks: [{ id: "t1", title: "Lute", url: "file:///C:/Users/nik/Music/lute.mp3" }],
      track: { id: "t1", url: "https://example.com/stream.mp3", title: "Lute", progress: 3 },
      other: { background: "tavern" },
    };
    expect(stripFileAddresses(answer)).toEqual({
      playlists: [{ id: "p1", title: "Tavern", tracks: ["t1"] }],
      tracks: [{ id: "t1", title: "Lute" }],
      track: { id: "t1", title: "Lute", progress: 3 },
      other: { background: "tavern" },
    });
  });

  it("leaves other values alone", () => {
    expect(stripFileAddresses([1, "a", null, true, { volume: 0.5 }])).toEqual([1, "a", null, true, { volume: 0.5 }]);
  });
});
