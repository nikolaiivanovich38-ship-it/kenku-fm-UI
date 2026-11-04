/**
 * Steps in the player view (playlists and soundboards) shared by several
 * specs. Each step uses the controls a user would: buttons, dialogs and the
 * file chooser behind "Drag and drop or click to select a track".
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A playlist, soundboard or sound card. The home page's "Playlists" and
 * "Soundboards" sections are cards too, so only innermost cards count.
 */
export function card(page: Page, title: string): Locator {
  return page
    .locator(".MuiCard-root")
    .filter({ has: page.getByText(title, { exact: true }), hasNot: page.locator(".MuiCard-root") });
}

/** One track in the open playlist. */
export function trackRow(page: Page, title: string): Locator {
  return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

/**
 * The transport controls at the bottom of the player (shuffle, previous,
 * play/pause, next, repeat). The track list has play buttons too, so scope
 * to this group.
 */
export function transport(page: Page): Locator {
  return page.getByRole("button", { name: "previous" }).locator("..");
}

/** Create a playlist from the home page. */
export async function createPlaylist(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Add Playlist" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Playlist" });
  await dialog.getByLabel("Name").fill(title);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, title)).toBeVisible();
}

/** Create a soundboard from the home page. */
export async function createSoundboard(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Add Soundboard" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Soundboard" });
  await dialog.getByLabel("Name").fill(title);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, title)).toBeVisible();
}

/** Open a playlist or soundboard by clicking its card. */
export async function openCard(page: Page, title: string): Promise<void> {
  await card(page, title).getByRole("button", { name: "Background" }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}

/**
 * Pick `filePath` in an Add/Edit Track or Sound dialog through the app's own
 * file input (the file chooser opened by the drop zone), then check the
 * Source field shows it as a file:// address.
 */
export async function chooseAudioFile(page: Page, dialog: Locator, filePath: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /click to select a track/ }).click();
  await (await chooser).setFiles(filePath);
  await expect(dialog.getByLabel("Source")).toHaveValue(/^file:\/\//);
}

/** Add a track to the open playlist from a file on disk. */
export async function addTrack(page: Page, filePath: string, title: string): Promise<void> {
  await page.getByRole("button", { name: "Add Track" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Track" });
  await chooseAudioFile(page, dialog, filePath);
  // The name is filled in from the file name; replace it with a known one.
  await expect(dialog.getByLabel("Name")).not.toHaveValue("");
  await dialog.getByLabel("Name").fill(title);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trackRow(page, title)).toBeVisible();
}

/** Add a sound to the open soundboard from a file on disk. */
export async function addSound(
  page: Page,
  filePath: string,
  title: string,
  { fadeIn, fadeOut }: { fadeIn?: number; fadeOut?: number } = {},
): Promise<void> {
  await page.getByRole("button", { name: "Add Sound" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Sound" });
  await chooseAudioFile(page, dialog, filePath);
  await dialog.getByLabel("Name").fill(title);
  if (fadeIn !== undefined) {
    await dialog.getByLabel("fade in").fill(String(fadeIn));
  }
  if (fadeOut !== undefined) {
    await dialog.getByLabel("fade out").fill(String(fadeOut));
  }
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, title)).toBeVisible();
}

/** Current position of the playlist time slider, in seconds. */
export async function playbackPosition(page: Page): Promise<number> {
  const value = await page.getByRole("slider", { name: "time-indicator" }).getAttribute("aria-valuenow");
  return Number(value ?? "0");
}
