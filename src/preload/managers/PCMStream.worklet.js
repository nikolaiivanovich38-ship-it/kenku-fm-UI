/**
 * Runs on the capture window's audio thread. Cuts the mixed audio into the
 * 20 ms frames Opus encodes (960 samples per channel at 48 kHz, planar: all
 * left samples, then all right samples) and posts them to the capture window,
 * which encodes them with WebCodecs (PERF-4).
 *
 * PERF-4: a frame of pure digital silence is not posted, except the first one
 * after a sound, which lets the encoder finish the end of that sound. Discord
 * plays nothing during the gap, and the encoder has nothing to do.
 *
 * PERF-8: each frame is posted as soon as it is complete. (The old
 * "performance" mode filled a half-second buffer first, which delayed the
 * broadcast by that much.)
 *
 * Message: an array of `{ index, samples, last }`, where `index` counts 20 ms
 * frames since the broadcast started (skipped silence leaves a gap),
 * `samples` is a Float32Array of 1920 values whose buffer is transferred, and
 * `last` marks the silent frame that ends a sound (the encoder flushes then,
 * so the end of one sound is not heard at the start of the next).
 */

/** Samples per channel in one 20 ms frame at 48 kHz. */
const FRAME_LENGTH = 960;
const CHANNELS = 2;
/** Samples per channel in one render quantum (Web Audio's fixed block). */
const QUANTUM = 128;

class PCMStream extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.frame = new Float32Array(FRAME_LENGTH * CHANNELS);
    this.offset = 0;
    this.frameIndex = 0;
    this.frameHasSound = false;
    this.previousFrameHadSound = false;
  }

  process(inputs) {
    const input = inputs[0];
    const left = input && input.length > 0 ? input[0] : undefined;
    // A mono source (a microphone on its own) goes to both channels.
    const right = input && input.length > 1 ? input[1] : left;
    // With nothing connected the input is empty; count it as one quantum of
    // silence so frame numbers keep following the clock.
    const length = left ? left.length : QUANTUM;
    let read = 0;
    while (read < length) {
      const count = Math.min(length - read, FRAME_LENGTH - this.offset);
      if (left) {
        this.copy(left, right, read, count);
      } else {
        this.frame.fill(0, this.offset, this.offset + count);
        this.frame.fill(0, FRAME_LENGTH + this.offset, FRAME_LENGTH + this.offset + count);
      }
      this.offset += count;
      read += count;
      if (this.offset === FRAME_LENGTH) {
        this.finishFrame();
      }
    }
    return true;
  }

  /** Copy `count` samples of each channel into the frame, noting any sound. */
  copy(left, right, from, count) {
    const frame = this.frame;
    const leftStart = this.offset;
    const rightStart = FRAME_LENGTH + this.offset;
    let sound = this.frameHasSound;
    for (let i = 0; i < count; i++) {
      const l = left[from + i];
      const r = right[from + i];
      frame[leftStart + i] = l;
      frame[rightStart + i] = r;
      if (l !== 0 || r !== 0) {
        sound = true;
      }
    }
    this.frameHasSound = sound;
  }

  finishFrame() {
    if (this.frameHasSound || this.previousFrameHadSound) {
      const frame = { index: this.frameIndex, samples: this.frame, last: !this.frameHasSound };
      this.port.postMessage([frame], [frame.samples.buffer]);
      this.frame = new Float32Array(FRAME_LENGTH * CHANNELS);
    }
    this.previousFrameHadSound = this.frameHasSound;
    this.frameHasSound = false;
    this.offset = 0;
    this.frameIndex++;
  }
}

registerProcessor("pcm-stream", PCMStream);
