/**
 * FND-1: the first start of Cue Desk copies an existing Kenku FM library.
 *
 * Electron's appData folder on Linux is $XDG_CONFIG_HOME, so pointing that
 * at a temporary folder gives a private <appData> with "Kenku FM" (upstream's
 * data folder) and "cue-desk" (this app's) side by side. The first start
 * plays the part of Kenku FM: the app runs with its data folder set to
 * <appData>/Kenku FM and a playlist is made there. The second start uses the
 * normal data folder, as an installed copy would, and must show that playlist.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { test, expect } from "./fixtures/app";
import { card, createPlaylist } from "./fixtures/player";

test("a Kenku FM library is carried over on the first start", async ({ launchApp }) => {
  test.skip(process.platform !== "linux", "XDG_CONFIG_HOME sets Electron's appData folder on Linux only");

  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-appdata-"));
  try {
    const kenkuFolder = path.join(appData, "Kenku FM");
    const cueDeskFolder = path.join(appData, "cue-desk");

    // "Kenku FM": same storage format, written into upstream's folder.
    const kenku = await launchApp({ userDataDir: kenkuFolder, env: { XDG_CONFIG_HOME: appData } });
    await createPlaylist(await kenku.playerView(), "From Kenku FM");
    await kenku.close();
    expect(fs.existsSync(path.join(kenkuFolder, "Local Storage"))).toBe(true);
    expect(fs.existsSync(cueDeskFolder)).toBe(false);

    // Cue Desk with its normal data folder.
    const cueDesk = await launchApp({ userDataDir: null, env: { XDG_CONFIG_HOME: appData } });
    const player = await cueDesk.playerView();
    await expect(card(player, "From Kenku FM")).toBeVisible();
    expect(
      await cueDesk.app.evaluate(({ app }) => app.getPath("userData")),
    ).toBe(cueDeskFolder);

    const marker = JSON.parse(fs.readFileSync(path.join(cueDeskFolder, "data-carry-over.json"), "utf8"));
    expect(marker).toMatchObject({ status: "copied", sourceFolder: "Kenku FM", destFolder: "cue-desk" });
    expect(marker.copiedItems).toContain("Local Storage");

    // A change in Cue Desk does not touch the Kenku FM library.
    await createPlaylist(player, "Only in Cue Desk");
    await cueDesk.close();

    const again = await launchApp({ userDataDir: kenkuFolder, env: { XDG_CONFIG_HOME: appData } });
    const kenkuPlayer = await again.playerView();
    await expect(card(kenkuPlayer, "From Kenku FM")).toBeVisible();
    await expect(card(kenkuPlayer, "Only in Cue Desk")).toHaveCount(0);
    await again.close();
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});
