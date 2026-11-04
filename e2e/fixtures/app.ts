/**
 * FND-4: shared fixture for end-to-end tests. Starts the packaged app with a
 * fresh, empty data folder, collects problems from every page and from the
 * main process, checks after each test that there were none, and closes the
 * app afterwards.
 *
 * Usage in a spec:
 *   import { test, expect } from "./fixtures/app";
 *   test("…", async ({ app, mainWindow, playerView, errors }) => { … });
 *
 * A test that needs to restart the app (persistence, data carry-over) uses
 * `launchApp` instead of `app`: each call starts another copy, which is
 * closed at the end of the test if the test has not closed it.
 */
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { assertE2EBuild, findPackagedExecutable, launchArgs } from "./packagedApp";
import { findProblems, type CollectedErrors } from "./problems";

export type { CollectedErrors } from "./problems";

export type LaunchOptions = {
  /**
   * Data folder passed as CUE_DESK_USER_DATA_DIR. Defaults to the test's
   * `userDataDir`; `null` starts the app without the variable, so it uses its
   * normal folder under `<appData>` (only safe together with XDG_CONFIG_HOME).
   */
  userDataDir?: string | null;
  /** Extra environment variables for this start. */
  env?: Record<string, string>;
};

export type LaunchedApp = {
  app: ElectronApplication;
  /** The main window (title "Lyre"). */
  mainWindow(): Promise<Page>;
  /** The player view: playlists and soundboards (title "Lyre Player"). */
  playerView(): Promise<Page>;
  /** Quit the app the way a user would, so it saves its data, and wait for it to exit. */
  close(): Promise<void>;
};

type AppFixtures = {
  /** Throw-away data folder (CUE_DESK_USER_DATA_DIR) for this test. */
  userDataDir: string;
  /** Problems seen while the app ran; checked automatically after each test. */
  errors: CollectedErrors;
  /** Start a copy of the app. */
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>;
  app: ElectronApplication;
  /** The main window (title "Lyre"). */
  mainWindow: Page;
  /** The player view: playlists and soundboards (title "Lyre Player"). */
  playerView: Page;
  /** Fails the test when `errors` holds anything (runs after the app has closed). */
  problemCheck: void;
};

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

/** Quit through Electron so the app shuts down normally and writes its data to disk. */
async function quitApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch((): void => undefined);
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 15_000)),
  ]);
  if (timedOut) {
    await app.close().catch((): void => undefined);
  }
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
    await use({ pageErrors: [], console: [], mainLog: [], ignoredConsole: [] });
  },

  problemCheck: [
    async ({ errors }, use, testInfo) => {
      await use();
      await testInfo.attach("main-process.log", { body: errors.mainLog.join("\n"), contentType: "text/plain" });
      if (errors.console.length > 0) {
        await testInfo.attach("console.log", {
          body: errors.console.map((entry) => `[${entry.type}] ${entry.page}: ${entry.text}`).join("\n"),
          contentType: "text/plain",
        });
      }
      // A test that already failed is not also blamed for the noise it caused.
      if (testInfo.status === testInfo.expectedStatus) {
        expect(findProblems(errors), "problems seen while the app ran").toEqual([]);
      }
    },
    { auto: true },
  ],

  launchApp: async ({ userDataDir, errors }, use) => {
    const executablePath = findPackagedExecutable();
    await assertE2EBuild(executablePath);
    const started: LaunchedApp[] = [];

    const launch = async ({ userDataDir: dataDir = userDataDir, env = {} }: LaunchOptions = {}) => {
      const { args, chromiumSandbox } = launchArgs();
      const baseEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key !== "CUE_DESK_USER_DATA_DIR") {
          baseEnv[key] = value;
        }
      }
      const app = await electron.launch({
        executablePath,
        args,
        chromiumSandbox,
        env: {
          ...baseEnv,
          ...(dataDir === null ? {} : { CUE_DESK_USER_DATA_DIR: dataDir }),
          ...env,
        },
      });

      const watchPage = (page: Page) => {
        page.on("pageerror", (error) => {
          errors.pageErrors.push({ page: page.url(), message: error.message });
        });
        page.on("console", (message) => {
          const type = message.type();
          if (type === "error" || type === "warning") {
            errors.console.push({ page: page.url(), type, text: message.text() });
          }
        });
      };
      app.windows().forEach(watchPage);
      app.on("window", watchPage);

      const collect = (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim() !== "") {
            errors.mainLog.push(line);
          }
        }
      };
      app.process().stderr?.on("data", collect);
      app.process().stdout?.on("data", collect);

      let closing: Promise<void> | undefined;
      const launched: LaunchedApp = {
        app,
        mainWindow: async () => {
          // The hidden audio capture window ("Audio Capture") may open first.
          const page = await pageWithTitle(app, "Lyre");
          await page.waitForLoadState("domcontentloaded");
          return page;
        },
        playerView: async () => {
          // The player view is created by the main window once it has rendered.
          const page = await pageWithTitle(app, "Lyre Player");
          await page.waitForLoadState("domcontentloaded");
          return page;
        },
        close: () => {
          closing ??= quitApp(app);
          return closing;
        },
      };
      started.push(launched);
      return launched;
    };

    await use(launch);

    for (const launched of started) {
      await launched.close();
    }
  },

  app: async ({ launchApp }, use) => {
    const launched = await launchApp();
    await use(launched.app);
  },

  mainWindow: async ({ app }, use) => {
    const page = await pageWithTitle(app, "Lyre");
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },

  playerView: async ({ app, mainWindow }, use) => {
    void mainWindow;
    const page = await pageWithTitle(app, "Lyre Player");
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
});

export { expect };
