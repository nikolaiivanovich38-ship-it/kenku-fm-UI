/**
 * The remote-control API used by Kenku Remote and the Stream Deck plugin
 * (src/main/remote): switched on through Lyre's Settings bridge (review 0.5.0 CR-3: the main window's
 * Settings no longer has Start Remote), then driven over HTTP the way
 * those tools do (https://www.kenku.fm/docs/using-kenku-remote), with the
 * secret code (SEC-4) read through the Lyre page's bridge, as round 7's
 * Settings will show it.
 */
import http from "http";
import net from "net";
import { test, expect } from "./fixtures/app";
import { openLyreTab } from "./fixtures/lyre";
import { writeSineWav } from "./fixtures/audio";
import { addSound, addTrack, card, createPlaylist, createSoundboard, openCard, transport } from "./fixtures/player";

/** A port nothing is listening on, so parallel runs on one machine do not clash. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type PlaylistsReply = {
  playlists: { id: string; title: string; tracks: string[] }[];
  tracks: { id: string; title: string; url: string }[];
};
type PlaybackReply = { playing: boolean; track?: { id: string; title: string }; playlist?: { id: string } };
type SoundboardsReply = {
  soundboards: { id: string; title: string; sounds: string[] }[];
  sounds: { id: string; title: string }[];
};
type SoundboardPlaybackReply = { sounds: { id: string; title: string }[] };
/** The Lyre page's remote settings bridge (src/common/remoteControl.ts RemoteBridge), as far as this test uses it. */
type RemoteState = { enabled: boolean; running: boolean; address: string; port: number; code: string };
type LyreWindow = { lyre: { remote: { get(): Promise<RemoteState>; set(change: Partial<RemoteState>): Promise<RemoteState | { error: string }> } } };

test("Stream Deck / Kenku Remote API controls playlists and soundboards", async ({
  mainWindow,
  playerView: page,
  userDataDir,
}) => {
  const tone = writeSineWav(`${userDataDir}/audio`, "march.wav", { seconds: 8 });
  const thunder = writeSineWav(`${userDataDir}/audio`, "thunder.wav", { seconds: 4, frequency: 200 });

  await createPlaylist(page, "Remote Playlist");
  await openCard(page, "Remote Playlist");
  await addTrack(page, tone, "March");
  await page.getByRole("button", { name: "Back" }).click();
  await createSoundboard(page, "Remote Board");
  await openCard(page, "Remote Board");
  await addSound(page, thunder, "Thunder");

  // SEC-4: the secret code, as the Lyre page gets it. The remote is off until it is turned on.
  const lyre = await openLyreTab(mainWindow);
  const before = await lyre.evaluate(() => (window as unknown as LyreWindow).lyre.remote.get());
  expect(before).toMatchObject({ enabled: false, running: false, address: "127.0.0.1" });
  const code = before.code;
  // Lead decision (7 Nov): 8 characters from an alphabet with nothing that looks alike, two groups of four.
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

  // The main window's Settings only says where the remote control is now (review 0.5.0 CR-3).
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings).toContainText("the Lyre tab's Settings, under Remote control");
  await expect(settings.getByLabel("Address", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Start Remote" })).toHaveCount(0);
  await settings.getByRole("button", { name: "Done" }).click();
  await mainWindow.getByRole("list", { name: "Tabs" }).getByRole("button", { name: "Lyre Player" }).click();

  // Switch the remote on, on a free port, as Lyre's Settings does.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/v1`;
  const on = await lyre.evaluate((p) => (window as unknown as LyreWindow).lyre.remote.set({ enabled: true, port: p }), port);
  expect(on).toMatchObject({ enabled: true, running: true, address: "127.0.0.1", port });

  const authorization = `Bearer ${code}`;
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}${path}`, { headers: { authorization } });
    expect(response.status, `GET ${path}`).toBe(200);
    return (await response.json()) as T;
  };
  const put = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: { authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `PUT ${path}`).toBe(200);
  };

  // SEC-4: without the code, from a web page, by a borrowed web name or as text/plain, nothing happens.
  expect((await fetch(`${base}/playlist`)).status).toBe(401);
  expect((await fetch(`${base}/playlist`, { headers: { authorization: "Bearer AAAA-BBBB-CCCC-DDDD-EEEE" } })).status).toBe(401);
  expect((await fetch(`${base}/playlist`, { headers: { authorization, origin: "https://attacker.example" } })).status).toBe(403);
  expect(await statusWithHost(port, `attacker.example:${port}`, authorization)).toBe(403);
  const plain = await fetch(`${base}/playlist/play`, {
    method: "PUT",
    headers: { authorization, "content-type": "text/plain" },
    body: JSON.stringify({ id: "nothing" }),
  });
  expect(plain.status).toBe(415);

  // Playlists and their tracks.
  const library = await get<PlaylistsReply>("/playlist");
  expect(library.playlists.map((playlist) => playlist.title)).toEqual(["Remote Playlist"]);
  const march = library.tracks.find((track) => track.title === "March");
  expect(march).toBeDefined();
  // SEC-4: answers do not show where the files are.
  expect(JSON.stringify(library)).not.toContain("file:");
  expect(march).not.toHaveProperty("url");
  expect(library.playlists[0].tracks).toEqual([march.id]);

  // Nothing is playing yet.
  expect((await get<PlaybackReply>("/playlist/playback")).playing).toBe(false);

  // Play a track by id.
  await put("/playlist/play", { id: march.id });
  await expect(transport(page).getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const playback = await get<PlaybackReply>("/playlist/playback");
      return { playing: playback.playing, track: playback.track?.id, playlist: playback.playlist?.id };
    })
    .toEqual({ playing: true, track: march.id, playlist: library.playlists[0].id });

  // Pause and resume.
  await put("/playlist/playback/pause");
  await expect(transport(page).getByRole("button", { name: "play", exact: true })).toBeVisible();
  await expect.poll(async () => (await get<PlaybackReply>("/playlist/playback")).playing).toBe(false);
  await put("/playlist/playback/play");
  await expect(transport(page).getByRole("button", { name: "pause", exact: true })).toBeVisible();

  // Play a whole playlist by id.
  await put("/playlist/playback/pause");
  await expect(transport(page).getByRole("button", { name: "play", exact: true })).toBeVisible();
  await put("/playlist/play", { id: library.playlists[0].id });
  await expect(transport(page).getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await put("/playlist/playback/pause");

  // Soundboards and their sounds.
  const boards = await get<SoundboardsReply>("/soundboard");
  expect(boards.soundboards.map((board) => board.title)).toEqual(["Remote Board"]);
  const sound = boards.sounds.find((item) => item.title === "Thunder");
  expect(sound).toBeDefined();

  await put("/soundboard/play", { id: sound.id });
  await expect(card(page, "Thunder").getByRole("button", { name: "stop", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await get<SoundboardPlaybackReply>("/soundboard/playback")).sounds.map((item) => item.id))
    .toEqual([sound.id]);
  await put("/soundboard/stop", { id: sound.id });
  await expect(card(page, "Thunder").getByRole("button", { name: "play", exact: true })).toBeVisible();

  // Switching the remote off closes the port.
  await lyre.evaluate(() => (window as unknown as LyreWindow).lyre.remote.set({ enabled: false }));
  await expect.poll(() => fetch(`${base}/playlist`).then(() => "open", () => "closed")).toBe("closed");
  await expect.poll(() => lyre.evaluate(() => (window as unknown as LyreWindow).lyre.remote.get().then((state) => state.enabled))).toBe(false);
});

/** fetch() always sends the address it connects to as Host; DNS rebinding sends a web name instead. */
function statusWithHost(port: number, host: string, authorization: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/v1/playlist", headers: { host, authorization } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });
}
