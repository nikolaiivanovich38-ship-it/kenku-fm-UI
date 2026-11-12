import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAudioContext, FakeBufferSource, FakeBuffer, FakeGain } from "../testing/fakeAudio";
import { BUS_IDS, BusId, Mixer, OUTPUT_IDS, TABLE_BUSES } from "./mixer";

let context: FakeAudioContext;
let mixer: Mixer;

/** A sounding source wired into a bus, as a voice would be. */
function soundOn(bus: BusId): FakeBufferSource {
  const source = context.createBufferSource();
  source.buffer = new FakeBuffer(600);
  source.connect(mixer.input(bus));
  source.start(context.currentTime);
  return source;
}

const out = (id: "table" | "whisper" | "preview") => context.signalAt(mixer.outputs[id] as FakeGain);

beforeEach(() => {
  context = new FakeAudioContext();
  mixer = new Mixer(context);
});

describe("Mixer routing (PLY-5, PRV-1, OUT-5)", () => {
  it("has the five buses and three separate outputs", () => {
    expect(BUS_IDS).toEqual(["music", "ambience", "effects", "whisper", "preview"]);
    expect(OUTPUT_IDS).toEqual(["table", "whisper", "preview"]);
    expect(TABLE_BUSES).toEqual(["music", "ambience", "effects"]);
  });

  it.each(["music", "ambience", "effects"] as const)("%s reaches only the table mix", (bus) => {
    const input = mixer.input(bus) as FakeGain;
    expect(context.reaches(input, mixer.outputs.table as FakeGain)).toBe(true);
    expect(context.reaches(input, mixer.outputs.whisper as FakeGain)).toBe(false);
    expect(context.reaches(input, mixer.outputs.preview as FakeGain)).toBe(false);
  });

  it("whisper reaches only the whisper output, and preview only the preview output", () => {
    const { table, whisper, preview } = mixer.outputs as unknown as Record<string, FakeGain>;
    expect(context.reaches(mixer.input("whisper") as FakeGain, whisper)).toBe(true);
    expect(context.reaches(mixer.input("whisper") as FakeGain, table)).toBe(false);
    expect(context.reaches(mixer.input("whisper") as FakeGain, preview)).toBe(false);
    expect(context.reaches(mixer.input("preview") as FakeGain, preview)).toBe(true);
    expect(context.reaches(mixer.input("preview") as FakeGain, table)).toBe(false);
    expect(context.reaches(mixer.input("preview") as FakeGain, whisper)).toBe(false);
  });

  it("the table mix is the sum of music, ambience and effects through the master", () => {
    soundOn("music");
    soundOn("ambience");
    soundOn("effects");
    soundOn("whisper");
    soundOn("preview");
    expect(out("table")).toBeCloseTo(3);
    expect(out("whisper")).toBeCloseTo(1);
    expect(out("preview")).toBeCloseTo(1);
  });

  it("outputs are not connected anywhere until the host connects them", () => {
    for (const id of OUTPUT_IDS) {
      expect((mixer.outputs[id] as FakeGain).outputs.size).toBe(0);
    }
  });
});

describe("Mixer levels and mute", () => {
  it("bus and master levels multiply, after a short smoothing ramp", async () => {
    soundOn("music");
    mixer.setLevel("music", 0.5);
    mixer.setLevel("master", 0.4);
    await context.advance(0.1);
    expect(out("table")).toBeCloseTo(0.2);
  });

  it("mute silences a bus and unmute brings back its level", async () => {
    soundOn("ambience");
    mixer.setLevel("ambience", 0.7);
    mixer.setMuted("ambience", true);
    await context.advance(0.1);
    expect(out("table")).toBeCloseTo(0);
    expect(mixer.levels().ambience).toEqual({ level: 0.7, muted: true });

    mixer.setMuted("ambience", false);
    await context.advance(0.1);
    expect(out("table")).toBeCloseTo(0.7);
  });

  it("master affects the table mix only; whisper and preview have their own levels", async () => {
    soundOn("whisper");
    soundOn("preview");
    mixer.setMuted("master", true);
    mixer.setLevel("whisper", 0.3);
    mixer.setLevel("preview", 0.6);
    await context.advance(0.1);
    expect(out("whisper")).toBeCloseTo(0.3);
    expect(out("preview")).toBeCloseTo(0.6);
  });

  it("levels are kept between 0 and 1 and anything not a number is refused", () => {
    mixer.setLevel("music", 3);
    mixer.setLevel("effects", -1);
    expect(mixer.levels().music.level).toBe(1);
    expect(mixer.levels().effects.level).toBe(0);
    expect(() => mixer.setLevel("music", Number.NaN)).toThrow(/level/i);
  });

  it("levels() and restore() save and bring back every fader (for layouts and scenes later)", async () => {
    mixer.setLevel("music", 0.2);
    mixer.setMuted("effects", true);
    const saved = mixer.levels();
    const other = new Mixer(context);
    other.restore(saved);
    expect(other.levels()).toEqual(saved);
  });

  it("tells listeners when a level changes", () => {
    const listener = vi.fn();
    mixer.on("change", listener);
    mixer.setLevel("music", 0.5);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ music: { level: 0.5, muted: false } }));
  });
});

describe("Mixer dispose", () => {
  it("disconnects every node it made", () => {
    const baseline = context.connectedNodeCount();
    const extra = new Mixer(context);
    expect(context.connectedNodeCount()).toBeGreaterThan(baseline);
    extra.dispose();
    expect(context.connectedNodeCount()).toBe(baseline);
  });
});
