/**
 * FND-1: the first start of Lyre copies an earlier library: Cue Desk's (the
 * 0.1 drafts, newer) when there is one, otherwise Kenku FM's.
 *
 * Electron's appData folder on Linux is $XDG_CONFIG_HOME, so pointing that
 * at a temporary folder gives a private <appData> with "Kenku FM" (upstream's
 * data folder), "cue-desk" and "lyre" (this app's) side by side. The earlier
 * apps are played by the app itself, started with its data folder set to
 * theirs (same storage format). The next start uses the normal data folder, as
 * an installed copy would, and must show the right library.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { test, expect } from "./fixtures/app";
import { card, createPlaylist } from "./fixtures/player";

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
  await createPlaylist(await kenku.playerView(), "From Kenku FM");
  await kenku.close();
  expect(fs.existsSync(path.join(kenkuFolder, "Local Storage"))).toBe(true);
  expect(fs.existsSync(lyreFolder)).toBe(false);

  // Lyre with its normal data folder.
  const lyre = await launchApp({ userDataDir: null, env: { XDG_CONFIG_HOME: appData } });
  const player = await lyre.playerView();
  await expect(card(player, "From Kenku FM")).toBeVisible();
  expect(await lyre.app.evaluate(({ app }) => app.getPath("userData"))).toBe(lyreFolder);

  const marker = JSON.parse(fs.readFileSync(path.join(lyreFolder, "data-carry-over.json"), "utf8"));
  expect(marker).toMatchObject({ status: "copied", sourceFolder: "Kenku FM", destFolder: "lyre" });
  expect(marker.copiedItems).toContain("Local Storage");

  // A change in Lyre does not touch the Kenku FM library.
  await createPlaylist(player, "Only in Lyre");
  await lyre.close();

  const again = await launchApp({ userDataDir: kenkuFolder, env: { XDG_CONFIG_HOME: appData } });
  const kenkuPlayer = await again.playerView();
  await expect(card(kenkuPlayer, "From Kenku FM")).toBeVisible();
  await expect(card(kenkuPlayer, "Only in Lyre")).toHaveCount(0);
  await again.close();
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
    await createPlaylist(await earlier.playerView(), playlist);
    await earlier.close();
  }

  const lyre = await launchApp({ userDataDir: null, env: { XDG_CONFIG_HOME: appData } });
  const player = await lyre.playerView();
  await expect(card(player, "From Cue Desk")).toBeVisible();
  await expect(card(player, "From Kenku FM")).toHaveCount(0);
  await lyre.close();

  const marker = JSON.parse(fs.readFileSync(path.join(lyreFolder, "data-carry-over.json"), "utf8"));
  expect(marker).toMatchObject({ status: "copied", sourceFolder: "cue-desk", destFolder: "lyre" });
});
