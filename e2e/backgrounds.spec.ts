/**
 * Built-in background pictures: Cue Desk ships its own 23 pictures under the
 * names Kenku FM used, bundled into the app. Nothing is read from an
 * installed Kenku FM and nothing is copied into the data folder.
 */
import fs from "fs";
import path from "path";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { card, openCard } from "./fixtures/player";

const BUILT_IN = [
  "autumn", "beach", "butterflys", "castle", "cathedral", "dragon", "haunted", "lines",
  "mountain", "sand", "skulls", "sky", "smoke", "sparks", "stars", "tavern", "texture",
  "town", "tree", "veins", "volcano", "war", "winter",
];

/**
 * The bundled pictures are 1600×1000 JPEGs inside the app, not files in the
 * data folder. Answers the picture's full address.
 */
async function expectBundledPicture(image: Locator, userDataDir: string): Promise<string> {
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
  const address = await image.evaluate((img: HTMLImageElement) => img.currentSrc);
  expect(address).toMatch(/\.jpg$/);
  expect(decodeURIComponent(address)).not.toContain(userDataDir);
  return address;
}

test("a new playlist offers the 23 built-in pictures and blank", async ({ playerView: page, userDataDir }) => {
  await page.getByRole("button", { name: "Add Playlist" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Playlist" });
  for (const name of [...BUILT_IN, "blank"]) {
    await expect(dialog.getByRole("button", { name, exact: true })).toHaveCount(1);
  }
  await expect(dialog.getByRole("img")).toHaveCount(BUILT_IN.length + 1);
  await expectBundledPicture(dialog.getByRole("img", { name: "tavern", exact: true }), userDataDir);
  await expectBundledPicture(dialog.getByRole("img", { name: "butterflys", exact: true }), userDataDir);
  // Nothing is copied from Kenku FM any more.
  expect(fs.existsSync(path.join(userDataDir, "backgrounds"))).toBe(false);
});

test("a playlist and a soundboard stored with Kenku FM's background names show the bundled pictures", async ({
  launchApp,
  userDataDir,
}) => {
  // A library as Kenku FM (or an earlier Cue Desk) saved it: backgrounds by name.
  const first = await launchApp();
  const before = await first.playerView();
  await before.waitForTimeout(1_000);
  await before.evaluate(() => {
    const playlists = {
      playlists: { byId: { inn: { id: "inn", title: "Inn", tracks: [] as string[], background: "tavern" } }, allIds: ["inn"] },
      tracks: {},
    };
    const soundboards = {
      soundboards: { byId: { glade: { id: "glade", title: "Glade", sounds: [] as string[], background: "butterflys" } }, allIds: ["glade"] },
      sounds: {},
    };
    localStorage.setItem(
      "persist:player",
      JSON.stringify({
        playlists: JSON.stringify(playlists),
        soundboards: JSON.stringify(soundboards),
        _persist: JSON.stringify({ version: 1, rehydrated: true }),
      }),
    );
  });
  await first.close();

  const page = await (await launchApp()).playerView();
  const tavern = await expectBundledPicture(card(page, "Inn").getByRole("img", { name: "Background" }), userDataDir);
  await expectBundledPicture(card(page, "Glade").getByRole("img", { name: "Background" }), userDataDir);

  // The open playlist shows the same picture behind its page.
  await openCard(page, "Inn");
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          Array.from(document.querySelectorAll("div")).some((element) =>
            getComputedStyle(element).backgroundImage.includes(url),
          ),
        tavern,
      ),
    )
    .toBe(true);
});
