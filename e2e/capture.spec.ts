/**
 * FND-4: tab audio capture, the way Discord broadcasting gets the player's
 * sound. The main process asks for a media source id for the player view and
 * the hidden capture window opens it with getUserMedia (legacy
 * `chromeMediaSource: "tab"` constraint, as AudioCaptureManagerPreload does).
 *
 * SEC-3: Chromium asks the captured page for permission. The app allows it
 * only for pages it chose to capture (src/main/security/captureTargets.ts);
 * the player view is one as soon as it has loaded.
 */
import http from "http";
import type { AddressInfo } from "net";
import type { Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";

test("the capture window can open the player view's audio", async ({ app, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  const capture = await pageWithTitle(app, "Audio Capture");
  const sourceId = await app.evaluate(({ webContents }) => {
    const all = webContents.getAllWebContents();
    const player = all.find((contents) => contents.getTitle() === "Cue Desk Player");
    const captureWindow = all.find((contents) => contents.getTitle() === "Audio Capture");
    if (!player || !captureWindow) {
      throw new Error("player view or capture window not found");
    }
    return player.getMediaSourceId(captureWindow);
  });

  const result = await capture.evaluate(async (id) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: id } },
        video: false,
      } as MediaStreamConstraints);
      return stream.getAudioTracks().map((track) => track.readyState).join(",");
    } catch (error) {
      return `${(error as Error).name}: ${(error as Error).message}`;
    }
  }, sourceId);

  expect(result).toBe("live");
});

/** A local web page standing in for YouTube or Tabletop Audio. */
async function withLocalSite(run: (url: string) => Promise<void>): Promise<void> {
  const site = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<title>Local test site</title><p>Test page</p>");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(site.address() as AddressInfo).port}/`);
  } finally {
    site.close();
  }
}

/** Open a website tab the way the "+" button does; returns its view id. */
function openTab(mainWindow: Page, url: string): Promise<number> {
  return mainWindow.evaluate(
    (address) =>
      (window as unknown as { kenku: { createBrowserView(...args: unknown[]): Promise<number> } })
        .kenku.createBrowserView(address, 0, 0, 400, 300),
    url,
  );
}

test("the app captures a website tab's audio as soon as the tab loads", async ({ app, mainWindow, playerView }) => {
  await withLocalSite(async (url) => {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    const capture = await pageWithTitle(app, "Audio Capture");
    const captureLog: { type: string; text: string }[] = [];
    capture.on("console", (message) => captureLog.push({ type: message.type(), text: message.text() }));

    // Once the page has loaded, the main window asks for its audio.
    const viewId = await openTab(mainWindow, url);
    await pageWithTitle(app, "Local test site");
    await expect
      .poll(() => captureLog.map((entry) => entry.text), { timeout: 10_000 })
      .toContain(`Capturing audio of view ${viewId}`);

    expect(captureLog.filter((entry) => entry.type === "error")).toEqual([]);
  });
});

test("a website in a tab cannot record the screen or desktop audio (WP1 review)", async ({ app, mainWindow, playerView }) => {
  await withLocalSite(async (url) => {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    await openTab(mainWindow, url);
    const site = await pageWithTitle(app, "Local test site");

    // The tab is being captured for Discord, which must not give the site
    // any capture rights of its own.
    const attempts = await site.evaluate(async () => {
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
});
