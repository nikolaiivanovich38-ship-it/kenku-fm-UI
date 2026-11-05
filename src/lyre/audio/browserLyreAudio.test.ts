/**
 * The page-root wiring of LyreAudio (assembleLyreAudio), with fakes for the
 * parts only a real browser has (audio contexts, worklets, the channel's
 * arrival). The real-browser pieces themselves are covered by
 * e2e/rooms.spec.ts and e2e/engine.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Room } from "../../common/domain";
import { PlaybackEngine } from "../../player/engine/engine";
import { createBridgedPreviewOutput, PlayerAudioLink, type FrameTap } from "../../player/engine/rooms";
import { SourceLoader } from "../../player/engine/sources/sourceLoader";
import { FakeAudioContext } from "../../player/engine/testing/fakeAudio";
import { assembleLyreAudio } from "./browserLyreAudio";
import { ROOM_START_VOLUME } from "./lyreAudio";
import type { LyreAudioBridge } from "./preloadAudio";
import { FakeAudioPort, staticAudioLibrary, testTrack } from "./testing/onFakes";

vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

const PORT_MESSAGE = "lyre-player-audio-port";

let context: FakeAudioContext;
let previewContext: FakeAudioContext;
let win: EventTarget;
let roomsListener: ((rooms: Room[]) => void) | null;
let bridge: LyreAudioBridge & { connect: ReturnType<typeof vi.fn<() => void>> };
let closed: string[];
let saved: unknown;

function deliverPort(port: FakeAudioPort, source: unknown = win) {
  const event = new MessageEvent("message", { data: PORT_MESSAGE });
  Object.defineProperty(event, "source", { value: source });
  Object.defineProperty(event, "ports", { value: [port] });
  win.dispatchEvent(event);
}

function assemble() {
  const tap = (ctx: FakeAudioContext) => (): FrameTap => {
    const input = ctx.createGain();
    return { input, dispose: () => input.disconnect() };
  };
  const link = new PlayerAudioLink();
  const loader = new SourceLoader({ context, createElement: () => context.createMediaElement(), fetchBytes: async () => null });
  return assembleLyreAudio({
    window: win as Window,
    bridge,
    library: staticAudioLibrary({ tracks: [testTrack("m1", 20)], playlists: [], campaigns: [] }),
    context,
    engine: new PlaybackEngine({ context, scheduler: context.clock, loader }),
    link,
    createTap: tap(context),
    previewOutput: createBridgedPreviewOutput({
      context: previewContext,
      link,
      createTap: tap(previewContext),
      closeContext: async () => void closed.push("preview context"),
    }),
    previewLoad: (media) => new SourceLoader({ context: previewContext, createElement: () => previewContext.createMediaElement(), fetchBytes: async () => null }).load(media),
    previewScheduler: previewContext.clock,
    devices: { list: async () => [{ deviceId: "hp", label: "Headphones" }], onChange: () => () => undefined },
    store: { load: () => saved as never, save: (choices) => (saved = choices) },
    closeContext: async () => void closed.push("engine context"),
  });
}

beforeEach(() => {
  context = new FakeAudioContext();
  previewContext = new FakeAudioContext();
  context.mediaDurations.set("file:///m1.ogg", 20);
  win = new EventTarget();
  roomsListener = null;
  closed = [];
  saved = { preview: { deviceId: "hp", label: "Headphones" } };
  bridge = {
    connect: vi.fn<() => void>(),
    onRooms: (callback) => {
      roomsListener = callback;
      callback([]);
      return () => (roomsListener = null);
    },
    media: { prepare: async (url) => ({ url }) },
  };
});

describe("assembleLyreAudio: LyreAudio wired into the new page as docs/ARCHITECTURE.md 'Host wiring for wave 3' says", () => {
  it("asks for the channel and takes the end the preload posts to this window only", async () => {
    const audio = assemble();
    expect(bridge.connect).toHaveBeenCalledTimes(1);
    const stranger = new FakeAudioPort();
    deliverPort(stranger, {});
    expect(stranger.onmessage).toBeNull();
    const port = new FakeAudioPort();
    deliverPort(port);
    port.deliver({ kind: "broadcast", active: true });
    expect(audio.getNowPlaying().broadcasting).toBe(true);
    await audio.dispose();
  });

  it("follows the rooms the main process sends", async () => {
    const audio = assemble();
    roomsListener!([{ botId: "bot-a", name: "Tavern" }]);
    expect(audio.getNowPlaying().rooms.map((room) => room.name)).toEqual(["Tavern"]);
    // UX-16: rooms start at the design's 85.
    expect(audio.getNowPlaying().rooms[0].volume).toBe(ROOM_START_VOLUME);
    await audio.dispose();
  });

  it("plays on this page's speakers outside a broadcast only", async () => {
    const audio = assemble();
    const port = new FakeAudioPort();
    deliverPort(port);
    audio.playTrack("m1");
    await context.advance(4);
    expect(context.signalAt(context.destination)).toBeCloseTo(ROOM_START_VOLUME);
    port.deliver({ kind: "broadcast", active: true });
    expect(context.signalAt(context.destination)).toBe(0);
    await audio.dispose();
  });

  it("puts the preview on the remembered device once the channel is there, and again on every new channel", async () => {
    const audio = assemble();
    const first = new FakeAudioPort();
    deliverPort(first);
    await vi.waitFor(() => expect(first.posted).toContainEqual(expect.objectContaining({ kind: "preview-sink", deviceId: "hp" })));
    const sink = first.posted.find((message) => message.kind === "preview-sink")!;
    first.deliver({ kind: "preview-sink-done", id: sink.id });
    const second = new FakeAudioPort();
    deliverPort(second);
    await vi.waitFor(() => expect(second.posted).toContainEqual(expect.objectContaining({ kind: "preview-sink", deviceId: "hp" })));
    await audio.dispose();
  });

  it("lets go of everything when disposed: rooms, the channel, both audio contexts", async () => {
    const audio = assemble();
    const port = new FakeAudioPort();
    deliverPort(port);
    await audio.dispose();
    expect(roomsListener).toBeNull();
    expect(port.closed).toBe(true);
    expect(closed).toEqual(expect.arrayContaining(["preview context", "engine context"]));
    // A late end is not taken.
    const late = new FakeAudioPort();
    deliverPort(late);
    expect(late.onmessage).toBeNull();
  });
});
