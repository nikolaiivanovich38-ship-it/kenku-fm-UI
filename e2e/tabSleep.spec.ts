/**
 * PERF-5: a website tab that is hidden and silent goes to sleep (its
 * processor use is limited) and wakes when shown; a hidden tab that is
 * playing keeps playing at full speed, because its sound is being sent to
 * Discord.
 *
 * The app normally waits a minute of silence; test builds read
 * CUE_DESK_TAB_SLEEP_MS so this test waits one second instead.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";

const SLEEP_MS = 1_000;

let site: LocalSite;

test.beforeEach(async () => {
  site = await startLocalSite({
    // A quiet tone from Web Audio, like an ambience site.
    "/tone": {
      title: "Tone",
      body: `<script>
        const context = new AudioContext();
        const tone = context.createOscillator();
        const volume = context.createGain();
        volume.gain.value = 0.05;
        tone.connect(volume).connect(context.destination);
        tone.start();
        context.resume();
      </script>`,
    },
    // A silent page that keeps busy, like a site animating its page.
    "/quiet": {
      title: "Quiet",
      body: `<script>
        window.work = 0;
        setInterval(() => {
          const end = performance.now() + 2;
          while (performance.now() < end) window.work++;
        }, 10);
      </script>`,
    },
  });
});

test.afterEach(async () => {
  await site.close();
});

function tab(mainWindow: Page, title: string) {
  return mainWindow.locator("#controls").getByRole("listitem").filter({ hasText: title });
}

async function openInNewTab(mainWindow: Page, address: string) {
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
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

/** How much busy work the quiet page gets done in `ms`. */
async function workDoneIn(page: Page, ms: number): Promise<number> {
  const before = await page.evaluate(() => (window as unknown as { work: number }).work);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => (window as unknown as { work: number }).work);
  return after - before;
}

/** A sleeping tab has the app's debugger session attached (it is detached on waking). */
function isAsleep(app: ElectronApplication, title: string): Promise<boolean> {
  return app.evaluate(({ webContents }, pageTitle) => {
    const contents = webContents.getAllWebContents().find((c) => c.getTitle() === pageTitle);
    return contents?.debugger.isAttached() ?? false;
  }, title);
}

test("a hidden tab that plays keeps playing; a hidden silent tab sleeps and wakes when shown", async ({
  launchApp,
}) => {
  const launched = await launchApp({ env: { CUE_DESK_TAB_SLEEP_MS: String(SLEEP_MS) } });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  const playerView = await launched.playerView();
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();

  await openInNewTab(mainWindow, site.url("/quiet"));
  const quiet = await pageWithTitle(app, "Quiet");
  await openInNewTab(mainWindow, site.url("/tone"));
  await pageWithTitle(app, "Tone");
  await expect.poll(() => isAudible(app, "Tone"), { timeout: 10_000 }).toBe(true);

  // Hide the playing tab and wait well past the delay: it must keep playing.
  await tab(mainWindow, "Quiet").click();
  for (let waited = 0; waited < SLEEP_MS * 4; waited += 500) {
    expect(await isAudible(app, "Tone")).toBe(true);
    await mainWindow.waitForTimeout(500);
  }
  expect(await isAsleep(app, "Tone")).toBe(false);

  // The quiet tab, hidden past the delay, sleeps: it gets much less done.
  // A first sleep and wake, then a second sleep, as in a game session.
  await tab(mainWindow, "Tone").click();
  await expect.poll(() => isAsleep(app, "Quiet"), { timeout: 10_000 }).toBe(true);
  await tab(mainWindow, "Quiet").click();
  await expect.poll(() => isAsleep(app, "Quiet")).toBe(false);
  await tab(mainWindow, "Tone").click();
  await expect.poll(() => isAsleep(app, "Quiet"), { timeout: 10_000 }).toBe(true);
  const asleep = await workDoneIn(quiet, 2_000);

  // Shown again, it wakes and runs at full speed.
  await tab(mainWindow, "Quiet").click();
  await expect.poll(() => isAsleep(app, "Quiet")).toBe(false);
  const awake = await workDoneIn(quiet, 2_000);
  expect(awake).toBeGreaterThan(asleep * 3);
});
