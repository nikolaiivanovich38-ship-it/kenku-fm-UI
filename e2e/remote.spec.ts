/**
 * The remote-control API used by Kenku Remote and the Stream Deck plugin
 * (src/main/remote): switched on in Settings, then driven over HTTP the way
 * those tools do (https://www.kenku.fm/docs/using-kenku-remote).
 */
import net from "net";
import { test, expect } from "./fixtures/app";
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

  // Switch the remote on, on a free port.
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/v1`;
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByLabel("Address", { exact: true })).toHaveValue("127.0.0.1");
  await settings.getByLabel("Port", { exact: true }).fill(String(port));
  await settings.getByRole("button", { name: "Start Remote" }).click();
  await expect(settings.getByRole("button", { name: "Stop Remote" })).toBeVisible();

  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}${path}`);
    expect(response.status, `GET ${path}`).toBe(200);
    return (await response.json()) as T;
  };
  const put = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    expect(response.status, `PUT ${path}`).toBe(200);
  };

  // Playlists and their tracks.
  const library = await get<PlaylistsReply>("/playlist");
  expect(library.playlists.map((playlist) => playlist.title)).toEqual(["Remote Playlist"]);
  const march = library.tracks.find((track) => track.title === "March");
  expect(march).toBeDefined();
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
  await settings.getByRole("button", { name: "Stop Remote" }).click();
  await expect(settings.getByRole("button", { name: "Start Remote" })).toBeVisible();
  await expect.poll(() => fetch(`${base}/playlist`).then(() => "open", () => "closed")).toBe("closed");
});
