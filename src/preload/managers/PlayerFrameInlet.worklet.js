/**
 * Runs on the capture window's audio thread (OUT-5). Plays the 20 ms frames
 * of one engine room that the player page sends over the private player
 * channel (see AudioCaptureManagerPreload), so they join that room's mix with
 * the tabs routed there.
 *
 * Message: `{ index, samples }`, `samples` a Float32Array of 1920 values,
 * planar (960 left, then 960 right), as the PCM worklet in the player page
 * posts them. Anything else is ignored.
 *
 * The two pages' audio clocks are not locked together, and messages arrive
 * a little unevenly, so playing starts once two frames (40 ms) are waiting;
 * when the frames stop (silence is not sent) it plays silence and waits for
 * two again. At most ten frames (200 ms) wait: beyond that the oldest are
 * dropped, so the delay can never grow.
 */

const FRAME_LENGTH = 960;
const CHANNELS = 2;
const PRIME_FRAMES = 2;
const MAX_WAITING_FRAMES = 10;

class PlayerFrameInlet extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.queue = [];
    this.offset = 0;
    this.playing = false;
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(data) {
    const samples = data && data.samples;
    if (!(samples instanceof Float32Array) || samples.length !== FRAME_LENGTH * CHANNELS) {
      return;
    }
    this.queue.push(samples);
    while (this.queue.length > MAX_WAITING_FRAMES) {
      this.queue.shift();
      this.offset = 0;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output.length > 1 ? output[1] : undefined;
    if (!this.playing && this.queue.length >= PRIME_FRAMES) {
      this.playing = true;
    }
    let written = 0;
    while (this.playing && written < left.length) {
      const frame = this.queue[0];
      if (!frame) {
        // Ran dry: silence until two frames wait again.
        this.playing = false;
        break;
      }
      const count = Math.min(left.length - written, FRAME_LENGTH - this.offset);
      left.set(frame.subarray(this.offset, this.offset + count), written);
      if (right) {
        right.set(frame.subarray(FRAME_LENGTH + this.offset, FRAME_LENGTH + this.offset + count), written);
      }
      written += count;
      this.offset += count;
      if (this.offset === FRAME_LENGTH) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    left.fill(0, written);
    if (right) {
      right.fill(0, written);
    }
    return true;
  }
}

registerProcessor("player-frame-inlet", PlayerFrameInlet);
