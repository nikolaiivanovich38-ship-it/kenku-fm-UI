import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCaptureManagerPreload } from "./AudioCaptureManagerPreload";

vi.mock("electron", () => ({
  ipcRenderer: { send: vi.fn(), invoke: vi.fn(), emit: vi.fn() },
}));
vi.mock("./PCMStream.worklet", () => ({ default: "blob:pcm-stream" }));

/** Audio node that records what it is connected to. */
class FakeNode {
  connections = new Set<FakeNode>();
  disconnected = false;
  gain = { value: 1 };
  connect(target: FakeNode) {
    this.connections.add(target);
    return target;
  }
  disconnect() {
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
  createGain() {
    return this.track(new FakeNode());
  }
  createMediaStreamSource(stream: FakeStream) {
    return this.track(Object.assign(new FakeNode(), { stream }));
  }
  /** Nodes still wired into the graph. */
  connected() {
    return this.nodes.filter((node) => node.connections.size > 0);
  }
  private track(node: FakeNode) {
    this.nodes.push(node);
    return node;
  }
}

let context: FakeAudioContext;
let output: FakeNode;
const streams: FakeStream[] = [];

function startedManager() {
  const manager = new AudioCaptureManagerPreload();
  manager._audioContext = context as unknown as AudioContext;
  manager._audioOutputNode = output as unknown as AudioNode;
  return manager;
}

beforeEach(() => {
  context = new FakeAudioContext();
  output = new FakeNode();
  streams.length = 0;
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = new FakeStream();
        streams.push(stream);
        return stream;
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioCaptureManagerPreload: stopping streams frees audio nodes (PERF-5)", () => {
  it("disconnects a tab's nodes and stops its tracks when the tab is closed", async () => {
    const manager = startedManager();
    await manager.startBrowserViewStream(7, "source-7");
    expect(context.connected()).toHaveLength(2);

    manager.stopBrowserViewStream(7);

    expect(context.connected()).toHaveLength(0);
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._mediaStreams[7]).toBeUndefined();
    expect(manager._mediaStreamOutputs[7]).toBeUndefined();
  });

  it("disconnects an input device's nodes and stops its tracks when it is turned off", async () => {
    const manager = startedManager();
    await manager.startExternalAudioCapture("mic");
    expect(context.connected()).toHaveLength(2);

    manager.stopExternalAudioCapture("mic");

    expect(context.connected()).toHaveLength(0);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(manager._externalAudioStreams["mic"]).toBeUndefined();
    expect(manager._externalAudioStreamOutputs["mic"]).toBeUndefined();
  });

  it("keeps the graph the same size when a tab is captured again and again", async () => {
    const manager = startedManager();
    for (let i = 0; i < 20; i++) {
      await manager.startBrowserViewStream(7, "source-7");
      manager.stopBrowserViewStream(7);
    }
    expect(context.connected()).toHaveLength(0);
    expect(streams.every((stream) => stream.tracks[0].stopped)).toBe(true);
  });

  it("replaces an earlier capture of the same tab instead of leaving it running", async () => {
    const manager = startedManager();
    await manager.startBrowserViewStream(7, "source-7");
    await manager.startBrowserViewStream(7, "source-7");
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(context.connected()).toHaveLength(2);
  });

  it("stops every tab stream at once and leaves input devices running", async () => {
    const manager = startedManager();
    await manager.startBrowserViewStream(1, "source-1");
    await manager.startBrowserViewStream(2, "source-2");
    await manager.startExternalAudioCapture("mic");

    manager.stopAllBrowserViewStreams();

    expect(Object.keys(manager._mediaStreams)).toEqual([]);
    expect(streams[0].tracks[0].stopped).toBe(true);
    expect(streams[1].tracks[0].stopped).toBe(true);
    expect(streams[2].tracks[0].stopped).toBe(false);
    expect(context.connected()).toHaveLength(2);
  });

  it("ignores stop requests for streams that were never started", () => {
    const manager = startedManager();
    expect(() => manager.stopBrowserViewStream(99)).not.toThrow();
    expect(() => manager.stopExternalAudioCapture("none")).not.toThrow();
    expect(() => manager.stopAllBrowserViewStreams()).not.toThrow();
  });

  it("still mutes a captured tab", async () => {
    const manager = startedManager();
    await manager.startBrowserViewStream(7, "source-7");
    manager.setMuted(7, true);
    expect(manager._mediaStreamOutputs[7].gain.value).toBe(0);
  });
});
