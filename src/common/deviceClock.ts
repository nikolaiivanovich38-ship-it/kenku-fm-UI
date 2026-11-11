/**
 * w51-audio: keeps an audio context on the sound card's clock.
 *
 * Chromium moves an audio context whose output has been exact silence for 30 seconds off the sound card and onto a
 * timer, to save power (SilentSinkSuspender), and a context made without a sound device (`sinkId: { type: "none" }`)
 * always runs on one (NullAudioSink). Lyre's contexts send their sound elsewhere (to the capture window, to the Opus
 * encoder), so their own output is always silent and they all ended up on timers. When such a timer wakes late by
 * more than one buffer, Chromium skips the buffers it missed instead of catching up, and on Windows timers wake late
 * often (15.6 ms steps unless a program asks for finer ones). The frames then come unevenly and too few, and Discord
 * and the headphones hear holes. Kenku FM's capture window met the same thing ("playback" latency "fixes audio
 * glitches on some Windows 11 machines": bigger buffers make skipping rarer, not impossible).
 *
 * While held, a constant far below hearing goes to the speakers, so the output is never exact silence and the context
 * stays on the sound card. Nothing is heard: the level is under the last bit of 24-bit sound, and Chromium's own
 * "playing sound" check (about -72 dB) does not notice it.
 */

/** 2^-24, about -144 dB: not zero, so not silence to Chromium; nothing a sound card can play. */
export const DEVICE_CLOCK_LEVEL = 2 ** -24;

/** The parts of an AudioContext the keeper uses. */
export type ClockContext = Pick<BaseAudioContext, "destination" | "createConstantSource">;

export interface DeviceClock {
  /** Keep the context on the sound card (every hold needs a release). */
  hold(): void;
  release(): void;
}

export function keepDeviceClock(context: ClockContext): DeviceClock {
  let holders = 0;
  let source: ConstantSourceNode | null = null;
  return {
    hold() {
      holders++;
      if (source) return;
      try {
        source = context.createConstantSource();
        source.offset.value = DEVICE_CLOCK_LEVEL;
        source.connect(context.destination);
        source.start();
      } catch {
        // A closed context: nothing to keep.
        source = null;
      }
    },
    release() {
      holders = Math.max(0, holders - 1);
      if (holders > 0 || !source) return;
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Already stopped with its context.
      }
      source = null;
    },
  };
}
