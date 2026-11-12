/**
 * WP5 (w3-api): Lyre's library in the packaged app. The Lyre page reaches it through its preload (window.lyre.api);
 * the library runs in its own process, so its changes are on disk after a restart and its heavy work never holds
 * up the main process, where the Discord bots send a voice packet every 20 ms.
 */
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreTab } from "./fixtures/lyre";
import { writeAudioFile, writeSineWav } from "./fixtures/audio";
import { oldFileAddress, writeOldStorage } from "./fixtures/oldStorage";

/** A LyreApi call from the Lyre page, exactly as its screens make them. */
function lyreCall<T = unknown>(lyre: Page, area: string, method: string, ...args: unknown[]): Promise<T> {
  return lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([a, m, rest]) => (window as any).lyre.api.call(a, m, rest),
    [area, method, args] as const,
  ) as Promise<T>;
}

test("a library change made through the Lyre page is still there after a restart", async ({ launchApp }) => {
  const first = await launchApp();
  let lyre = await openLyreTab(await first.mainWindow());
  const made = await lyreCall<{ ok: boolean; value: { id: string } }>(lyre, "playlists", "create", { name: "Tavern brawl", lane: "music", kind: "manual" });
  expect(made.ok).toBe(true);
  await first.close();

  const second = await launchApp();
  lyre = await openLyreTab(await second.mainWindow());
  const playlists = await lyreCall<{ id: string; name: string }[]>(lyre, "playlists", "list");
  expect(playlists.map((p) => p.name)).toContain("Tavern brawl");
  expect(playlists.find((p) => p.name === "Tavern brawl")?.id).toBe(made.value.id);
  // The undo list is kept only while Lyre is open (docs/data-model.md).
  expect(await lyreCall(lyre, "history", "state")).toMatchObject({ canUndo: false });
});

test("tagging 5,000 tracks leaves the main process free: a 20 ms timer keeps its beat within 200 ms", async ({ app, mainWindow, userDataDir }) => {
  test.setTimeout(180_000);
  const folder = path.join(userDataDir, "sounds");
  fs.mkdirSync(folder, { recursive: true });
  // Real (tiny) MP3s: the import refuses files that are not audio (UX review 3).
  for (let i = 0; i < 5000; i++) writeAudioFile(path.join(folder, `rain ${String(i).padStart(4, "0")}.mp3`));

  const lyre = await openLyreTab(mainWindow);
  const imported = await lyreCall<{ ok: boolean; value: { trackIds: string[] } }>(lyre, "import", "start", { from: "paths", paths: [folder] });
  expect(imported.ok).toBe(true);
  const trackIds = imported.value.trackIds;
  expect(trackIds).toHaveLength(5000);

  // The bots' packet timer, stood in for by a 20 ms timer in the main process.
  await app.evaluate(() => {
    const beat = { last: performance.now(), longest: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    g.lyreBeat = beat;
    g.lyreBeatTimer = setInterval(() => {
      const now = performance.now();
      beat.longest = Math.max(beat.longest, now - beat.last);
      beat.last = now;
    }, 20);
  });
  const groups = await lyreCall<{ id: string; name: string }[]>(lyre, "tags", "listGroups");
  const mood = groups.find((g) => g.name === "Mood") ?? groups[0];
  const tagged = await lyreCall<{ ok: boolean }>(lyre, "tags", "tagTracks", { trackIds, add: [{ group: mood.id, value: "Gloomy" }] });
  const longest = await app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    clearInterval(g.lyreBeatTimer);
    return g.lyreBeat.longest as number;
  });
  test.info().annotations.push({ type: "longest gap between 20 ms beats", description: `${Math.round(longest)} ms` });
  expect(tagged.ok).toBe(true);
  expect(longest, "the longest gap between 20 ms beats, in ms").toBeLessThanOrEqual(200);

  const tracks = await lyreCall<{ id: string; tags: Record<string, string[]> }[]>(lyre, "library", "listTracks");
  const gloomy = tracks.filter((t) => (t.tags[mood.id] ?? []).includes("Gloomy"));
  expect(gloomy).toHaveLength(5000);
});

test("the Lyre page hears about changes made through it, and the library tells it in plain words when it restarts", async ({ app, mainWindow }) => {
  const lyre = await openLyreTab(mainWindow);
  await lyre.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = window as any;
    page.lyreEvents = [];
    page.lyre.api.onEvent((event: unknown) => page.lyreEvents.push(event));
  });
  await lyreCall(lyre, "boards", "create", { name: "Storm", cols: 4, rows: 2 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await expect.poll(() => lyre.evaluate(() => (window as any).lyreEvents)).toContainEqual({ type: "changed", areas: expect.arrayContaining(["boards"]) });

  // The library's process stops unexpectedly: the page is told, the library starts again, and the page is told it is back.
  const pid = await app.evaluate(() => (globalThis as unknown as { lyreLibraryPid: () => number }).lyreLibraryPid());
  expect(pid).toBeGreaterThan(0);
  process.kill(pid, "SIGKILL");
  await expect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .poll(() => lyre.evaluate(() => (window as any).lyreEvents.filter((e: { type: string }) => e.type === "library-status").map((e: { ok: boolean }) => e.ok)), { timeout: 20_000 })
    .toEqual([false, true]);
  // 0.5.0: the Saved pop-up is a status of its own, always on the page; the library's message is the one with its words.
  await expect(lyre.getByRole("status").filter({ hasText: "Lyre's library is working again." })).toBeVisible();
  const boards = await lyreCall<{ name: string }[]>(lyre, "boards", "list");
  expect(boards.map((b) => b.name)).toContain("Storm");
});

test("the old player's playlists move into Lyre's library on the first start", async ({ launchApp, userDataDir }) => {
  const lute = writeSineWav(path.join(userDataDir, "audio"), "lute.wav", { seconds: 2 });
  // A library made in the old player (as Kenku FM left it), in the storage the Lyre page shares with it.
  const first = await launchApp();
  await writeOldStorage(await openLyreTab(await first.mainWindow()), {
    playlists: [{ id: "pl-old", title: "Old tavern", tracks: [{ id: "t-lute", url: oldFileAddress(lute), title: "Lute" }] }],
  });
  await first.close();
  // Lyre's library starts again from nothing, as on its first start.
  fs.rmSync(path.join(userDataDir, "library"), { recursive: true, force: true });

  const second = await launchApp();
  const lyre = await openLyreTab(await second.mainWindow());
  await expect.poll(async () => (await lyreCall<{ name: string }[]>(lyre, "playlists", "list")).map((p) => p.name), { timeout: 15_000 }).toContain("Old tavern");
  const tracks = await lyreCall<{ title: string }[]>(lyre, "library", "listTracks");
  expect(tracks.map((t) => t.title)).toContain("Lute");
});
