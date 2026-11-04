/**
 * SEC-15: files from the user's computer open in a tab only after the main
 * process has asked ("Open this file from your computer?"), in a partition of
 * their own; remembered folders are listed in Settings > Local files; web
 * pages can never open a file.
 *
 * The question is a native dialog, which Playwright cannot click, so each test
 * replaces `dialog.showMessageBox` in the main process with a stand-in that
 * records the question and gives the answer the test chose.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite } from "./fixtures/localSite";

type Answer = { response: number; checkboxChecked: boolean };

/** Answer every "Open this file?" question with `answer`; returns the questions asked so far. */
async function answerFileQuestions(app: ElectronApplication, answer: Answer) {
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

/** A folder with small HTML files, standing in for a GM's maps folder. */
function makeFiles(): { folder: string; url(name: string): string; cleanup(): void } {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-files-")));
  for (const name of ["map", "notes", "music"]) {
    fs.writeFileSync(path.join(folder, `${name}.html`), `<!doctype html><title>Local ${name}</title><p>${name}`);
  }
  return {
    folder,
    url: (name) => pathToFileURL(path.join(folder, `${name}.html`)).href,
    cleanup: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
}

let files: ReturnType<typeof makeFiles>;
test.beforeEach(() => {
  files = makeFiles();
});
test.afterEach(() => {
  files.cleanup();
});

function tab(mainWindow: Page, title: string) {
  return mainWindow.locator("#controls").getByRole("listitem").filter({ hasText: title });
}

async function typeAddress(mainWindow: Page, address: string) {
  const field = mainWindow.getByLabel("Web address");
  await field.fill(address);
  await field.press("Enter");
}

/** The session partition of the page showing `url`: "local-files", "tabs" or "other". */
function partitionOf(app: ElectronApplication, url: string): Promise<string> {
  return app.evaluate(({ session, webContents }, address) => {
    const contents = webContents.getAllWebContents().find((c) => c.getURL() === address);
    if (!contents) return "not open";
    if (contents.session === session.fromPartition("persist:local-files")) return "local-files";
    if (contents.session === session.fromPartition("persist:tabs")) return "tabs";
    return "other";
  }, url);
}

function openAddresses(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().map((c) => c.getURL()));
}

test("a file typed in the address bar opens after the user agrees, in a tab of its own", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 0, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  await typeAddress(mainWindow, files.url("map"));

  await pageWithTitle(app, "Local map");
  await expect(tab(mainWindow, "Local map")).toBeVisible();
  const asked = await questionsAsked(app);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Open this file from your computer?");
  expect(asked[0]).toContain(path.join(files.folder, "map.html"));
  expect(await partitionOf(app, files.url("map"))).toBe("local-files");
  // The file's tab took the place of the empty tab.
  await expect(tab(mainWindow, "New Tab")).toHaveCount(0);
});

test("nothing opens when the user says no", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 1, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  await typeAddress(mainWindow, files.url("map"));

  await expect.poll(() => questionsAsked(app)).toHaveLength(1);
  await mainWindow.waitForTimeout(500);
  expect(await openAddresses(app)).not.toContain(files.url("map"));
  await expect(tab(mainWindow, "New Tab")).toBeVisible();
  await expect(mainWindow.getByRole("alert")).toHaveCount(0);
});

test("a remembered folder opens without asking, is listed in Settings and can be forgotten", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 0, checkboxChecked: true });
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  await typeAddress(mainWindow, files.url("map"));
  await expect(tab(mainWindow, "Local map")).toBeVisible();

  // Bookmark the file, then open it again from the bookmark: no question.
  await tab(mainWindow, "Local map").getByRole("button", { name: "bookmark" }).click();
  await tab(mainWindow, "Local map").getByRole("button", { name: "close" }).click();
  await mainWindow.getByRole("navigation").getByText("Local map").click();
  await expect(tab(mainWindow, "Local map")).toBeVisible();
  expect(await questionsAsked(app)).toHaveLength(1);

  // Settings lists the folder; forgetting it brings the question back.
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  const list = settings.getByRole("list", { name: "Folders opened without asking" });
  await expect(list).toContainText(files.folder);
  await settings.getByRole("button", { name: `Ask again before opening files in ${files.folder}` }).click();
  await expect(list).toHaveCount(0);
  await settings.getByRole("button", { name: "Done" }).click();

  await answerFileQuestions(app, { response: 1, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  await typeAddress(mainWindow, files.url("notes"));
  await expect.poll(() => questionsAsked(app)).toHaveLength(2);
  expect(await openAddresses(app)).not.toContain(files.url("notes"));
});

test("a web page can never open, redirect to, pop up or link to a file", async ({
  app,
  mainWindow,
  playerView,
  errors,
}) => {
  // Chromium refuses the link and the jump itself and says so in the page's console.
  errors.ignoredConsole.push(/^Not allowed to load local resource: file:/);
  const target = files.url("notes");
  const site = await startLocalSite({
    "/links": {
      title: "Sneaky page",
      body: `<a id="link" href="${target}">notes</a>
        <button id="popup" onclick="window.open('${target}')">popup</button>
        <button id="jump" onclick="location.href='${target}'">jump</button>`,
    },
  });
  try {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    await answerFileQuestions(app, { response: 0, checkboxChecked: true });
    await mainWindow.getByRole("button", { name: "add tab" }).click();
    await typeAddress(mainWindow, site.url("/links"));
    const page = await pageWithTitle(app, "Sneaky page");
    await mainWindow.waitForTimeout(1_500);

    await page.click("#link");
    await page.click("#popup");
    await page.click("#jump");
    await mainWindow.waitForTimeout(1_000);

    expect(await openAddresses(app)).not.toContain(target);
    expect(await questionsAsked(app)).toEqual([]);
    expect(page.url()).toBe(site.url("/links"));
  } finally {
    await site.close();
  }
});
