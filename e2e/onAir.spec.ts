/**
 * BUG-12, BUG-13 (w31-fix) in the packaged app: what plays belongs to the Lyre page, not to a screen. Preparing a
 * scene never stops what is on air or in preview, and music keeps playing, with the On air bar, wherever the game
 * master goes until Stop. Seeded with the prototype's library, whose files play a stand-in tone
 * (src/main/lyreApi/seedAudio.ts).
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "1" };

/** Whether the Lyre page sends sound to this computer's speakers now (Chromium's own audibility check). */
function audible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ webContents }) => webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getTitle() === "Lyre Interface")?.isCurrentlyAudible() ?? false,
  );
}

const onAirBar = (lyre: Page) => lyre.getByRole("region", { name: "On air" });
const abbey = (lyre: Page) => lyre.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ });
const musicOf = (lyre: Page) => abbey(lyre).getByRole("group", { name: "Music", exact: true }).getByRole("list", { name: "Music in order" });

/** Sound now and still a second and a half later, so a short gap between tracks is not taken for silence. */
async function expectSound(app: ElectronApplication, lyre: Page, why: string) {
  await expect.poll(() => audible(app), { message: why, timeout: 5_000 }).toBe(true);
  await lyre.waitForTimeout(1500);
  expect(await audible(app), why).toBe(true);
}

test("adding, moving and removing in a scene leaves the music on air and the preview playing (BUG-12)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "session/crown/s14");
  await lyre.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
  await musicOf(lyre).getByRole("button", { name: "Play on air: The Abbess" }).click();
  await expect(onAirBar(lyre)).toBeVisible();
  const title = (await onAirBar(lyre).locator(".oab-item").first().textContent())?.trim() ?? "";
  expect(title).not.toBe("");
  await musicOf(lyre).getByRole("button", { name: /^Preview Haunted sea shanty/ }).click();
  const stopPreview = musicOf(lyre).getByRole("button", { name: /^Stop preview of Haunted sea shanty/ });
  await expect(stopPreview).toHaveAttribute("aria-pressed", "true");
  await expectSound(launched.app, lyre, "music on air before preparing");

  await abbey(lyre).getByRole("button", { name: "Add tracks or playlists…" }).click();
  const sheet = lyre.getByRole("dialog");
  await sheet.getByRole("checkbox", { name: /^Quiet grief, solo voice/ }).check();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(musicOf(lyre).getByRole("listitem")).toHaveCount(5);
  await musicOf(lyre).getByRole("button", { name: /^More for Quiet grief/ }).click();
  await lyre.getByRole("menuitem", { name: "Start the scene with it" }).click();
  await musicOf(lyre).getByRole("button", { name: /^More for Quiet grief/ }).click();
  await lyre.getByRole("menuitem", { name: "Remove from this scene" }).click();
  await expect(musicOf(lyre).getByRole("listitem")).toHaveCount(4);

  await expect(onAirBar(lyre)).toContainText(title);
  await expect(stopPreview).toHaveAttribute("aria-pressed", "true");
  await expectSound(launched.app, lyre, "music on air after adding, moving and removing");
});

test("music started on one screen keeps playing, with the On air bar, on the others until Stop (BUG-13)", async ({ launchApp }) => {
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "playlists");
  await lyre.getByRole("button", { name: "Play on air: The Company themes" }).first().click();
  await expect(onAirBar(lyre)).toBeVisible();
  const title = (await onAirBar(lyre).locator(".oab-item").first().textContent())?.trim() ?? "";
  await expectSound(launched.app, lyre, "music on air on Playlists");
  // Through the rail, as a person goes: Library, Pad boards, Campaigns, then Live (which says it comes in 0.4).
  for (const [link, heading] of [
    ["Library", "Library"],
    ["Pad boards", "Pad boards"],
    ["Campaigns", "Campaigns"],
    [/^Live/, "Live"],
  ] as const) {
    await lyre.getByRole("navigation").getByRole("link", { name: link }).first().click();
    await expect(lyre.getByRole("main").getByRole("heading", { level: 1 })).toContainText(heading);
    await expect(onAirBar(lyre), `the bar on ${heading}`).toBeInViewport();
    await expect(onAirBar(lyre)).toContainText(title);
    await expectSound(launched.app, lyre, `music on air on ${heading}`);
  }
  await onAirBar(lyre).getByRole("button", { name: "Stop everything on air" }).click();
  await expect(onAirBar(lyre)).toHaveCount(0);
  await expect.poll(() => audible(launched.app), { timeout: 10_000 }).toBe(false);
});
