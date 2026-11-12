/**
 * FND-16 (0.5.1) in the packaged app: someone upgrading from Kenku FM (or Lyre up to 0.5.0) has their old window's
 * and old player's storage behind the Lyre page. On the first start of 0.5.1 Lyre takes it over once, reading it only:
 * the playlists come into the library, a bot token Kenku FM kept in plain text goes to the bots and logs in at once,
 * Settings › Discord bots says so once, Sound to Discord keeps its choice, and the bookmarks are listed to copy.
 * Once the token is saved encrypted, its plain copy leaves the old storage (CR51-1); the rest stays as it was.
 * A saved bot logs in at every start without anyone pressing Connect (the reviewer's open question on 0.5.1).
 *
 * The test machine has no keyring, so these starts use the test builds' fake one (CUE_DESK_FAKE_KEYRING): bots are
 * saved and come back after a restart, as on Windows.
 */
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { writeSineWav } from "./fixtures/audio";
import { FAKE_DISCORD_ENV } from "./fixtures/discord";
import { openLyreRoute, openLyreTab } from "./fixtures/lyre";
import { forgetLyreLibrary, oldFileAddress, writeOldStorage } from "./fixtures/oldStorage";

/** Shaped like a bot token (three parts, CR51-6); "fake-" lets the fake Discord log it in. */
const TOKEN = "fake-token.FROM-KENKU-FM.42";
/** A Linux test machine has no keyring: the fake Discord, and the test builds' fake keyring so bots stay saved. */
const ENV = { ...FAKE_DISCORD_ENV, CUE_DESK_FAKE_KEYRING: "1" };

/** Each bot's login state ("ready" is a logged-in bot, src/common/outputs.ts). */
function botLogins(lyre: Page): Promise<string[]> {
  return lyre.evaluate(async () =>
    (await (window as unknown as { lyre: { outputs: { get(): Promise<{ bots: { login: string }[] }> } } }).lyre.outputs.get()).bots.map((b) => b.login),
  );
}

/** The settings part of the old window's storage, as stored now. */
function oldSettings(lyre: Page): Promise<Record<string, unknown>> {
  return lyre.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("persist:root") ?? "{}").settings ?? "{}"));
}

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
  const first = await launchApp({ env: ENV });
  await writeOldStorage(await openLyreTab(await first.mainWindow()), {
    playlists: [{ id: "pl-tavern", title: "Old tavern", tracks: [{ id: "t-lute", url: oldFileAddress(lute), title: "Lute" }] }],
    token: TOKEN,
    streamingMode: "lowLatency",
    bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/" }],
  });
  await first.close();
  // 0.5.1 starts for the first time on it: no Lyre library yet.
  forgetLyreLibrary(userDataDir);

  const second = await launchApp({ env: ENV });
  const lyre = await openLyreTab(await second.mainWindow());
  await expect.poll(async () => (await lyreCall<{ name: string }[]>(lyre, "playlists", "list")).map((p) => p.name), { timeout: 15_000 }).toContain("Old tavern");
  // The moved token logs its bot in without anyone pressing Connect ("ready" is a logged-in bot, src/common/outputs.ts).
  await expect.poll(() => botLogins(lyre), { timeout: 15_000 }).toContain("ready");
  // Sound to Discord keeps the old window's choice.
  expect((await lyreCall<{ streamingMode: string }>(lyre, "settings", "get")).streamingMode).toBe("lowLatency");

  await openLyreRoute(lyre, "settings");
  const note = lyre.getByRole("region", { name: "Discord bots", exact: true }).getByRole("note");
  await expect(note).toContainText("Lyre moved your Discord bot token from Kenku FM. Kenku FM kept it unprotected on this computer; Lyre keeps it encrypted now.");
  await note.getByRole("button", { name: "Got it" }).click();
  await expect(note).toHaveCount(0);

  await openLyreRoute(lyre, "moved");
  const bookmarks = lyre.getByRole("region", { name: "Bookmarks", exact: true });
  await expect(bookmarks.getByRole("listitem")).toHaveText([/Tabletop Audio\s*https:\/\/tabletopaudio\.com\//]);
  // CR51-1: the token is saved encrypted, so its plain copy has left Lyre's storage; the rest is as it was.
  expect(await oldSettings(lyre)).toEqual({ streamingMode: "lowLatency" });
  expect(await lyre.evaluate(() => localStorage.getItem("persist:root"))).not.toContain(TOKEN);
  await second.close();

  // Got it is for good, nothing comes across twice, and the saved bot logs in by itself at the next start.
  const third = await launchApp({ env: ENV });
  const again = await openLyreRoute(await third.mainWindow(), "settings");
  await expect.poll(() => botLogins(again), { message: "the saved bot logs in without Connect", timeout: 15_000 }).toContain("ready");
  await expect(again.getByRole("region", { name: "Discord bots", exact: true }).getByRole("note")).toHaveCount(0);
  expect((await lyreCall<{ name: string }[]>(again, "playlists", "list")).filter((p) => p.name === "Old tavern")).toHaveLength(1);
});

test("a bot saved in Lyre logs in when Lyre starts again, without anyone pressing Connect", async ({ launchApp }) => {
  const first = await launchApp({ env: ENV });
  const lyre = await openLyreTab(await first.mainWindow());
  const botId = await lyre.evaluate(async () => (await (window as unknown as { lyre: { outputs: { get(): Promise<{ bots: { id: string }[] }> } } }).lyre.outputs.get()).bots[0].id);
  const result = await lyre.evaluate(
    ([id, token]) => (window as unknown as { lyre: { outputs: { replaceToken(id: string, token: string): Promise<{ ok: boolean }> } } }).lyre.outputs.replaceToken(id, token),
    [botId, "fake-saved.bot-for.restart"] as const,
  );
  expect(result.ok).toBe(true);
  await expect.poll(() => botLogins(lyre), { timeout: 15_000 }).toEqual(["ready"]);
  await first.close();

  const second = await launchApp({ env: ENV });
  const again = await openLyreTab(await second.mainWindow());
  await expect.poll(() => botLogins(again), { message: "the saved bot logs in at start", timeout: 15_000 }).toEqual(["ready"]);
});
