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
 *
 * w51-audio: a frame that arrives after the inlet ran dry, and follows on from
 * the last one (its index is the next), came late: a hole the players heard.
 * It posts `{ kind: "hole", wait }` and `{ kind: "dropped" }` as they happen;
 * `{ kind: "stats" }` asks for the counts: `{ kind: "stats", frames, holes,
 * dropped, wait }`. An array of frames (as the PCM worklet posts them) is
 * taken too.
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
    /** It ran out of frames since the last one arrived. */
    this.ranDry = false;
    this.lastIndex = -2;
    this.frames = 0;
    this.holes = 0;
    this.dropped = 0;
    this.port.onmessage = (event) => this.receive(event.data);
  }

  receive(data) {
    if (data && data.kind === "stats") {
      this.port.postMessage({ kind: "stats", frames: this.frames, holes: this.holes, dropped: this.dropped, wait: PRIME_FRAMES });
      return;
    }
    if (Array.isArray(data)) {
      for (const frame of data) {
        this.receive(frame);
      }
      return;
    }
    const samples = data && data.samples;
    if (!(samples instanceof Float32Array) || samples.length !== FRAME_LENGTH * CHANNELS) {
      return;
    }
    const index = Number.isInteger(data.index) ? data.index : -2;
    if (this.ranDry && index === this.lastIndex + 1) {
      this.holes++;
      this.port.postMessage({ kind: "hole", wait: PRIME_FRAMES });
    }
    this.ranDry = false;
    this.lastIndex = index;
    this.frames++;
    this.queue.push(samples);
    while (this.queue.length > MAX_WAITING_FRAMES) {
      this.queue.shift();
      this.offset = 0;
      this.dropped++;
      this.port.postMessage({ kind: "dropped" });
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
        // Ran dry: silence until enough frames wait again.
        this.playing = false;
        this.ranDry = true;
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
