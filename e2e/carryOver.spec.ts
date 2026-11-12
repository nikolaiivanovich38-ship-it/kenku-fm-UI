/**
 * FND-1: the first start of Lyre copies an earlier library: Cue Desk's (the
 * 0.1 drafts, newer) when there is one, otherwise Kenku FM's.
 *
 * Electron's appData folder on Linux is $XDG_CONFIG_HOME, so pointing that
 * at a temporary folder gives a private <appData> with "Kenku FM" (upstream's
 * data folder), "cue-desk" and "lyre" (this app's) side by side. The earlier
 * apps are played by the app itself, started with its data folder set to
 * theirs (same storage format): their playlists are written into the storage
 * the old player kept them in (FND-16: the old player is gone). The next start
 * uses the normal data folder, as an installed copy would, and Lyre's library
 * must hold the right playlists.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect, type LaunchedApp } from "./fixtures/app";
import { openLyreTab } from "./fixtures/lyre";
import { writeOldStorage } from "./fixtures/oldStorage";

/** An earlier app's library with one playlist, written as its old player kept it. */
async function oldPlaylist(launched: LaunchedApp, title: string): Promise<void> {
  await writeOldStorage(await openLyreTab(await launched.mainWindow()), {
    playlists: [{ id: `pl-${title.replace(/\W/g, "")}`, title, tracks: [{ id: `t-${title.length}`, url: "https://example.com/tune.mp3", title: "Tune" }] }],
  });
}

/** The playlists in Lyre's library. */
async function playlistNames(launched: LaunchedApp): Promise<string[]> {
  const lyre: Page = await openLyreTab(await launched.mainWindow());
  let names: string[] = [];
  await expect
    .poll(
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        names = ((await lyre.evaluate(() => (window as any).lyre.api.call("playlists", "list", []))) as { name: string }[]).map((p) => p.name);
        return names.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  return names;
}

test.skip(process.platform !== "linux", "XDG_CONFIG_HOME sets Electron's appData folder on Linux only");

let appData: string;
test.beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-appdata-"));
});
test.afterEach(() => {
  fs.rmSync(appData, { recursive: true, force: true });
});

test("a Kenku FM library is carried over on the first start", async ({ launchApp }) => {
  const kenkuFolder = path.join(appData, "Kenku FM");
  const lyreFolder = path.join(appData, "lyre");

  // "Kenku FM": same storage format, written into upstream's folder.
  const kenku = await launchApp({ userDataDir: kenkuFolder, env: { XDG_CONFIG_HOME: appData } });
  await oldPlaylist(kenku, "From Kenku FM");
  await kenku.close();
  expect(fs.existsSync(path.join(kenkuFolder, "Local Storage"))).toBe(true);
  expect(fs.existsSync(lyreFolder)).toBe(false);

  // Lyre with its normal data folder.
  const lyre = await launchApp({ userDataDir: null, env: { XDG_CONFIG_HOME: appData } });
  expect(await playlistNames(lyre)).toContain("From Kenku FM");
  expect(await lyre.app.evaluate(({ app }) => app.getPath("userData"))).toBe(lyreFolder);

  const marker = JSON.parse(fs.readFileSync(path.join(lyreFolder, "data-carry-over.json"), "utf8"));
  expect(marker).toMatchObject({ status: "copied", sourceFolder: "Kenku FM", destFolder: "lyre" });
  expect(marker.copiedItems).toContain("Local Storage");

  await lyre.close();
  // Lyre keeps its library in its own folder: the Kenku FM folder has no Lyre library.
  expect(fs.existsSync(path.join(lyreFolder, "library"))).toBe(true);
});

test("a Cue Desk library is preferred to an older Kenku FM one", async ({ launchApp }) => {
  const kenkuFolder = path.join(appData, "Kenku FM");
  const cueDeskFolder = path.join(appData, "cue-desk");
  const lyreFolder = path.join(appData, "lyre");

  for (const [folder, playlist] of [
    [kenkuFolder, "From Kenku FM"],
    [cueDeskFolder, "From Cue Desk"],
  ]) {
    const earlier = await launchApp({ userDataDir: folder, env: { XDG_CONFIG_HOME: appData } });
    await oldPlaylist(earlier, playlist);
    await earlier.close();
  }

  const lyre = await launchApp({ userDataDir: null, env: { XDG_CONFIG_HOME: appData } });
  const names = await playlistNames(lyre);
  expect(names).toContain("From Cue Desk");
  expect(names).not.toContain("From Kenku FM");
  await lyre.close();

  const marker = JSON.parse(fs.readFileSync(path.join(lyreFolder, "data-carry-over.json"), "utf8"));
  expect(marker).toMatchObject({ status: "copied", sourceFolder: "cue-desk", destFolder: "lyre" });
});
