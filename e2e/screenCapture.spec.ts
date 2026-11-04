/**
 * SEC-16: the app's own windows (the main window and the hidden capture
 * window) may use audio devices but cannot record the screen. Chromium asks
 * for screen capture with an empty media-type list, which the permission
 * handler now refuses for app pages.
 */
import { test, expect, pageWithTitle } from "./fixtures/app";

test("the main window and the capture window cannot record the screen", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  const capture = await pageWithTitle(app, "Audio Capture");
  for (const page of [mainWindow, capture]) {
    const result = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: "desktop" } },
        } as MediaStreamConstraints);
        stream.getTracks().forEach((track) => track.stop());
        return "granted";
      } catch (error) {
        return (error as Error).name;
      }
    });
    expect(result).toBe("NotAllowedError");
  }
});
