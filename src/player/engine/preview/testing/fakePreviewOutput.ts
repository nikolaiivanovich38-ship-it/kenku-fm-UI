/**
 * A preview output for tests: a fake audio context of its own (the game
 * master's headphones), whose nodes cannot be connected to the player page's
 * graph, just as two real audio contexts cannot be.
 */
import { FakeAudioContext, FakeGain } from "../../testing/fakeAudio";
import type { PreviewOutput } from "../previewOutput";

export function fakePreviewOutput(context: FakeAudioContext = new FakeAudioContext()): PreviewOutput & {
  context: FakeAudioContext;
  input: FakeGain;
} {
  const input = context.createGain();
  input.connect(context.destination);
  return { context, input };
}
