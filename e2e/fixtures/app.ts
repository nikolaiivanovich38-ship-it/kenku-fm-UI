/**
 * FND-4: shared fixture for end-to-end tests. Starts the packaged app with a
 * fresh, empty data folder, collects errors from every page and from the main
 * process, and closes the app afterwards.
 *
 * Usage in a spec:
 *   import { test, expect } from "./fixtures/app";
 *   test("…", async ({ app, mainWindow, playerView, errors }) => { … });
 */
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { assertE2EBuild, findPackagedExecutable, launchArgs } from "./packagedApp";

/** Errors seen while the app ran, by where they came from. */
export type CollectedErrors = {
  /** Uncaught exceptions in any page (main window, player view, capture window). */
  pageErrors: { page: string; message: string }[];
  /** Main-process crash or uncaught-exception output on stderr. */
  mainProcess: string[];
};

type AppFixtures = {
  /** Throw-away data folder (CUE_DESK_USER_DATA_DIR) for this test. */
  userDataDir: string;
  app: ElectronApplication;
  errors: CollectedErrors;
  /** The main window (title "Cue Desk"). */
  mainWindow: Page;
  /** The player view: playlists and soundboards (title "Cue Desk Player"). */
  playerView: Page;
};

/** Main-process lines that mean something went badly wrong. */
const MAIN_PROCESS_FAILURE = /Uncaught Exception|A JavaScript error occurred in the main process|UnhandledPromiseRejection|FATAL:/;

/** Find an open page by its document title, waiting for it to appear. */
export async function pageWithTitle(app: ElectronApplication, title: string, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const pageTitle = await page.title().catch(() => "");
      if (pageTitle === title) {
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seen = await Promise.all(app.windows().map((page) => page.title().catch(() => "?")));
  throw new Error(`No page titled "${title}" within ${timeoutMs} ms. Open pages: ${JSON.stringify(seen)}`);
}

export const test = base.extend<AppFixtures>({
  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-e2e-"));
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  },

  // eslint-disable-next-line no-empty-pattern
  errors: async ({}, use) => {
    await use({ pageErrors: [], mainProcess: [] });
  },

  app: async ({ userDataDir, errors }, use, testInfo) => {
    const executablePath = findPackagedExecutable();
    await assertE2EBuild(executablePath);
    const { args, chromiumSandbox } = launchArgs();
    const app = await electron.launch({
      executablePath,
      args,
      chromiumSandbox,
      env: { ...process.env, CUE_DESK_USER_DATA_DIR: userDataDir },
    });

    const watchPage = (page: Page) => {
      page.on("pageerror", (error) => {
        errors.pageErrors.push({ page: page.url(), message: error.message });
      });
    };
    app.windows().forEach(watchPage);
    app.on("window", watchPage);

    const log: string[] = [];
    app.process().stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        log.push(line);
        if (MAIN_PROCESS_FAILURE.test(line)) {
          errors.mainProcess.push(line);
        }
      }
    });

    await use(app);

    await app.close().catch((): void => undefined);
    await testInfo.attach("main-process.log", { body: log.join("\n"), contentType: "text/plain" });
  },

  mainWindow: async ({ app }, use) => {
    // The hidden audio capture window ("Audio Capture") may open first.
    const page = await pageWithTitle(app, "Cue Desk");
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },

  playerView: async ({ app, mainWindow }, use) => {
    // The player view is created by the main window once it has rendered.
    void mainWindow;
    const page = await pageWithTitle(app, "Cue Desk Player");
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
});

export { expect };
