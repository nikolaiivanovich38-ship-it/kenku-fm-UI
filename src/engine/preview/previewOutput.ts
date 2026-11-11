/**
 * PRV-1: where preview sound goes. Only the game master hears it, so it must
 * never reach the mix Discord records.
 *
 * The player page is recorded for Discord as a whole (tab capture), so the
 * preview player depends on this small interface instead of on the engine's
 * graph. Whoever provides it guarantees `input` leads only to the game
 * master's own sound device:
 *
 * - in the player page: `createBrowserBridgedPreview` (rooms/browserBridge.ts).
 *   Its audio context has no sound device, so the page never sounds the
 *   preview and tab capture cannot record it; its frames go over the private
 *   player channel to the capture window, which plays them in an audio
 *   context of its own on the chosen device (PRV-2). That window is never
 *   recorded, and its preview context is not the broadcast's, so no room mix
 *   can reach it (e2e/rooms.spec.ts).
 * - `createPreviewContextOutput` below plays directly on the device. Never use
 *   it in the player page: the player page is recorded for Discord as a whole.
 *
 * Tests use testing/fakePreviewOutput.ts: a separate fake context, which
 * cannot be connected to the player page's nodes at all.
 */
import { EngineContext, fromAudioContext, GainLike, NodeLike } from "../audio/types";

export interface PreviewOutput {
  /** The context preview voices are made in. */
  readonly context: EngineContext;
  /** Where preview voices connect. Leads only to the game master's own device. */
  readonly input: NodeLike;
}

/** A preview output with an audio context of its own, playing on a chosen device (PRV-2). */
export interface PreviewContextOutput extends PreviewOutput {
  readonly audioContext: AudioContext;
  /** Play on another output device ("" is the default device). See outputDevices.ts. */
  setSinkId(deviceId: string): Promise<void>;
  close(): Promise<void>;
}

/** AudioContext.setSinkId (Chromium 110+); not yet in TypeScript's DOM types. */
type SinkableContext = AudioContext & { setSinkId?: (deviceId: string) => Promise<void> };

/**
 * An audio context of its own for the preview. Its sound is recorded for
 * Discord if it runs in the player page; create it only in a page that is not
 * captured (see the note above).
 */
export function createPreviewContextOutput(audioContext: AudioContext = new AudioContext({ latencyHint: "interactive" })): PreviewContextOutput {
  const context = fromAudioContext(audioContext);
  const input = context.createGain() as GainLike;
  input.connect(audioContext.destination as unknown as NodeLike);
  return {
    audioContext,
    context,
    input,
    setSinkId: async (deviceId) => {
      const sinkable = audioContext as SinkableContext;
      if (!sinkable.setSinkId) {
        throw new Error("This version of Lyre cannot choose a sound device for the preview.");
      }
      await sinkable.setSinkId(deviceId);
    },
    close: async () => {
      input.disconnect();
      await audioContext.close();
    },
  };
}
