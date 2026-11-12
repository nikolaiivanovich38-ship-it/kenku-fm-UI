/**
 * FND-16 (0.5.1) in the packaged app: someone upgrading from Kenku FM (or Lyre up to 0.5.0) has their old window's
 * and old player's storage behind the Lyre page. On the first start of 0.5.1 Lyre takes it over once, reading it only:
 * the playlists come into the library, a bot token Kenku FM kept in plain text goes to the bots and logs in at once,
 * Settings › Discord bots says so once, Sound to Discord keeps its choice, and the bookmarks are listed to copy.
 * The old storage stays as it was, for a portable 0.4.1 copy.
 */
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";
import { FAKE_DISCORD_ENV } from "./fixtures/discord";
import { openLyreRoute, openLyreTab } from "./fixtures/lyre";
import { forgetLyreLibrary, oldFileAddress, writeOldStorage } from "./fixtures/oldStorage";

const TOKEN = "fake-token-FROM-KENKU-FM-42";

/** A LyreApi call from the Lyre page, as its screens make them. */
function lyreCall<T = unknown>(lyre: Page, area: string, method: string, ...args: unknown[]): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lyre.evaluate(([a, m, rest]) => (window as any).lyre.api.call(a, m, rest), [area, method, args] as const) as Promise<T>;
}

test("a Kenku FM user upgrading straight to 0.5.1 finds the playlists, the bot logged in, the note, the bookmarks and Sound to Discord", async ({
  launchApp,
  userDataDir,
}) => {
  const lute = writeSineWav(path.join(userDataDir, "audio"), "lute.wav", { seconds: 2 });
  // What Kenku FM left in the storage the Lyre page reads.
  const first = await launchApp({ env: FAKE_DISCORD_ENV });
  await writeOldStorage(await openLyreTab(await first.mainWindow()), {
    playlists: [{ id: "pl-tavern", title: "Old tavern", tracks: [{ id: "t-lute", url: oldFileAddress(lute), title: "Lute" }] }],
    token: TOKEN,
    streamingMode: "lowLatency",
    bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/" }],
  });
  await first.close();
  // 0.5.1 starts for the first time on it: no Lyre library yet.
  forgetLyreLibrary(userDataDir);

  const second = await launchApp({ env: FAKE_DISCORD_ENV });
  const lyre = await openLyreTab(await second.mainWindow());
  await expect.poll(async () => (await lyreCall<{ name: string }[]>(lyre, "playlists", "list")).map((p) => p.name), { timeout: 15_000 }).toContain("Old tavern");
  // The moved token logs its bot in without anyone pressing Connect ("ready" is a logged-in bot, src/common/outputs.ts).
  await expect
    .poll(async () => (await lyre.evaluate(() => (window as unknown as { lyre: { outputs: { get(): Promise<{ bots: { login: string }[] }> } } }).lyre.outputs.get())).bots.map((b) => b.login), {
      timeout: 15_000,
    })
    .toContain("ready");
  // Sound to Discord keeps the old window's choice.
  expect((await lyreCall<{ streamingMode: string }>(lyre, "settings", "get")).streamingMode).toBe("lowLatency");

  await openLyreRoute(lyre, "settings");
  const note = lyre.getByRole("region", { name: "Discord bots", exact: true }).getByRole("note");
  await expect(note).toContainText(/Lyre moved your Discord bot token from Kenku FM|Your Discord bot token from Kenku FM is kept only until Lyre closes/);
  await note.getByRole("button", { name: "Got it" }).click();
  await expect(note).toHaveCount(0);

  await openLyreRoute(lyre, "moved");
  const bookmarks = lyre.getByRole("region", { name: "Bookmarks", exact: true });
  await expect(bookmarks.getByRole("listitem")).toHaveText([/Tabletop Audio\s*https:\/\/tabletopaudio\.com\//]);
  // The old storage is only read: a portable 0.4.1 copy still finds it.
  expect(await lyre.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("persist:root") ?? "{}").settings ?? "{}").discordToken)).toBe(TOKEN);
  await second.close();

  // Got it is for good, and nothing comes across twice.
  const third = await launchApp({ env: FAKE_DISCORD_ENV });
  const again = await openLyreRoute(await third.mainWindow(), "settings");
  await expect(again.getByRole("region", { name: "Discord bots", exact: true }).getByRole("note")).toHaveCount(0);
  expect((await lyreCall<{ name: string }[]>(again, "playlists", "list")).filter((p) => p.name === "Old tavern")).toHaveLength(1);
});
