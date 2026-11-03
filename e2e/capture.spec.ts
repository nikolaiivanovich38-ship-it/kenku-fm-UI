/**
 * FND-4: tab audio capture, the way Discord broadcasting gets the player's
 * sound. The main process asks for a media source id for the player view and
 * the hidden capture window opens it with getUserMedia (legacy
 * `chromeMediaSource: "tab"` constraint, as AudioCaptureManagerPreload does).
 */
import { test, expect, pageWithTitle } from "./fixtures/app";

test("the capture window can open the player view's audio", async ({ app, playerView }) => {
  // Known bug (found in WP1): the SEC-3 permission handler refuses this
  // request, because Electron raises it on the captured page (here the player
  // view) with no media types. Remove this line once the handler allows it.
  test.fail(true, "SEC-3 permission handler blocks tab capture (see WP1 W1 report)");

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
