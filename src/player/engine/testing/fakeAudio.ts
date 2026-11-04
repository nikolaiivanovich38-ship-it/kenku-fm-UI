/**
 * A fake Web Audio context, media element and clock for engine tests.
 *
 * - Nodes and connections are recorded, so a test can count the nodes still
 *   wired into the graph (leaks, BUG-4) and ask whether one node reaches
 *   another (routing: preview never reaches the table mix).
 * - Gains follow their automation (set and linear ramps), and `signalAt`
 *   multiplies gains along every path from the sources that are sounding, so a
 *   test can "listen" to any node, e.g. an output, at the current time.
 * - One clock drives the context time, media element playback and the
 *   scheduler's timers, so `advance(seconds)` plays a session forward.
 */
import type {
  BufferLike,
  BufferSourceLike,
  EngineContext,
  GainLike,
  MediaElementLike,
  NodeLike,
  ParamLike,
  Scheduler,
} from "../audio/types";

type AutomationEvent = { kind: "set" | "ramp"; time: number; value: number };

export class FakeParam implements ParamLike {
  events: AutomationEvent[] = [];

  constructor(
    private readonly clock: FakeClock,
    private readonly initial: number,
  ) {}

  get value(): number {
    return this.valueAt(this.clock.now);
  }

  valueAt(time: number): number {
    let previous: { time: number; value: number } = { time: 0, value: this.initial };
    for (const event of this.events) {
      if (event.time <= time) {
        previous = event;
        continue;
      }
      if (event.kind === "ramp") {
        const span = event.time - previous.time;
        const progress = span <= 0 ? 1 : (time - previous.time) / span;
        return previous.value + (event.value - previous.value) * progress;
      }
      break;
    }
    return previous.value;
  }

  setValueAtTime(value: number, time: number) {
    this.insert({ kind: "set", time, value });
  }

  linearRampToValueAtTime(value: number, time: number) {
    this.insert({ kind: "ramp", time, value });
  }

  cancelScheduledValues(time: number) {
    this.events = this.events.filter((event) => event.time < time);
  }

  private insert(event: AutomationEvent) {
    // Events at the same time keep the order they were added in, as in Web Audio.
    const index = this.events.findIndex((e) => e.time > event.time);
    if (index === -1) {
      this.events.push(event);
    } else {
      this.events.splice(index, 0, event);
    }
  }
}

export class FakeNode implements NodeLike {
  readonly outputs = new Set<FakeNode>();

  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.allNodes.push(this);
  }

  connect(destination: NodeLike): FakeNode {
    if (!(destination instanceof FakeNode)) {
      throw new Error("FakeNode can only connect to another FakeNode");
    }
    if (destination.context !== this.context) {
      throw new Error("Cannot connect nodes from different audio contexts");
    }
    this.outputs.add(destination);
    return destination;
  }

  disconnect(destination?: NodeLike) {
    if (destination === undefined) {
      this.outputs.clear();
    } else if (!this.outputs.delete(destination as FakeNode)) {
      // Web Audio throws InvalidAccessError for a connection that does not exist.
      throw new Error("InvalidAccessError: not connected to that node");
    }
  }

  /** Signal this node produces by itself (sources only). */
  ownSignal(): number {
    return 0;
  }

  /** How much this node scales what flows through it. */
  scale(): number {
    return 1;
  }
}

export class FakeGain extends FakeNode implements GainLike {
  readonly gain: FakeParam;

  constructor(context: FakeAudioContext) {
    super(context, "gain");
    this.gain = new FakeParam(context.clock, 1);
  }

  scale() {
    return this.gain.value;
  }
}

export class FakeBuffer implements BufferLike {
  readonly length: number;

  constructor(
    readonly duration: number,
    readonly numberOfChannels = 2,
    readonly sampleRate = 48_000,
  ) {
    this.length = Math.round(duration * sampleRate);
  }
}

export class FakeBufferSource extends FakeNode implements BufferSourceLike {
  buffer: FakeBuffer | null = null;
  private looping = false;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  offset = 0;
  stopAt: number | null = null;
  ended = false;

  constructor(context: FakeAudioContext) {
    super(context, "bufferSource");
  }

  get loop() {
    return this.looping;
  }

  /** Switching a loop off lets the current pass play to the end of the buffer, as in Web Audio. */
  set loop(loop: boolean) {
    if (this.looping && !loop && this.startedAt !== null && this.buffer) {
      const now = this.context.currentTime;
      this.offset = (this.offset + Math.max(0, now - this.startedAt)) % this.buffer.duration;
      this.startedAt = Math.max(now, this.startedAt);
    }
    this.looping = loop;
  }

  start(when = 0, offset = 0) {
    if (this.startedAt !== null) {
      throw new Error("InvalidStateError: start() called twice");
    }
    this.startedAt = Math.max(when, this.context.currentTime);
    this.offset = offset;
  }

  stop(when = 0) {
    if (this.startedAt === null) {
      throw new Error("InvalidStateError: stop() before start()");
    }
    this.stopAt = Math.max(when, this.context.currentTime);
    this.context.settleSources();
  }

  /** Context time at which this source stops making sound. */
  endTime(): number {
    if (this.startedAt === null) {
      return Infinity;
    }
    const natural = this.loop || !this.buffer ? Infinity : this.startedAt + (this.buffer.duration - this.offset);
    return Math.min(natural, this.stopAt ?? Infinity);
  }

  ownSignal() {
    const now = this.context.currentTime;
    return this.startedAt !== null && !this.ended && now >= this.startedAt && now < this.endTime() ? 1 : 0;
  }
}

export class FakeMediaSource extends FakeNode {
  constructor(
    context: FakeAudioContext,
    readonly element: FakeMediaElement,
  ) {
    super(context, "mediaElementSource");
  }

  ownSignal() {
    return this.element.paused ? 0 : 1;
  }
}

/**
 * A fake <audio>. Metadata arrives when the test calls `context.flush()` (as
 * a real element loads asynchronously); playback moves with the clock and
 * "ended" fires at the end. URLs listed in `context.failingUrls` fire "error".
 */
export class FakeMediaElement implements MediaElementLike {
  src = "";
  preload = "";
  loop = false;
  private time = 0;
  private playing = false;
  private loaded = false;
  private readonly listeners = new Map<string, Set<() => void>>();
  /** Set when the element is wired into a context, which a real element allows only once. */
  sourceNode: FakeMediaSource | null = null;

  constructor(readonly context: FakeAudioContext) {
    context.elements.push(this);
  }

  get duration() {
    return this.loaded ? (this.context.mediaDurations.get(this.src) ?? NaN) : NaN;
  }

  get paused() {
    return !this.playing;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = Math.max(0, Math.min(value, Number.isFinite(this.duration) ? this.duration : value));
  }

  play() {
    if (!this.src) {
      return Promise.reject(new Error("NotSupportedError: no source"));
    }
    this.playing = true;
    return Promise.resolve();
  }

  pause() {
    this.playing = false;
  }

  load() {
    this.loaded = false;
    this.playing = false;
    this.time = 0;
    if (this.src) {
      this.context.pendingLoads.add(this);
    }
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
    }
  }

  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }

  /** Called by the context when loading finishes. */
  finishLoad() {
    if (!this.src) {
      return;
    }
    if (this.context.failingUrls.has(this.src)) {
      this.emit("error");
      return;
    }
    this.loaded = true;
    this.emit("loadedmetadata");
  }

  /** Called by the clock. */
  tick(seconds: number) {
    if (!this.playing || !this.loaded) {
      return;
    }
    this.time += seconds;
    if (this.loop && this.time >= this.duration) {
      this.time %= this.duration;
    } else if (this.time >= this.duration) {
      this.time = this.duration;
      this.playing = false;
      this.emit("ended");
    }
  }

  /** Holds resources: has a source address. */
  get holdsMedia() {
    return this.src !== "";
  }
}

/** Shared time for the context, media elements and timers. */
export class FakeClock implements Scheduler {
  now = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  setTimeout(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + Math.max(0, ms) / 1000, callback });
    return id;
  }

  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }

  pendingTimers(): number {
    return this.timers.size;
  }

  /** The earliest timer due at or before `until`, if any. */
  takeDue(until: number): { at: number; callback: () => void } | undefined {
    let best: [number, { at: number; callback: () => void }] | undefined;
    for (const entry of this.timers) {
      if (entry[1].at <= until && (!best || entry[1].at < best[1].at)) {
        best = entry;
      }
    }
    if (best) {
      this.timers.delete(best[0]);
      return best[1];
    }
    return undefined;
  }
}

export class FakeAudioContext implements EngineContext {
  readonly clock = new FakeClock();
  readonly allNodes: FakeNode[] = [];
  readonly elements: FakeMediaElement[] = [];
  readonly pendingLoads = new Set<FakeMediaElement>();
  /** Duration in seconds of each media URL, as an element would report once loaded. */
  readonly mediaDurations = new Map<string, number>();
  /** URLs whose media element fires "error" or whose decode fails. */
  readonly failingUrls = new Set<string>();
  /** The context's own output; tests connect outputs here to "listen". */
  readonly destination: FakeGain;
  decodeCalls = 0;

  constructor() {
    this.destination = new FakeGain(this);
  }

  get currentTime() {
    return this.clock.now;
  }

  createGain() {
    return new FakeGain(this);
  }

  createBufferSource() {
    return new FakeBufferSource(this);
  }

  createMediaElementSource(element: MediaElementLike) {
    const fake = element as FakeMediaElement;
    if (!(fake instanceof FakeMediaElement)) {
      throw new Error("Expected a FakeMediaElement");
    }
    if (fake.sourceNode) {
      throw new Error("InvalidStateError: element already connected to a source node");
    }
    fake.sourceNode = new FakeMediaSource(this, fake);
    return fake.sourceNode;
  }

  /** "Decodes" bytes written by `encodeFakeAudio`. */
  async decodeAudioData(data: ArrayBuffer) {
    this.decodeCalls++;
    const view = new Float64Array(data.slice(0, 8));
    const seconds = view[0];
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error("EncodingError: unable to decode audio data");
    }
    return new FakeBuffer(seconds);
  }

  createMediaElement(): FakeMediaElement {
    return new FakeMediaElement(this);
  }

  /** Finish pending media loads (metadata or error), then let promises settle. */
  async flush() {
    for (let round = 0; round < 5; round++) {
      const loads = [...this.pendingLoads];
      this.pendingLoads.clear();
      loads.forEach((element) => element.finishLoad());
      // Microtasks only: engine code awaits promises, never real timers.
      for (let tick = 0; tick < 10; tick++) {
        await Promise.resolve();
      }
    }
  }

  /**
   * Move time forward in small steps, running timers, media playback and
   * buffer-source endings in time order, letting promises settle in between.
   */
  async advance(seconds: number, step = 0.05) {
    const end = this.clock.now + seconds;
    while (this.clock.now < end - 1e-9) {
      const stepEnd = Math.min(end, this.clock.now + step);
      let due = this.clock.takeDue(stepEnd);
      while (due) {
        this.moveTo(Math.max(this.clock.now, due.at));
        due.callback();
        await this.flush();
        due = this.clock.takeDue(stepEnd);
      }
      this.moveTo(stepEnd);
      await this.flush();
    }
  }

  private moveTo(time: number) {
    const delta = time - this.clock.now;
    if (delta <= 0) {
      return;
    }
    this.clock.now = time;
    this.elements.forEach((element) => element.tick(delta));
    this.settleSources();
  }

  /** Fire onended for buffer sources whose end time has passed. */
  settleSources() {
    for (const node of this.allNodes) {
      if (node instanceof FakeBufferSource && !node.ended && node.startedAt !== null && this.currentTime >= node.endTime()) {
        node.ended = true;
        node.onended?.();
      }
    }
  }

  /** Nodes with at least one connection in or out, besides the destination. */
  connectedNodeCount(): number {
    const connected = new Set<FakeNode>();
    for (const node of this.allNodes) {
      for (const output of node.outputs) {
        connected.add(node);
        connected.add(output);
      }
    }
    connected.delete(this.destination);
    return connected.size;
  }

  /** Buffer sources started and not yet ended. */
  runningSourceCount(): number {
    return this.allNodes.filter((n) => n instanceof FakeBufferSource && n.startedAt !== null && !n.ended).length;
  }

  /** Media elements that still hold a source address. */
  elementsHoldingMedia(): number {
    return this.elements.filter((element) => element.holdsMedia).length;
  }

  listenersOnElements(): number {
    return this.elements.reduce((sum, element) => sum + element.listenerCount(), 0);
  }

  /** True when signal can flow from `from` to `to`. */
  reaches(from: FakeNode, to: FakeNode): boolean {
    const seen = new Set<FakeNode>();
    const stack = [from];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === to) {
        return true;
      }
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      stack.push(...node.outputs);
    }
    return false;
  }

  /**
   * The level arriving at the output of `node` now: each sounding source counts
   * as 1, multiplied by every gain on the way.
   */
  signalAt(node: FakeNode): number {
    const memo = new Map<FakeNode, number>();
    const level = (n: FakeNode, depth: number): number => {
      if (depth > 1000) {
        throw new Error("Cycle in fake audio graph");
      }
      if (memo.has(n)) {
        return memo.get(n)!;
      }
      let input = n.ownSignal();
      for (const other of this.allNodes) {
        if (other.outputs.has(n)) {
          input += level(other, depth + 1);
        }
      }
      const value = input * n.scale();
      memo.set(n, value);
      return value;
    };
    return level(node, 0);
  }
}

/** Bytes that FakeAudioContext.decodeAudioData "decodes" to a buffer of `seconds`, padded to `size` bytes. */
export function encodeFakeAudio(seconds: number, size = 1024): ArrayBuffer {
  const buffer = new ArrayBuffer(Math.max(8, size));
  new Float64Array(buffer, 0, 1)[0] = seconds;
  return buffer;
}
