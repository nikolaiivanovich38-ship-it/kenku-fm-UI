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
import { FAKE_DISCORD_ENV, TONE_PAGE, channelButton, connectFakeBot } from "./fixtures/discord";

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

/** The session partition of the page titled `title`: "local-files", "tabs" or "other". */
function partitionOf(app: ElectronApplication, title: string): Promise<string> {
  return app.evaluate(({ session, webContents }, pageTitle) => {
    const contents = webContents.getAllWebContents().find((c) => c.getTitle() === pageTitle);
    if (!contents) return "not open";
    if (contents.session === session.fromPartition("persist:local-files")) return "local-files";
    if (contents.session === session.fromPartition("persist:tabs")) return "tabs";
    return "other";
  }, title);
}

/** How many pages are open in the local-files partition (whatever their address looks like). */
function openFileTabs(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ session, webContents }) =>
      webContents.getAllWebContents().filter((c) => c.session === session.fromPartition("persist:local-files")).length,
  );
}

/** The address the page titled `title` was actually loaded from. */
function loadedAddress(app: ElectronApplication, title: string): Promise<string | undefined> {
  return app.evaluate(
    ({ webContents }, pageTitle) => webContents.getAllWebContents().find((c) => c.getTitle() === pageTitle)?.getURL(),
    title,
  );
}

test("a file typed in the address bar opens after the user agrees, in a tab of its own", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 0, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await typeAddress(mainWindow, files.url("map"));

  await pageWithTitle(app, "Local map");
  await expect(tab(mainWindow, "Local map")).toBeVisible();
  const asked = await questionsAsked(app);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("Open this file from your computer?");
  expect(asked[0]).toContain(path.join(files.folder, "map.html"));
  expect(await partitionOf(app, "Local map")).toBe("local-files");
  // The file's tab took the place of the empty tab, and the address bar shows the file's address.
  await expect(tab(mainWindow, "New Tab")).toHaveCount(0);
  await expect(mainWindow.getByLabel("Web address")).toHaveValue(files.url("map"));
});

test("nothing opens when the user says no", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 1, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await typeAddress(mainWindow, files.url("map"));

  await expect.poll(() => questionsAsked(app)).toHaveLength(1);
  await mainWindow.waitForTimeout(500);
  expect(await openFileTabs(app)).toBe(0);
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
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
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
  const fileTabsBefore = await openFileTabs(app);
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await typeAddress(mainWindow, files.url("notes"));
  await expect.poll(() => questionsAsked(app)).toHaveLength(2);
  await mainWindow.waitForTimeout(500);
  expect(await openFileTabs(app)).toBe(fileTabsBefore);
});


test("a web page can never open, redirect to, pop up or link to a file (WP1 review 12)", async ({
  app,
  mainWindow,
  playerView,
  errors,
}) => {
  // Chromium itself refuses a web page's link, new-window link and jump to a
  // file:, and a server-side redirect to one (ERR_UNSAFE_REDIRECT), before
  // any of the app's code runs, and says so in the page's console.
  errors.ignoredConsole.push(/^Not allowed to load local resource: /);
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await answerFileQuestions(app, { response: 0, checkboxChecked: false });

  // A file the user opened: its tab's own address is what a page would need
  // to reach it, so the page is given that address too.
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await typeAddress(mainWindow, files.url("notes"));
  await pageWithTitle(app, "Local notes");
  const fileAddress = await loadedAddress(app, "Local notes");
  expect(fileAddress).toBeDefined();
  const target = files.url("map");

  const site = await startLocalSite({
    "/links": {
      title: "Sneaky page",
      body: `<a id="link" href="${target}">map</a>
        <a id="blank" target="_blank" href="${target}">map in a new window</a>
        <a id="opened" href="${fileAddress}">the open file</a>
        <a id="opened-blank" target="_blank" href="${fileAddress}">the open file in a new window</a>
        <a id="redirect-file" href="/redirect-file">redirect to a file</a>
        <a id="redirect-opened" href="/redirect-opened">redirect to the open file</a>
        <button id="popup" onclick="window.open('${target}')">popup</button>
        <button id="jump" onclick="location.href='${target}'">jump</button>`,
    },
    "/redirect-file": { redirect: target },
    "/redirect-opened": { redirect: fileAddress! },
  });
  try {
    await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
    await typeAddress(mainWindow, site.url("/links"));
    const page = await pageWithTitle(app, "Sneaky page");
    await mainWindow.waitForTimeout(1_000);

    for (const id of ["#link", "#blank", "#opened", "#opened-blank", "#popup", "#jump", "#redirect-file", "#redirect-opened"]) {
      if (!page.url().endsWith("/links")) {
        await page.goto(site.url("/links"));
      }
      // Clicked from the page itself: Playwright's click would wait for a
      // navigation the app cancels.
      await page.evaluate((selector) => document.querySelector<HTMLElement>(selector)!.click(), id);
      await mainWindow.waitForTimeout(700);
    }

    // Nothing new opened in a file's tab, nobody was asked, and the website tab never showed a file.
    expect(await openFileTabs(app)).toBe(1);
    expect(await questionsAsked(app)).toHaveLength(1);
    expect(site.hits.get("/redirect-file")).toBe(1);
    expect(site.hits.get("/redirect-opened")).toBe(1);
    const addresses = await app.evaluate(({ session, webContents }) =>
      webContents
        .getAllWebContents()
        .filter((c) => c.session === session.fromPartition("persist:tabs"))
        .map((c) => c.getURL()),
    );
    expect(addresses.filter((address) => !address.startsWith("http"))).toEqual([]);
    // The links and the redirect to the open file's own address reached the
    // app's navigation guard, which refused them (Chromium lets them through).
    expect(errors.mainLog.filter((line) => /Blocked tab navigation/.test(line)).length).toBeGreaterThanOrEqual(2);
    expect(errors.mainLog.filter((line) => /Blocked popup from tab/.test(line)).length).toBeGreaterThanOrEqual(1);
  } finally {
    await site.close();
  }
});

/**
 * A folder with a page that tries to read files, inside and outside its own
 * folder, standing in for a downloaded handout that misbehaves.
 */
function makeProbeFolder(): { base: string; folder: string; cleanup(): void } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cue-desk-probe-")));
  const folder = path.join(base, "handout");
  fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
  fs.writeFileSync(path.join(base, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(folder, "probe.html"), "<!doctype html><title>Probe</title><p>Probe");
  fs.writeFileSync(path.join(folder, "sibling.txt"), "sibling text");
  fs.writeFileSync(path.join(folder, "sibling.html"), "<!doctype html><title>Sibling</title><p>sibling page");
  fs.writeFileSync(path.join(folder, "sub", "deep.txt"), "deep text");
  // A link inside the folder that leads outside it.
  fs.symlinkSync(path.join(base, "secret.txt"), path.join(folder, "escape.txt"));
  return { base, folder, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("a file reads files in its own folder only, and cannot reach the web (WP1 review 1)", async ({
  app,
  mainWindow,
  playerView,
  errors,
}) => {
  // The refusals below are the point of the test; they happen only in the file's own page.
  errors.expectedRefusals.push({
    page: /^(cue-local-file|file):/,
    text: /Content Security Policy|Refused to|Failed to load resource|Not allowed to load local resource/,
  });
  const probe = makeProbeFolder();
  const site = await startLocalSite({
    "/data": { title: "Data", body: "web data" },
    "/frame": { title: "Framed", body: "framed" },
    "/moved": { title: "Moved", body: "moved" },
  });
  try {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    await answerFileQuestions(app, { response: 0, checkboxChecked: false });
    await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
    await typeAddress(mainWindow, pathToFileURL(path.join(probe.folder, "probe.html")).href);
    const page = await pageWithTitle(app, "Probe");

    const results = await page.evaluate(
      async ({ secretFile, webData, webFrame, webMoved }) => {
        const read = (address: string) =>
          new Promise<string>((resolve) => {
            const request = new XMLHttpRequest();
            try {
              request.open("GET", address);
              // A file: read reports status 0 with the text; a refusal has no text.
              request.onload = () =>
                resolve(request.status === 200 || (request.status === 0 && request.responseText) ? request.responseText : `refused ${request.status}`);
              request.onerror = () => resolve("refused");
              request.send();
            } catch (error) {
              resolve(`refused ${(error as Error).name}`);
            }
          });
        const frame = (address: string) =>
          new Promise<HTMLIFrameElement>((resolve) => {
            const element = document.createElement("iframe");
            element.src = address;
            element.onload = () => resolve(element);
            setTimeout(() => resolve(element), 2_000);
            document.body.append(element);
          });
        const frameText = (element: HTMLIFrameElement) => {
          try {
            return element.contentDocument?.body?.innerText ?? "no document";
          } catch {
            return "no access";
          }
        };
        const web = await fetch(webData).then(
          (response) => response.text(),
          () => "refused",
        );
        const sibling = await frame("sibling.html");
        const siblingFrame = frameText(sibling);
        sibling.contentWindow!.location.href = webMoved;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return {
          sibling: await read("sibling.txt"),
          subfolder: await read("sub/deep.txt"),
          parent: await read("../secret.txt"),
          encodedParent: await read("%2e%2e/secret.txt"),
          fileAddress: await read(secretFile),
          symlink: await read("escape.txt"),
          web,
          siblingFrame,
          fileFrame: frameText(await frame(secretFile)),
          webFrame: frameText(await frame(webFrame)),
        };
      },
      {
        secretFile: pathToFileURL(path.join(probe.base, "secret.txt")).href,
        webData: site.url("/data"),
        webFrame: site.url("/frame"),
        webMoved: site.url("/moved"),
      },
    );

    expect(results.sibling).toBe("sibling text");
    expect(results.subfolder).toBe("deep text");
    expect(results.siblingFrame).toContain("sibling page");
    for (const outside of ["parent", "encodedParent", "fileAddress", "symlink", "web"] as const) {
      expect(results[outside], outside).toMatch(/^refused/);
    }
    expect(results.fileFrame).not.toContain("TOP SECRET");
    expect(results.webFrame).not.toContain("framed");
    // The web site never heard from the file's page.
    expect([...site.hits.keys()].filter((key) => key !== "/favicon.ico")).toEqual([]);
  } finally {
    await site.close();
    probe.cleanup();
  }
});

test("a captured file tab cannot record the screen (WP1 review 2)", async ({ launchApp }) => {
  fs.writeFileSync(path.join(files.folder, "tone.html"), `<!doctype html><title>Tone</title>${TONE_PAGE.body}`);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  const playerView = await launched.playerView();
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  const capture = await pageWithTitle(app, "Audio Capture");
  const captureLog: string[] = [];
  capture.on("console", (message) => captureLog.push(message.text()));

  await answerFileQuestions(app, { response: 0, checkboxChecked: false });
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  await typeAddress(mainWindow, pathToFileURL(path.join(files.folder, "tone.html")).href);
  const tone = await pageWithTitle(app, "Tone");
  const viewId = await app.evaluate(
    ({ webContents }) => webContents.getAllWebContents().find((c) => c.getTitle() === "Tone")?.id,
  );

  // During a broadcast, the playing file is captured for Discord…
  await connectFakeBot(mainWindow);
  await channelButton(mainWindow, "Tavern").click();
  await tone.evaluate(() => (window as unknown as { playTone(): void }).playTone());
  await expect.poll(() => captureLog, { timeout: 10_000 }).toContain(`Capturing audio of view ${viewId}`);

  // …which gives the file no capture rights of its own.
  const attempts = await tone.evaluate(async () => {
    const tryCapture = async (constraints: unknown) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
        stream.getTracks().forEach((track) => track.stop());
        return "granted";
      } catch (error) {
        return (error as Error).name;
      }
    };
    return {
      screen: await tryCapture({ audio: false, video: { mandatory: { chromeMediaSource: "desktop" } } }),
      desktopAudio: await tryCapture({
        audio: { mandatory: { chromeMediaSource: "desktop" } },
        video: { mandatory: { chromeMediaSource: "desktop" } },
      }),
    };
  });
  expect(attempts).toEqual({ screen: "NotAllowedError", desktopAudio: "NotAllowedError" });
});
