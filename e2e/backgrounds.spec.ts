/**
 * Kenku FM backgrounds: on start, Cue Desk copies the background pictures
 * from an installed Kenku FM into its data folder, and the player shows them
 * for playlists that use a background by name.
 *
 * A fake Kenku FM install, laid out like Kenku FM 1.5.5's on Windows, is made
 * in a temporary folder that the test build reads instead of %LOCALAPPDATA%
 * (CUE_DESK_LOCAL_APP_DATA_DIR). Its "picture" is a generated 2x2 PNG.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
// Already installed with Electron Forge; packs the fake app.asar below.
import { createPackage } from "@electron/asar";
import { test, expect } from "./fixtures/app";
import { card, openCard } from "./fixtures/player";

/** A 2x2 PNG. */
const PNG_2X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR42mP4z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==",
  "base64",
);

/** Write Kenku FM's app folder (`resources/app`) with one background picture, "tavern". */
function writeKenkuApp(appDir: string): void {
  const renderer = path.join(appDir, ".webpack", "renderer");
  fs.mkdirSync(path.join(renderer, "player_window"), { recursive: true });
  fs.writeFileSync(path.join(renderer, "8141457778d3d8eb6c2b.png"), PNG_2X2);
  fs.writeFileSync(
    path.join(renderer, "player_window", "index.js"),
    'var a={"./tavern.png":78209};function o(e){return r(e)}' +
      ',78209:(e,t,r)=>{"use strict";e.exports=r.p+"8141457778d3d8eb6c2b.png"}',
  );
}

/**
 * Make a Kenku FM install under `localAppData`, as Kenku FM 1.5.5 is on the
 * owner's PC (app folder unpacked), or with the app packed into app.asar.
 */
async function makeFakeKenkuInstall(localAppData: string, { asar = false } = {}): Promise<void> {
  const resources = path.join(localAppData, "kenku-fm-win32-x64", "app-1.5.5", "resources");
  if (asar) {
    const unpacked = path.join(localAppData, "unpacked-app");
    writeKenkuApp(unpacked);
    fs.mkdirSync(resources, { recursive: true });
    await createPackage(unpacked, path.join(resources, "app.asar"));
    fs.rmSync(unpacked, { recursive: true });
  } else {
    writeKenkuApp(path.join(resources, "app"));
  }
  // An uninstalled copy, as Squirrel leaves it, is ignored.
  fs.mkdirSync(path.join(localAppData, "kenku-fm", "app-1.5.5"), { recursive: true });
  fs.writeFileSync(path.join(localAppData, "kenku-fm", ".dead"), "");
}

test("a playlist using Kenku FM's tavern background shows the picture copied from Kenku FM", async ({
  launchApp,
  userDataDir,
}) => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-localappdata-"));
  try {
    await makeFakeKenkuInstall(localAppData);
    const launched = await launchApp({ env: { CUE_DESK_LOCAL_APP_DATA_DIR: localAppData } });
    const page = await launched.playerView();

    const copied = path.join(userDataDir, "backgrounds", "tavern.png");
    expect(fs.readFileSync(copied)).toEqual(PNG_2X2);
    const tavernUrl = pathToFileURL(copied).href;

    // The picture is offered in the Add Playlist dialog under its name.
    await page.getByRole("button", { name: "Add Playlist" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add Playlist" });
    await dialog.getByLabel("Name").fill("Inn");
    await expect(dialog.getByRole("img", { name: "tavern" })).toHaveAttribute("src", tavernUrl);
    await dialog.getByRole("button", { name: "tavern" }).click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Home page card.
    const cardPicture = card(page, "Inn").getByRole("img", { name: "Background" });
    await expect(cardPicture).toHaveAttribute("src", tavernUrl);
    await expect.poll(() => cardPicture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);

    // The open playlist's page background.
    await openCard(page, "Inn");
    await expect
      .poll(() =>
        page.evaluate(
          (url) =>
            Array.from(document.querySelectorAll("div")).some((element) =>
              getComputedStyle(element).backgroundImage.includes(url),
            ),
          tavernUrl,
        ),
      )
      .toBe(true);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
});

test("without Kenku FM the player still starts, with the blank background", async ({ launchApp, userDataDir }) => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-localappdata-"));
  try {
    const launched = await launchApp({ env: { CUE_DESK_LOCAL_APP_DATA_DIR: localAppData } });
    const page = await launched.playerView();
    await page.getByRole("button", { name: "Add Playlist" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add Playlist" });
    await expect(dialog.getByRole("button", { name: "blank" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "tavern" })).toHaveCount(0);
    expect(fs.existsSync(path.join(userDataDir, "backgrounds", "tavern.png"))).toBe(false);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
});

test("pictures are also copied from a Kenku FM whose app is packed in app.asar", async ({ launchApp, userDataDir }) => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-localappdata-"));
  try {
    await makeFakeKenkuInstall(localAppData, { asar: true });
    const launched = await launchApp({ env: { CUE_DESK_LOCAL_APP_DATA_DIR: localAppData } });
    const page = await launched.playerView();
    const copied = path.join(userDataDir, "backgrounds", "tavern.png");
    expect(fs.readFileSync(copied)).toEqual(PNG_2X2);
    await page.getByRole("button", { name: "Add Playlist" }).first().click();
    const picture = page.getByRole("dialog", { name: "Add Playlist" }).getByRole("img", { name: "tavern" });
    await expect(picture).toHaveAttribute("src", pathToFileURL(copied).href);
  } finally {
    fs.rmSync(localAppData, { recursive: true, force: true });
  }
});
