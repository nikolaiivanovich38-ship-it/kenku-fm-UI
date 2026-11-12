/**
 * Copy in the packaged app (Nik, 0.5.0: "Copy path" said the path was copied, and nothing reached the clipboard). The
 * Lyre page may write text to the clipboard (src/main/security/permissions.ts); what it copies is read back from the
 * main process's clipboard, where Windows' paste would find it.
 */
import { test, expect } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "prototype" };

test("Copy path in a track's details puts the file's whole path on the clipboard", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText("something else"));
  const lyre = await openLyreRoute(await launched.mainWindow(), "library/t44");
  const details = lyre.getByRole("region", { name: "Details", exact: true });
  await details.getByRole("button", { name: "Copy path" }).click();
  const path = "H:\\Audio\\Scores\\Bear McCreary\\God of War\\13 Ashes.flac";
  await expect(lyre.getByText(`Path copied: ${path}`)).toBeVisible();
  await expect.poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path);
});

test("Copy beside an old bookmark on What came across puts its address on the clipboard (CR51-5)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText("something else"));
  const lyre = await openLyreRoute(await launched.mainWindow(), "moved");
  const bookmarks = lyre.getByRole("region", { name: "Bookmarks", exact: true });
  await bookmarks.getByRole("button", { name: "Copy the address of YouTube" }).click();
  await expect(lyre.getByText("Copied: https://www.youtube.com/")).toBeVisible();
  await expect.poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("https://www.youtube.com/");
});
