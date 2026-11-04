import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAudioContext, FakeBuffer, FakeGain } from "./testing/fakeAudio";
import { bufferSource, PlayableSource } from "./sources/layers";
import { PlaybackEngine } from "./engine";
import { BusId } from "./graph/mixer";

let context: FakeAudioContext;
let engine: PlaybackEngine;

const buffer = (seconds: number): PlayableSource => bufferSource(context, new FakeBuffer(seconds));
const output = (id: "table" | "whisper" | "preview") => context.signalAt(engine.outputs[id] as FakeGain);

async function start(bus: BusId, seconds = 60, options = {}) {
  const voice = engine.play({ bus, media: buffer(seconds), ...options });
  await context.flush();
  return voice;
}

beforeEach(() => {
  context = new FakeAudioContext();
  engine = new PlaybackEngine({ context, scheduler: context.clock });
});

describe("PlaybackEngine routing", () => {
  it("plays each item on the bus it names", async () => {
    await start("music");
    await start("effects");
    await start("whisper");
    await start("preview");
    expect(output("table")).toBeCloseTo(2);
    expect(output("whisper")).toBeCloseTo(1);
    expect(output("preview")).toBeCloseTo(1);
  });

  it("a preview is never heard in the table or whisper mixes (PRV-1)", async () => {
    await start("preview");
    await context.advance(1);
    expect(output("preview")).toBeCloseTo(1);
    expect(output("table")).toBe(0);
    expect(output("whisper")).toBe(0);
  });

  it("something sent to whisper is not heard in the table mix, and the reverse (OUT-5)", async () => {
    const whisper = await start("whisper");
    expect(output("table")).toBe(0);
    await whisper.stop(0);
    await start("music");
    expect(output("whisper")).toBe(0);
  });

  it("lists the voices still going, optionally by bus", async () => {
    const music = await start("music");
    await start("ambience");
    expect(engine.voices().map((v) => v.bus)).toEqual(["music", "ambience"]);
    expect(engine.voices("music")).toEqual([music]);
    await music.stop(0);
    expect(engine.voices().map((v) => v.bus)).toEqual(["ambience"]);
  });
});

describe("Fade all and stop all (PLY-5, for Panic in SHW-2)", () => {
  it("fade all fades every voice to silence over N seconds, then releases them", async () => {
    const baseline = context.connectedNodeCount();
    await start("music");
    await start("ambience", 60, { loop: true });
    await start("whisper");
    const done = engine.fadeAll(4);
    await context.advance(2);
    expect(output("table")).toBeCloseTo(1, 1);
    expect(output("whisper")).toBeCloseTo(0.5, 1);
    await context.advance(2.5);
    await done;
    expect(engine.voices()).toEqual([]);
    expect(output("table")).toBe(0);
    expect(context.connectedNodeCount()).toBe(baseline);
  });

  it("fade all leaves the faders where they were, so the next item is heard", async () => {
    engine.mixer.setLevel("music", 0.5);
    await start("music");
    const done = engine.fadeAll(1);
    await context.advance(1.5);
    await done;
    await start("music");
    await context.advance(0.1);
    expect(output("table")).toBeCloseTo(0.5);
  });

  it("fade all can leave the preview playing", async () => {
    await start("music");
    await start("preview");
    const done = engine.fadeAll(1, { except: ["preview"] });
    await context.advance(1.5);
    await done;
    expect(engine.voices().map((v) => v.bus)).toEqual(["preview"]);
  });

  it("stop all silences everything at once, even during a fade all", async () => {
    await start("music");
    await start("effects");
    void engine.fadeAll(10);
    await context.advance(1);
    engine.stopAll();
    expect(engine.voices()).toEqual([]);
    expect(output("table")).toBe(0);
  });

  it("stop all also stops voices that are still loading", async () => {
    let resolve: (source: PlayableSource) => void = () => undefined;
    const voice = engine.play({ bus: "music", media: new Promise((r) => (resolve = r)) });
    engine.stopAll();
    resolve(buffer(10));
    await context.flush();
    expect(voice.state).toBe("stopped");
    expect(output("table")).toBe(0);
  });
});

describe("PlaybackEngine events (no polling, PERF-1)", () => {
  it("reports voices starting, ending and failing as they happen", async () => {
    const events: string[] = [];
    engine.on("voice", (voice, state) => events.push(`${voice.bus}:${state}`));
    engine.on("voice-error", (voice, message) => events.push(`${voice.bus}:error:${message}`));
    await start("effects", 1);
    await context.advance(1.5);
    engine.play({ bus: "music", media: Promise.reject(new Error("File not found")) });
    await context.flush();
    expect(events).toEqual(["effects:playing", "effects:ended", "music:failed", "music:error:File not found"]);
  });

  it("the progress ticker runs only while something plays, once a second", async () => {
    const ticks: number[] = [];
    engine.onProgress(() => ticks.push(context.currentTime));
    await context.advance(5);
    expect(ticks).toEqual([]);
    expect(context.clock.pendingTimers()).toBe(0);

    const voice = await start("music", 60);
    await context.advance(3.05);
    expect(ticks.length).toBe(3);

    voice.pause();
    await context.advance(5);
    expect(ticks.length).toBe(3);
    expect(context.clock.pendingTimers()).toBe(0);

    voice.resume();
    await context.advance(1.05);
    expect(ticks.length).toBe(4);
    await voice.stop(0);
    expect(context.clock.pendingTimers()).toBe(0);
  });

  it("stops ticking when the last listener leaves", async () => {
    const listener = vi.fn();
    const unsubscribe = engine.onProgress(listener);
    await start("music", 60);
    unsubscribe();
    expect(context.clock.pendingTimers()).toBe(0);
  });

  it("the progress report lists every playing voice with its position", async () => {
    const reports: { id: string; position: number }[][] = [];
    engine.onProgress((report) => reports.push(report.map(({ id, position }) => ({ id, position }))));
    const voice = await start("music", 60, { startAt: 10 });
    await context.advance(1.05);
    expect(reports[0]).toEqual([{ id: voice.id, position: expect.closeTo(11, 1) }]);
  });
});

describe("PlaybackEngine dispose", () => {
  it("stops every voice and disconnects the mixer", async () => {
    await start("music");
    engine.dispose();
    expect(context.connectedNodeCount()).toBe(0);
    expect(context.clock.pendingTimers()).toBe(0);
  });
});
