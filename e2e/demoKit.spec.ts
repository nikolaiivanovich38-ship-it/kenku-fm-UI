/**
 * The Lyre demo kit (scripts/demo-kit/build.mjs) works in the packaged app
 * the way its README tells the product owner to use it: its music imports
 * and plays, and its local soundboard page opens from the address bar, plays
 * the sounds in its own folder and is refused anything outside it (SEC-15).
 *
 * The kit is built fresh into a temporary folder, so this checks what the
 * script makes today, not a stale copy.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { chooseAudioFile, createPlaylist, openCard, playbackPosition, transport } from "./fixtures/player";

const repoRoot = path.resolve(__dirname, "..");
let outRoot: string;
let kit: string;

test.beforeAll(() => {
  // The real path, as the app shows it (on Windows the temp folder may be a short 8.3 name).
  outRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "lyre-demo-kit-")));
  execFileSync(process.execPath, [path.join(repoRoot, "scripts/demo-kit/build.mjs"), "--out", outRoot], {
    stdio: "pipe",
    timeout: 120_000,
  });
  kit = path.join(outRoot, "demo-kit", "Lyre-demo-kit");
});

test.afterAll(() => {
  if (outRoot) fs.rmSync(outRoot, { recursive: true, force: true });
});

/**
 * The "Open this file from your computer?" question is a native dialog,
 * which Playwright cannot click: answer it in the main process instead and
 * record what was asked (as in localFiles.spec.ts).
 */
async function answerFileQuestions(app: ElectronApplication, answer: { response: number; checkboxChecked: boolean }) {
  await app.evaluate(({ dialog }, reply) => {
    const state = globalThis as unknown as { fileQuestions?: string[] };
    state.fileQuestions ??= [];
    dialog.showMessageBox = (async (_window: unknown, options: { message: string; detail: string }) => {
      state.fileQuestions!.push(`${options.message}\n${options.detail}`);
      return reply;
    }) as typeof dialog.showMessageBox;
  }, answer);
}

function questionsAsked(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { fileQuestions?: string[] }).fileQuestions ?? []);
}

/** Add a track through the Add Track dialog and keep the name Lyre makes from the file name. */
async function addKitTrack(page: Page, filePath: string, cueTitle: string): Promise<void> {
  await page.getByRole("button", { name: "Add Track" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Track" });
  await chooseAudioFile(page, dialog, filePath);
  // Lyre keeps the file name exactly as written, cue notes included.
  const expected = path.basename(filePath).replace(/\.[^.]+$/, "");
  await expect(dialog.getByLabel("Name")).toHaveValue(expected);
  expect(expected.startsWith(`${cueTitle} - `)).toBe(true);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("the kit's music imports into a playlist and plays", async ({ playerView: page }) => {
  const music = fs.readdirSync(path.join(kit, "Music")).sort();
  expect(music).toHaveLength(4);

  await createPlaylist(page, "Demo kit");
  await openCard(page, "Demo kit");
  for (const file of music) {
    await addKitTrack(page, path.join(kit, "Music", file), file.split(" - ")[0]);
  }
  await expect(page.getByRole("listitem")).toHaveCount(4);

  const tavern = page.getByRole("listitem").filter({ hasText: /^Tavern Warmth/ });
  await tavern.getByRole("button", { name: "play", exact: true }).click();
  await expect(tavern.getByRole("button", { name: "pause", exact: true })).toBeVisible();
  await expect(transport(page).getByRole("button", { name: "pause", exact: true })).toBeEnabled();
  // Time moves on: the 32-second WAV decodes and plays.
  await expect.poll(() => playbackPosition(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
});

test("the local soundboard opens from the address bar, plays its own sounds and is kept in its folder", async ({
  app,
  mainWindow,
  playerView,
  errors,
}) => {
  // The page's own refusals (README one folder up, the web) are the point of the test.
  errors.expectedRefusals.push({
    page: /^(cue-local-file|file):/,
    text: /Content Security Policy|Refused to|Failed to load resource|Not allowed to load local resource/,
  });
  const page = path.join(kit, "Local soundboard", "soundboard.html");
  expect(fs.existsSync(path.join(kit, "README.txt"))).toBe(true);

  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 0, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  // Pasted as a plain path, the way the README describes; the folder name has a space in it.
  const address = mainWindow.getByLabel("Web address");
  await address.fill(page);
  await address.press("Enter");

  const soundboard = await pageWithTitle(app, "Lyre demo soundboard");
  const asked = await questionsAsked(app);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Open this file from your computer?");
  expect(asked[0]).toContain(page);

  // A sound next to the page plays.
  await soundboard.getByRole("button", { name: /Sword clash/ }).click();
  await expect(soundboard.locator("#status")).toHaveText(/^(Playing|Finished): Sword clash$/);

  // The folder rule: the page's own folder yes, one folder up and the web no.
  await soundboard.locator("#try-notes").click();
  await expect(soundboard.locator("#result-notes")).toHaveText(/^Allowed/);
  await soundboard.locator("#try-readme").click();
  await expect(soundboard.locator("#result-readme")).toHaveText(/^Blocked/);
  await soundboard.locator("#try-web").click();
  await expect(soundboard.locator("#result-web")).toHaveText(/^Blocked/);
});
