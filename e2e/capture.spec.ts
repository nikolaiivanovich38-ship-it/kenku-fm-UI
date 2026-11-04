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

test("the app captures a website tab's audio as soon as the tab loads", async ({ app, mainWindow, playerView }) => {
  // A local web page stands in for YouTube or Tabletop Audio.
  const site = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<title>Local test site</title><p>Test page</p>");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;

  try {
    await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
    const capture = await pageWithTitle(app, "Audio Capture");
    const captureErrors: string[] = [];
    capture.on("console", (message) => {
      if (message.type() === "error") {
        captureErrors.push(message.text());
      }
    });

    // The same call the "+" tab button makes; once the page has loaded, the
    // main window asks for its audio.
    await mainWindow.evaluate(
      (address) =>
        (window as unknown as { kenku: { createBrowserView(...args: unknown[]): Promise<number> } })
          .kenku.createBrowserView(address, 0, 0, 400, 300),
      url,
    );
    await pageWithTitle(app, "Local test site");
    await capture.waitForTimeout(2_000);

    expect(captureErrors).toEqual([]);
  } finally {
    site.close();
  }
});
