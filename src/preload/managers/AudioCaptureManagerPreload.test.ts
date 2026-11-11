import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureManagerPreload, opusEncoderConfig } from "./AudioCaptureManagerPreload";

vi.mock("./PCMStream.worklet", () => ({ default: "blob:pcm-stream" }));
vi.mock("./PlayerFrameInlet.worklet", () => ({ default: "blob:player-frame-inlet" }));

/** Audio node that records what it is connected to. */
class FakeNode {
  connections = new Set<FakeNode>();
  disconnected = false;
  gain = { value: 1 };
  connect(target: FakeNode) {
    this.connections.add(target);
    return target;
  }
  disconnect(target?: FakeNode) {
    if (target) {
      this.connections.delete(target);
      return;
    }
    this.connections.clear();
    this.disconnected = true;
  }
}

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeAudioContext {
  nodes: FakeNode[] = [];
  state = "running";
  options: unknown;
  closed = false;
  audioWorklet = { addModule: vi.fn(async (_url: string) => undefined) };
  destination = new FakeNode();
  sinkId = "";
  setSinkId = vi.fn(async (deviceId: string) => {
    if (deviceId === "gone") {
      throw new Error("NotFoundError: Requested device not found");
    }
    this.sinkId = deviceId;
  });
  constructor(options?: unknown) {
    this.options = options;
    contexts.push(this);
  }
  createGain() {
    return this.track(new FakeNode());
  }
  createMediaStreamSource(stream: FakeStream) {
    return this.track(Object.assign(new FakeNode(), { stream }));
  }
  createMediaStreamDestination() {
    return this.track(Object.assign(new FakeNode(), { stream: new FakeStream() }));
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.closed = true;
    this.state = "closed";
  }
  /** Source nodes still wired into the graph (tab and device captures). */
  connectedSources() {
    return this.nodes.filter((node) => "stream" in node && node.connections.size > 0 && !(node instanceof FakeWorkletNode));
  }
  private track<T extends FakeNode>(node: T) {
    this.nodes.push(node);
    return node;
  }
}

class FakeWorkletNode extends FakeNode {
  port = {
    onmessage: undefined as undefined | ((event: { data: unknown }) => void),
    postMessage: vi.fn((_message: unknown, _transfer?: unknown[]) => undefined),
  };
  constructor(
    readonly context: FakeAudioContext,
    readonly name: string,
    readonly options: unknown,
  ) {
    super();
    workletNodes.push(this);
  }
}

class FakeEncoder {
  state = "unconfigured";
  config: unknown;
  encoded: { timestamp: number; numberOfFrames: number }[] = [];
  constructor(readonly init: { output(chunk: unknown): void; error(error: unknown): void }) {
    encoders.push(this);
  }
  configure(config: unknown) {
    this.config = config;
    this.state = "configured";
  }
  encode(data: FakeAudioData) {
    this.encoded.push({ timestamp: data.timestamp, numberOfFrames: data.numberOfFrames });
    // Pretend every frame becomes a 3-byte packet.
    const bytes = new Uint8Array([1, 2, 3]);
    this.init.output({ byteLength: 3, copyTo: (target: Uint8Array) => target.set(bytes) });
  }
  flushes = 0;
  async flush() {
    this.flushes++;
  }
  close() {
    this.state = "closed";
  }
}

class FakeAudioData {
  timestamp: number;
  numberOfFrames: number;
  closed = false;
  constructor(init: { timestamp: number; numberOfFrames: number }) {
    this.timestamp = init.timestamp;
    this.numberOfFrames = init.numberOfFrames;
  }
  close() {
    this.closed = true;
  }
}

/** Whether sound put into `from` reaches `to` along the connections made. */
function reaches(from: unknown, to: unknown, seen = new Set<FakeNode>()): boolean {
  const node = from as FakeNode;
  if (node === to) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return [...node.connections].some((next) => reaches(next, to, seen));
}

const contexts: FakeAudioContext[] = [];
const workletNodes: FakeWorkletNode[] = [];
const encoders: FakeEncoder[] = [];
const streams: FakeStream[] = [];
const elements: { muted: boolean; srcObject: unknown; pause(): void }[] = [];
let packets: Uint8Array[];

function newManager() {
  packets = [];
  return new AudioCaptureManagerPreload((packet) => packets.push(packet));
}

async function broadcastingManager() {
  const manager = newManager();
  await manager.startBroadcast("lowLatency");
  return manager;
}

beforeEach(() => {
  contexts.length = 0;
  workletNodes.length = 0;
  encoders.length = 0;
  streams.length = 0;
  elements.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("AudioEncoder", FakeEncoder);
  vi.stubGlobal("AudioData", FakeAudioData);
  vi.stubGlobal("document", {
    createElement: () => {
      const element = { muted: false, srcObject: null as unknown, onloadedmetadata: null as unknown, play: vi.fn(), pause: vi.fn() };
      elements.push(element);
      return element;
    },
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = new FakeStream();
        streams.push(stream);
        return stream;
      }),
    },
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AudioCaptureManagerPreload: nothing runs until a broadcast starts (PERF-4)", () => {
  it("creates no audio context, worklet or encoder before the broadcast", async () => {
    const manager = newManager();
    manager.setLoopback(true);
    manager.setMuted(7, true);
    await manager.startExternalAudioCapture("mic");
    expect(contexts).toEqual([]);
    expect(encoders).toEqual([]);
    expect(streams).toEqual([]);
  });

  it("builds the graph when the broadcast starts and suspends it while nothing plays", async () => {
    await broadcastingManager();
    expect(contexts).toHaveLength(1);
    expect(workletNodes).toHaveLength(1);
    expect(encoders[0].state).toBe("configured");
    expect(contexts[0].state).toBe("suspended");
  });

  it("resumes the audio thread when a tab is captured and suspends it again when the tab stops", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(7, "source-7");
    expect(contexts[0].state).toBe("running");
    manager.stopBrowserViewStream(7);
    expect(contexts[0].state).toBe("suspended");
  });

  it("closes everything when the broadcast stops, and keeps the user's choices for the next one", async () => {
    const manager = await broadcastingManager();
    manager.setMuted(7, true);
    manager.setLoopback(false);
    await manager.startExternalAudioCapture("mic");
    await manager.startBrowserViewStream(7, "source-7");

    await manager.stopBroadcast();
    expect(contexts[0].closed).toBe(true);
    expect(encoders[0].state).toBe("closed");
    expect(streams.every((stream) => stream.tracks[0].stopped)).toBe(true);
    expect(manager._mediaStreams).toEqual({});

    await manager.startBroadcast("lowLatency");
    // The input device is opened again, the loopback stays off.
    expect(streams).toHaveLength(3);
    expect(elements[1].muted).toBe(true);
    await manager.startBrowserViewStream(7, "source-7");
    expect(manager._mediaStreamOutputs[7].gain.value).toBe(0);
  });

  it("ignores a tab capture that finishes after the broadcast stopped", async () => {
    const manager = await broadcastingManager();
    const starting = manager.startBrowserViewStream(7, "source-7");
    await manager.stopBroadcast();
    await starting;
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._mediaStreams).toEqual({});
  });

  it("waits for the graph when a tab is captured while the broadcast is still starting", async () => {
    const manager = newManager();
    const started = manager.startBroadcast("lowLatency");
    const capture = manager.startBrowserViewStream(7, "source-7");
    await Promise.all([started, capture]);
    expect(manager._mediaStreams[7]).toBeDefined();
  });
});

describe("AudioCaptureManagerPreload: Opus encoding in the capture window (PERF-4)", () => {
  it("encodes each 20 ms frame from the worklet and hands the packet on", async () => {
    await broadcastingManager();
    const frame = { index: 3, samples: new Float32Array(1920) };
    workletNodes[0].port.onmessage?.({ data: [frame] });
    expect(encoders[0].encoded).toEqual([{ timestamp: 60_000, numberOfFrames: 960 }]);
    expect(packets).toEqual([new Uint8Array([1, 2, 3])]);
  });

  it("flushes the encoder when a sound ends, so its tail is not heard at the next one's start", async () => {
    await broadcastingManager();
    workletNodes[0].port.onmessage?.({ data: [{ index: 0, samples: new Float32Array(1920) }] });
    expect(encoders[0].flushes).toBe(0);
    workletNodes[0].port.onmessage?.({ data: [{ index: 1, samples: new Float32Array(1920), last: true }] });
    expect(encoders[0].flushes).toBe(1);
  });

  it("configures 48 kHz stereo Opus in 20 ms frames", () => {
    expect(opusEncoderConfig("lowLatency")).toMatchObject({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 2,
      opus: { frameDuration: 20_000 },
    });
  });

  it("drops frames after the encoder has closed", async () => {
    const manager = await broadcastingManager();
    const onmessage = workletNodes[0].port.onmessage;
    await manager.stopBroadcast();
    onmessage?.({ data: [{ index: 0, samples: new Float32Array(1920) }] });
    expect(packets).toEqual([]);
  });

  it.each(["lowLatency", "performance"] as const)(
    "%s mode sends each 20 ms frame as soon as it is complete (PERF-8)",
    async (mode) => {
      const manager = newManager();
      await manager.startBroadcast(mode);
      const options = workletNodes[0].options as { processorOptions?: { framesPerMessage?: number } } | undefined;
      expect(options?.processorOptions?.framesPerMessage ?? 1).toBe(1);
    },
  );

  it("uses less processor time for Opus in performance mode", () => {
    expect(opusEncoderConfig("performance").opus?.complexity).toBeLessThan(
      opusEncoderConfig("lowLatency").opus?.complexity ?? 10,
    );
  });
});

describe("AudioCaptureManagerPreload: stopping streams frees audio nodes (PERF-5)", () => {
  it("disconnects a tab's nodes and stops its tracks when the tab is closed", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(7, "source-7");
    expect(contexts[0].connectedSources()).toHaveLength(1);

    manager.stopBrowserViewStream(7);

    expect(contexts[0].connectedSources()).toHaveLength(0);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._mediaStreams[7]).toBeUndefined();
    expect(manager._mediaStreamOutputs[7]).toBeUndefined();
  });

  it("disconnects an input device's nodes and stops its tracks when it is turned off", async () => {
    const manager = await broadcastingManager();
    await manager.startExternalAudioCapture("mic");
    expect(contexts[0].connectedSources()).toHaveLength(1);

    manager.stopExternalAudioCapture("mic");

    expect(contexts[0].connectedSources()).toHaveLength(0);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._externalAudioStreams["mic"]).toBeUndefined();
    expect(manager._externalAudioStreamOutputs["mic"]).toBeUndefined();
  });

  it("keeps the graph the same size when a tab is captured again and again", async () => {
    const manager = await broadcastingManager();
    for (let i = 0; i < 20; i++) {
      await manager.startBrowserViewStream(7, "source-7");
      manager.stopBrowserViewStream(7);
    }
    expect(contexts[0].connectedSources()).toHaveLength(0);
    expect(streams.every((stream) => stream.tracks[0].stopped)).toBe(true);
  });

  it("replaces an earlier capture of the same tab instead of leaving it running", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(7, "source-7");
    await manager.startBrowserViewStream(7, "source-7");
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(contexts[0].connectedSources()).toHaveLength(1);
  });

  it("stops every tab stream at once and leaves input devices running", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(1, "source-1");
    await manager.startBrowserViewStream(2, "source-2");
    await manager.startExternalAudioCapture("mic");

    manager.stopAllBrowserViewStreams();

    expect(Object.keys(manager._mediaStreams)).toEqual([]);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(streams[1].tracks[0].stopped).toBe(true);
    expect(streams[2].tracks[0].stopped).toBe(false);
    expect(contexts[0].connectedSources()).toHaveLength(1);
  });

  it("drops a tab capture that was stopped while it was still starting", async () => {
    const manager = await broadcastingManager();
    const starting = manager.startBrowserViewStream(7, "source-7");
    manager.stopBrowserViewStream(7);
    await starting;

    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._mediaStreams[7]).toBeUndefined();
    expect(contexts[0].connectedSources()).toHaveLength(0);
  });

  it("drops every pending tab capture when all streams stop", async () => {
    const manager = await broadcastingManager();
    const starting = manager.startBrowserViewStream(7, "source-7");
    manager.stopAllBrowserViewStreams();
    await starting;

    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(contexts[0].connectedSources()).toHaveLength(0);
  });

  it("keeps the latest capture when a tab is started twice in a row", async () => {
    const manager = await broadcastingManager();
    const first = manager.startBrowserViewStream(7, "source-7");
    const second = manager.startBrowserViewStream(7, "source-7b");
    await Promise.all([first, second]);

    expect(streams.filter((stream) => !stream.tracks[0].stopped)).toHaveLength(1);
    expect(contexts[0].connectedSources()).toHaveLength(1);
  });

  it("says in the log which view it is capturing, for diagnosis", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(7, "source-7");
    expect(console.info).toHaveBeenCalledWith("Capturing audio of view 7");
  });

  it("ignores stop requests for streams that were never started", () => {
    const manager = newManager();
    expect(() => manager.stopBrowserViewStream(99)).not.toThrow();
    expect(() => manager.stopExternalAudioCapture("none")).not.toThrow();
    expect(() => manager.stopAllBrowserViewStreams()).not.toThrow();
  });

  it("still mutes a captured tab", async () => {
    const manager = await broadcastingManager();
    await manager.startBrowserViewStream(7, "source-7");
    manager.setMuted(7, true);
    expect(manager._mediaStreamOutputs[7].gain.value).toBe(0);
  });
});

// --- Rooms and buses ---
describe("AudioCaptureManagerPreload: one mix and one encoder per room (OUT-5)", () => {
  const A = "bot-a";
  const B = "bot-b";
  let sent: [Uint8Array, string | undefined][];

  function roomManager() {
    sent = [];
    return new AudioCaptureManagerPreload((packet, room) => sent.push([packet, room]));
  }

  async function broadcastingRooms(rooms = [A, B]) {
    const manager = roomManager();
    manager.setRooms(rooms);
    await manager.startBroadcast("lowLatency");
    return manager;
  }

  /** The node every source of a room connects to. */
  const roomInput = (manager: AudioCaptureManagerPreload, room: string) =>
    manager._mixes.get(room)!.input as unknown as FakeNode;
  /** Rooms a tab's audio goes to now. */
  const roomsOfView = (manager: AudioCaptureManagerPreload, viewId: number) =>
    [...manager._mixes.entries()]
      .filter(([, mix]) => (manager._mediaStreamOutputs[viewId] as unknown as FakeNode).connections.has(mix.input as never))
      .map(([room]) => room);
  const frame = (index = 0) => ({ data: [{ index, samples: new Float32Array(1920) }] });

  it("encodes each room separately and tags its packets with the room", async () => {
    await broadcastingRooms();
    expect(workletNodes).toHaveLength(2);
    expect(encoders).toHaveLength(2);
    workletNodes[1].port.onmessage?.(frame());
    workletNodes[0].port.onmessage?.(frame());
    expect(sent.map(([, room]) => room)).toEqual([B, A]);
    expect(encoders.map((encoder) => encoder.encoded.length)).toEqual([1, 1]);
  });

  it("builds the rooms told while the broadcast was starting", async () => {
    const manager = roomManager();
    const started = manager.startBroadcast("lowLatency");
    manager.setRooms([A, B]);
    await started;
    expect([...manager._mixes.keys()]).toEqual([A, B]);
  });

  it("adds a room's mix when its bot joins, and stops it when the bot leaves", async () => {
    const manager = await broadcastingRooms([A]);
    manager.setRooms([A, B]);
    await manager._ready;
    expect([...manager._mixes.keys()]).toEqual([A, B]);
    const leaving = manager._mixes.get(B)!;
    const onmessage = workletNodes[1].port.onmessage;

    manager.setRooms([A]);

    expect([...manager._mixes.keys()]).toEqual([A]);
    expect(encoders[1].state).toBe("closed");
    expect((leaving.input as unknown as FakeNode).disconnected).toBe(true);
    onmessage?.(frame());
    expect(sent).toEqual([]);
  });

  it("sends tabs and input devices to every room until routed otherwise (as Lyre 0.2)", async () => {
    const manager = await broadcastingRooms();
    await manager.startBrowserViewStream(7, "source-7");
    await manager.startExternalAudioCapture("mic");
    expect(roomsOfView(manager, 7)).toEqual([A, B]);
    const mic = manager._externalAudioStreamOutputs["mic"] as unknown as FakeNode;
    expect(mic.connections.has(roomInput(manager, A))).toBe(true);
    expect(mic.connections.has(roomInput(manager, B))).toBe(true);
  });

  it("sends a tab routed to the table to the first room only, and to one room when chosen", async () => {
    const manager = await broadcastingRooms();
    await manager.startBrowserViewStream(7, "source-7");
    await manager.startBrowserViewStream(8, "source-8");
    manager.routeView(7, "table");
    manager.routeView(8, { room: B });
    expect(roomsOfView(manager, 7)).toEqual([A]);
    expect(roomsOfView(manager, 8)).toEqual([B]);
  });

  it("follows the default route for tabs without their own (the design: the table)", async () => {
    const manager = await broadcastingRooms();
    manager.setDefaultRoute("table");
    await manager.startBrowserViewStream(7, "source-7");
    expect(roomsOfView(manager, 7)).toEqual([A]);
  });

  it("moves a tab to the new first room when the table's bot leaves, and a gone room's tab to the first", async () => {
    const manager = await broadcastingRooms([A, B, "bot-c"]);
    await manager.startBrowserViewStream(7, "source-7");
    await manager.startBrowserViewStream(8, "source-8");
    manager.routeView(7, "table");
    manager.routeView(8, { room: "bot-c" });
    manager.setRooms([B, A]);
    await manager._ready;
    expect(roomsOfView(manager, 7)).toEqual([B]);
    expect(roomsOfView(manager, 8)).toEqual([B]);
  });

  it("keeps a route given before the tab's capture starts", async () => {
    const manager = await broadcastingRooms();
    manager.routeView(7, { room: B });
    await manager.startBrowserViewStream(7, "source-7");
    expect(roomsOfView(manager, 7)).toEqual([B]);
  });

  it("applies each room's volume, also to rooms and broadcasts that start later", async () => {
    const manager = roomManager();
    manager.setRoomVolume(B, 0.25);
    manager.setRooms([A, B]);
    await manager.startBroadcast("lowLatency");
    expect(manager._mixes.get(B)!.volume.gain.value).toBe(0.25);
    expect(manager._mixes.get(B)!.localVolume.gain.value).toBe(0.25);
    expect(manager._mixes.get(A)!.volume.gain.value).toBe(1);
    manager.setRoomVolume(A, 0.5);
    expect(manager._mixes.get(A)!.volume.gain.value).toBe(0.5);
    // This Computer hears the room's tabs at the same volume.
    expect(manager._mixes.get(A)!.localVolume.gain.value).toBe(0.5);
  });

  it("plays only the first room's tabs and input devices on this computer", async () => {
    const manager = await broadcastingRooms();
    const loopback = manager._loopbackNode;
    expect(reaches(roomInput(manager, A), loopback)).toBe(true);
    expect(reaches(roomInput(manager, B), loopback)).toBe(false);
    manager.setRooms([B]);
    await manager._ready;
    expect(reaches(roomInput(manager, B), loopback)).toBe(true);
    expect(elements).toHaveLength(1);
  });

  it("sends untagged packets from one mix while it has been told no rooms (as before)", async () => {
    const manager = roomManager();
    await manager.startBroadcast("lowLatency");
    workletNodes[0].port.onmessage?.(frame());
    expect(sent.map(([, room]) => room)).toEqual([undefined]);
    manager.setRooms([A]);
    await manager._ready;
    expect([...manager._mixes.keys()]).toEqual([A]);
  });

  it("ignores odd room lists and routes", async () => {
    const manager = await broadcastingRooms();
    manager.setRooms("bot-a" as never);
    manager.setRooms([A, A]);
    manager.routeView(7, { room: 5 } as never);
    expect([...manager._mixes.keys()]).toEqual([A, B]);
    expect(manager._routes.has(7)).toBe(false);
  });
});

describe("AudioCaptureManagerPreload: engine rooms and preview from the player page (OUT-5, PRV-1)", () => {
  const A = "bot-a";
  const B = "bot-b";

  /** The capture window's end of the player channel. */
  class FakePort {
    posted: Record<string, unknown>[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    closed = false;
    postMessage(message: Record<string, unknown>) {
      this.posted.push(message);
    }
    start() {}
    close() {
      this.closed = true;
    }
    deliver(data: unknown) {
      this.onmessage?.({ data });
    }
  }

  const roomFrame = (room: string, index = 0) => ({ kind: "room", room, index, samples: new Float32Array(1920) });
  const previewFrame = (index = 0) => ({ kind: "preview", index, samples: new Float32Array(1920) });
  const inlets = () => workletNodes.filter((node) => node.name === "player-frame-inlet");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function withPlayer(rooms = [A, B]) {
    const manager = newManager();
    const port = new FakePort();
    manager.setPlayerPort(port);
    manager.setRooms(rooms);
    await manager.startBroadcast("lowLatency");
    return { manager, port };
  }

  it("tells the player page when a broadcast starts and stops, and on a new channel", async () => {
    const manager = newManager();
    const port = new FakePort();
    manager.setPlayerPort(port);
    await manager.startBroadcast("lowLatency");
    await manager.stopBroadcast();
    expect(port.posted).toEqual([
      { kind: "broadcast", active: false },
      { kind: "broadcast", active: true },
      { kind: "broadcast", active: false },
    ]);
    const next = new FakePort();
    manager.setPlayerPort(next);
    expect(port.closed).toBe(true);
    expect(next.posted).toEqual([{ kind: "broadcast", active: false }]);
  });

  it("plays a room's frames into that room's mix only", async () => {
    const { manager, port } = await withPlayer();
    port.deliver(roomFrame(B, 4));
    expect(inlets()).toHaveLength(1);
    const inlet = inlets()[0];
    // Past the room's input (tabs and devices), into its volume towards the bot only (BUG-19).
    expect(inlet.connections).toEqual(new Set([manager._mixes.get(B)!.volume]));
    expect(inlet.port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ index: 4, samples: expect.any(Float32Array) }),
      [expect.any(ArrayBuffer)],
    );
    port.deliver(roomFrame(B, 5));
    expect(inlets()).toHaveLength(1);
    expect(contexts[0].state).toBe("running");
  });

  it("BUG-19: never plays an engine room on this computer; its frames still reach that room's encoder", async () => {
    const { manager, port } = await withPlayer();
    const loopback = manager._loopbackNode;
    port.deliver(roomFrame(A));
    const inlet = inlets()[0];
    expect(reaches(inlet, manager._mixes.get(A)!.pcmNode)).toBe(true);
    expect(reaches(inlet, loopback)).toBe(false);
    // A tab in the first room still plays here, as the old player and websites always did.
    await manager.startBrowserViewStream(7, "source-7");
    expect(reaches(manager._mediaStreamOutputs[7], loopback)).toBe(true);
    // Nor once the rooms change and another room becomes the first.
    manager.setRooms([B, A]);
    port.deliver(roomFrame(B));
    expect(inlets()).toHaveLength(2);
    for (const node of inlets()) expect(reaches(node, loopback)).toBe(false);
    expect(reaches(inlets()[1], manager._mixes.get(B)!.pcmNode)).toBe(true);
  });

  it("drops frames for a room it does not have, or outside a broadcast, or that are odd", async () => {
    const { manager, port } = await withPlayer([A]);
    port.deliver(roomFrame("bot-gone"));
    port.deliver({ kind: "room", room: A, index: 0, samples: new Float32Array(3) });
    port.deliver({ kind: "broadcast", active: true });
    expect(inlets()).toHaveLength(0);
    await manager.stopBroadcast();
    port.deliver(roomFrame(A));
    expect(inlets()).toHaveLength(0);
  });

  it("frees a room's inlet when its bot leaves, and after a few seconds without frames", async () => {
    vi.useFakeTimers();
    try {
      const { manager, port } = await withPlayer();
      port.deliver(roomFrame(A));
      port.deliver(roomFrame(B));
      manager.setRooms([A]);
      expect(inlets()[1].disconnected).toBe(true);
      vi.advanceTimersByTime(5_000);
      expect(inlets()[0].disconnected).toBe(true);
      expect(manager._playerInlets.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays the preview in an audio context of its own, never in a room's mix", async () => {
    const { manager, port } = await withPlayer();
    port.deliver(roomFrame(A));
    port.deliver(previewFrame());
    await settle();
    const preview = contexts[1];
    expect(preview).toBeDefined();
    expect(preview).not.toBe(contexts[0]);
    const previewInlet = workletNodes.find((node) => node.context === preview)!;
    expect(previewInlet.connections).toEqual(new Set([preview.destination]));
    for (const mix of manager._mixes.values()) {
      expect(contexts[0].nodes.includes(previewInlet as never)).toBe(false);
      expect((mix.input as unknown as FakeNode).connections.has(previewInlet)).toBe(false);
    }
    port.deliver(previewFrame(1));
    await settle();
    expect(previewInlet.port.postMessage).toHaveBeenCalledTimes(2);
  });

  it("previews without a broadcast too, and closes the preview's context when it has been quiet a while", async () => {
    vi.useFakeTimers();
    try {
      const manager = newManager();
      const port = new FakePort();
      manager.setPlayerPort(port);
      port.deliver(previewFrame());
      await vi.advanceTimersByTimeAsync(0);
      expect(contexts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(contexts[0].closed).toBe(true);
      expect(manager._preview).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("w51-audio: plays a room's frames that come over the room's own channel, as if they came on the player channel", async () => {
    const { manager, port } = await withPlayer();
    const frames = new FakePort();
    port.deliver({ kind: "room-frames", room: B, port: frames });
    expect(inlets()).toHaveLength(0);
    frames.deliver([{ index: 4, samples: new Float32Array(1920), last: false }]);
    expect(inlets()).toHaveLength(1);
    expect(inlets()[0].connections).toEqual(new Set([manager._mixes.get(B)!.volume]));
    expect(inlets()[0].port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ index: 4, samples: expect.any(Float32Array) }),
      [expect.any(ArrayBuffer)],
    );
    frames.deliver([{ index: 5, samples: new Float32Array(3) }]);
    frames.deliver({ index: 6, samples: new Float32Array(1920) });
    expect(inlets()[0].port.postMessage).toHaveBeenCalledTimes(1);
  });

  it("w51-audio: closes a room's frames channel when the room goes, a new one comes, the broadcast stops or the player channel is replaced", async () => {
    const { manager, port } = await withPlayer();
    const [a1, a2, b] = [new FakePort(), new FakePort(), new FakePort()];
    port.deliver({ kind: "room-frames", room: A, port: a1 });
    port.deliver({ kind: "room-frames", room: B, port: b });
    port.deliver({ kind: "room-frames", room: A, port: a2 });
    expect(a1.closed).toBe(true);
    manager.setRooms([A]);
    expect(b.closed).toBe(true);
    await manager.stopBroadcast();
    expect(a2.closed).toBe(true);

    await manager.startBroadcast("lowLatency");
    const a3 = new FakePort();
    port.deliver({ kind: "room-frames", room: A, port: a3 });
    manager.setPlayerPort(new FakePort());
    expect(a3.closed).toBe(true);
  });

  it("w51-audio: plays the preview's frames that come over its own channel, and closes the old one for a new one", async () => {
    const manager = newManager();
    const port = new FakePort();
    manager.setPlayerPort(port);
    const first = new FakePort();
    port.deliver({ kind: "preview-frames", port: first });
    first.deliver([{ index: 0, samples: new Float32Array(1920), last: false }]);
    await settle();
    const previewInlet = workletNodes.find((node) => node.name === "player-frame-inlet")!;
    expect(previewInlet.port.postMessage).toHaveBeenCalledTimes(1);
    const second = new FakePort();
    port.deliver({ kind: "preview-frames", port: second });
    expect(first.closed).toBe(true);
    manager.setPlayerPort(new FakePort());
    expect(second.closed).toBe(true);
  });

  it("w51-audio: counts each room's and the preview's frames, holes and drops, for Save diagnostics and the tests", async () => {
    const { manager, port } = await withPlayer();
    port.deliver(roomFrame(A, 0));
    port.deliver(roomFrame(A, 1));
    port.deliver(previewFrame(0));
    await settle();
    const roomInlet = inlets()[0];
    roomInlet.port.onmessage?.({ data: { kind: "hole", wait: 3 } });
    roomInlet.port.onmessage?.({ data: { kind: "dropped" } });
    roomInlet.port.onmessage?.({ data: { kind: "odd" } });
    expect(manager.audioTiming()).toEqual({
      [A]: { frames: 2, holes: 1, dropped: 1, wait: 3 },
      preview: { frames: 1, holes: 0, dropped: 0, wait: 2 },
    });
  });

  it("w51-audio: says in the log once a minute, in plain words, when Lyre's sound arrived late or was dropped", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { port } = await withPlayer();
      port.deliver(roomFrame(A, 0));
      inlets()[0].port.onmessage?.({ data: { kind: "hole", wait: 3 } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/^Audio timing, last minute: room bot-a: 1 frames, 1 late \(holes\), 0 dropped/);
      // A quiet minute says nothing.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("plays the preview on the chosen device and says when it cannot (PRV-2)", async () => {
    const manager = newManager();
    const port = new FakePort();
    manager.setPlayerPort(port);
    port.deliver({ kind: "preview-sink", id: 1, deviceId: "headphones" });
    await settle();
    await settle();
    expect(contexts[0].sinkId).toBe("headphones");
    port.deliver({ kind: "preview-sink", id: 2, deviceId: "gone" });
    await settle();
    await settle();
    expect(port.posted.filter((message) => message.kind === "preview-sink-done")).toEqual([
      { kind: "preview-sink-done", id: 1 },
      { kind: "preview-sink-done", id: 2, error: "That sound device is not available. The preview stays on the device it was on." },
    ]);
    expect(contexts[0].sinkId).toBe("headphones");
  });
});
