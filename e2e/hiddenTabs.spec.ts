/**
 * A website tab that plays sound keeps playing when another tab is shown.
 * Lyre adds no throttling of its own to hidden tabs: Chromium already
 * slows hidden, silent tabs down and leaves a playing one at full speed
 * (docs/ARCHITECTURE.md, "Hidden tabs"). The PERF-5 debugger throttling was
 * removed after the wave 1 security review measured that it added almost
 * nothing.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";

let site: LocalSite;

test.beforeEach(async () => {
  site = await startLocalSite({
    // A quiet tone from Web Audio, like an ambience site.
    "/tone": {
      title: "Tone",
      body: `<script>
        window.context = new AudioContext();
        const tone = context.createOscillator();
        const volume = context.createGain();
        volume.gain.value = 0.05;
        tone.connect(volume).connect(context.destination);
        tone.start();
        context.resume();
      </script>`,
    },
    "/quiet": { title: "Quiet", body: "<p>Nothing to hear here." },
  });
});

test.afterEach(async () => {
  await site.close();
});

function tab(mainWindow: Page, title: string) {
  return mainWindow.locator("#controls").getByRole("listitem").filter({ hasText: title });
}

async function openInNewTab(mainWindow: Page, address: string) {
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  const field = mainWindow.getByLabel("Web address");
  await field.fill(address);
  await field.press("Enter");
}

function isAudible(app: ElectronApplication, title: string): Promise<boolean> {
  return app.evaluate(({ webContents }, pageTitle) => {
    const contents = webContents.getAllWebContents().find((c) => c.getTitle() === pageTitle);
    return contents?.isCurrentlyAudible() ?? false;
  }, title);
}

test("a hidden tab that plays keeps playing", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await openInNewTab(mainWindow, site.url("/tone"));
  const tone = await pageWithTitle(app, "Tone");
  await expect.poll(() => isAudible(app, "Tone"), { timeout: 10_000 }).toBe(true);
  await openInNewTab(mainWindow, site.url("/quiet"));
  await pageWithTitle(app, "Quiet");
  await expect(tab(mainWindow, "Quiet")).toBeVisible();

  // Hidden for a while: still audible, and its audio clock keeps real time.
  const clock = () => tone.evaluate(() => (window as unknown as { context: AudioContext }).context.currentTime);
  const before = await clock();
  for (let waited = 0; waited < 4_000; waited += 500) {
    expect(await isAudible(app, "Tone")).toBe(true);
    await mainWindow.waitForTimeout(500);
  }
  expect(await clock()).toBeGreaterThan(before + 3);
});
