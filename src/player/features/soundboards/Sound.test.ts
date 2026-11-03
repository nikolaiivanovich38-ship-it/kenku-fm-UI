import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeHowl } from "../../test/fakeHowler";
import { Sound } from "./Sound";

vi.mock("howler", () => import("../../test/fakeHowler"));

/** Test file length in seconds; the fake Howl reports it as duration(). */
const DURATION_S = 10;

function createSound(
  overrides: Partial<{
    loop: boolean;
    fadeIn: number;
    fadeOut: number;
    volume: number;
  }> = {},
) {
  return new Sound({
    src: "file:///sound.ogg",
    volume: 0.8,
    loop: false,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  });
}

/** Load and start the most recent Howl, as Howler does with autoplay. */
function startLatest() {
  const howl = FakeHowl.latest;
  howl.load();
  howl.startPlaying();
  return howl;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeHowl.reset();
  FakeHowl.defaultDuration = DURATION_S;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sound fade and loop behaviour (BUG-3)", () => {
  type Case = { fadeIn: number; fadeOut: number; loop: boolean };
  const cases: Case[] = [];
  for (const fadeIn of [0, 200]) {
    for (const fadeOut of [0, 300]) {
      for (const loop of [false, true]) {
        cases.push({ fadeIn, fadeOut, loop });
      }
    }
  }

  describe.each(cases)("fadeIn=$fadeIn fadeOut=$fadeOut loop=$loop", (c) => {
    it("creates one autoplaying Howl, using HTML5 audio only when fading out", () => {
      createSound(c);

      expect(FakeHowl.instances).toHaveLength(1);
      const options = FakeHowl.latest.options;
      expect(options.src).toBe("file:///sound.ogg");
      expect(options.autoplay).toBe(true);
      // Fading out (and cross-fading loops) needs separate Howl instances, which uses
      // HTML5 audio; without a fade-out Web Audio is used so loops are gapless.
      expect(options.html5).toBe(c.fadeOut > 0);
      // Howler only loops by itself when Kenku does not cross-fade the loop.
      expect(options.loop).toBe(c.fadeOut > 0 ? false : c.loop);
      // A sound that fades in starts silent.
      expect(options.volume).toBe(c.fadeIn > 0 ? 0 : 0.8);
    });

    it(c.fadeIn > 0 ? "fades in from 0 to its volume when it starts" : "starts at full volume without a fade", () => {
      createSound(c);
      const howl = startLatest();

      if (c.fadeIn > 0) {
        expect(howl.callsOf("fade")).toEqual([[0, 0.8, c.fadeIn]]);
      } else {
        expect(howl.callsOf("fade")).toEqual([]);
      }
    });

    it(
      c.fadeOut === 0
        ? "never fades out and never creates a second Howl"
        : c.loop
          ? "cross-fades into a new Howl fadeOut ms before the end"
          : "fades out fadeOut ms before the end",
      () => {
        createSound(c);
        const first = startLatest();
        if (c.fadeIn > 0) {
          // The fade-in completes long before the fade-out point.
          first.finishFade();
        }
        const fadesBefore = first.callsOf("fade").length;

        if (c.fadeOut === 0) {
          vi.advanceTimersByTime(DURATION_S * 1000 * 3);
          expect(first.callsOf("fade")).toHaveLength(fadesBefore);
          expect(FakeHowl.instances).toHaveLength(1);
          return;
        }

        vi.advanceTimersByTime(DURATION_S * 1000 - c.fadeOut - 1);
        expect(first.callsOf("fade")).toHaveLength(fadesBefore);

        vi.advanceTimersByTime(1);
        expect(first.lastCallOf("fade")).toEqual([0.8, 0, c.fadeOut]);
        if (c.loop) {
          expect(FakeHowl.instances).toHaveLength(2);
          const second = FakeHowl.latest;
          expect(second.options.html5).toBe(true);
          expect(second.options.loop).toBe(false);
          second.load();
          second.startPlaying();
          expect(second.callsOf("fade")).toEqual(c.fadeIn > 0 ? [[0, 0.8, c.fadeIn]] : []);
        } else {
          expect(FakeHowl.instances).toHaveLength(1);
        }
      },
    );
  });

  it("fades in only on the first start of a gapless loop (Web Audio re-emits play every loop)", () => {
    createSound({ fadeIn: 200, fadeOut: 0, loop: true });
    const howl = startLatest();
    howl.end();
    howl.startPlaying();
    howl.end();
    howl.startPlaying();

    expect(howl.callsOf("fade")).toEqual([[0, 0.8, 200]]);
  });

  it("uses the volume at the moment playback starts as the fade-in target", () => {
    const sound = createSound({ fadeIn: 200 });
    sound.volume(0.5);
    const howl = startLatest();

    expect(howl.lastCallOf("fade")).toEqual([0, 0.5, 200]);
  });
});

describe("Sound cross-faded loops release their audio (BUG-4)", () => {
  /** Run one loop iteration: play the current Howl to its cross-fade point. */
  function runOneLoop(fadeOut: number, finishOutgoingFade: boolean) {
    const current = startLatest();
    vi.advanceTimersByTime(DURATION_S * 1000 - fadeOut);
    expect(FakeHowl.latest).not.toBe(current);
    if (finishOutgoingFade) {
      current.finishFade();
    }
  }

  it("unloads every outgoing Howl after its fade-out over 500 loops", () => {
    createSound({ fadeIn: 100, fadeOut: 100, loop: true });

    for (let i = 0; i < 500; i++) {
      runOneLoop(100, true);
    }

    expect(FakeHowl.instances).toHaveLength(501);
    const current = FakeHowl.latest;
    for (const howl of FakeHowl.instances) {
      expect(howl.unloaded).toBe(howl !== current);
    }
  });

  it("keeps at most two Howls alive even when fade events never arrive", () => {
    createSound({ fadeIn: 100, fadeOut: 100, loop: true });

    for (let i = 0; i < 50; i++) {
      runOneLoop(100, false);
      expect(FakeHowl.alive.length).toBeLessThanOrEqual(2);
    }
  });

  it("does not cut the outgoing Howl short when its fade-in is still running", () => {
    // A 150 ms clip with 100 ms fades: the fade-in is still running at the cross-fade point.
    FakeHowl.defaultDuration = 0.15;
    createSound({ fadeIn: 100, fadeOut: 100, loop: true });
    const first = startLatest();
    vi.advanceTimersByTime(50);

    expect(FakeHowl.instances).toHaveLength(2);
    expect(first.unloaded).toBe(false);
    first.finishFade();
    expect(first.unloaded).toBe(true);
  });

  it("stop(false) unloads the current and the still-fading Howl and cancels the timer", async () => {
    const sound = createSound({ fadeIn: 100, fadeOut: 100, loop: true });
    const first = startLatest();
    vi.advanceTimersByTime(DURATION_S * 1000 - 100);
    const second = FakeHowl.latest;
    second.load();
    second.startPlaying();

    await sound.stop(false);

    expect(first.unloaded).toBe(true);
    expect(second.unloaded).toBe(true);
    vi.advanceTimersByTime(DURATION_S * 1000 * 5);
    expect(FakeHowl.instances).toHaveLength(2);
  });

  it("stop(true) fades the current Howl out over fadeOut, then unloads both", async () => {
    const sound = createSound({ fadeIn: 100, fadeOut: 250, loop: true });
    const first = startLatest();
    vi.advanceTimersByTime(DURATION_S * 1000 - 250);
    const second = FakeHowl.latest;
    second.load();
    second.startPlaying();
    second.finishFade();

    let resolved = false;
    const stopped = sound.stop(true).then(() => {
      resolved = true;
    });
    expect(second.lastCallOf("fade")).toEqual([0.8, 0, 250]);
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(second.unloaded).toBe(false);

    second.finishFade();
    await stopped;

    expect(second.unloaded).toBe(true);
    expect(first.unloaded).toBe(true);
    vi.advanceTimersByTime(DURATION_S * 1000 * 5);
    expect(FakeHowl.instances).toHaveLength(2);
  });
});

describe("Sound stop", () => {
  it("stop(true) with fadeOut 0 unloads at once without fading", async () => {
    const sound = createSound({ fadeOut: 0 });
    const howl = startLatest();

    await sound.stop(true);

    expect(howl.callsOf("fade")).toEqual([]);
    expect(howl.unloaded).toBe(true);
  });

  it("stop(true) during the fade-in fades out from the current volume instead of cutting off", async () => {
    const sound = createSound({ fadeIn: 1000, fadeOut: 500 });
    const howl = startLatest();
    howl.setFadeProgress(0.3);

    const stopped = sound.stop(true);
    expect(howl.unloaded).toBe(false);
    expect(howl.lastCallOf("fade")).toEqual([0.3, 0, 500]);
    howl.finishFade();
    await stopped;
    expect(howl.unloaded).toBe(true);
  });

  it("stop(true) at volume 0 unloads at once (Howler never emits fade for a 0 to 0 fade)", async () => {
    const sound = createSound({ fadeOut: 500, volume: 0 });
    const howl = startLatest();

    await sound.stop(true);

    expect(howl.unloaded).toBe(true);
  });

  it("stop(true) before the sound has started unloads at once", async () => {
    const sound = createSound({ fadeOut: 500 });
    const howl = FakeHowl.latest;

    await sound.stop(true);

    expect(howl.unloaded).toBe(true);
  });

  it("ignores a late play event after stop", async () => {
    const sound = createSound({ fadeIn: 100, fadeOut: 500 });
    const howl = FakeHowl.latest;
    await sound.stop(false);

    howl.startPlaying();
    vi.advanceTimersByTime(DURATION_S * 1000);

    expect(howl.callsOf("fade")).toEqual([]);
    expect(FakeHowl.instances).toHaveLength(1);
  });

  it("stop(false) on a non-looping sound unloads it and cancels its fade-out timer", async () => {
    const sound = createSound({ fadeOut: 300 });
    const howl = startLatest();

    await sound.stop(false);
    vi.advanceTimersByTime(DURATION_S * 1000);

    expect(howl.unloaded).toBe(true);
    expect(howl.callsOf("fade")).toEqual([]);
  });
});

describe("Sound seek reschedules the fade-out (BUG-5)", () => {
  it("fades out fadeOut ms before the end measured from the new position", () => {
    const sound = createSound({ fadeOut: 1000 });
    const howl = startLatest();

    sound.seek(8);
    expect(howl.callsOf("seek")).toEqual([[8]]);

    vi.advanceTimersByTime(999);
    expect(howl.callsOf("fade")).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(howl.callsOf("fade")).toEqual([[0.8, 0, 1000]]);
  });

  it("delays the cross-fade when seeking backwards in a loop", () => {
    const sound = createSound({ fadeOut: 1000, loop: true });
    startLatest();
    vi.advanceTimersByTime(5000);

    sound.seek(1);
    vi.advanceTimersByTime(4000);
    expect(FakeHowl.instances).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(FakeHowl.instances).toHaveLength(2);
  });

  it("does not schedule a fade-out on seek when fadeOut is 0", () => {
    const sound = createSound({ fadeOut: 0, loop: true });
    const howl = startLatest();
    sound.seek(9);
    vi.advanceTimersByTime(DURATION_S * 1000);

    expect(howl.callsOf("fade")).toEqual([]);
    expect(FakeHowl.instances).toHaveLength(1);
  });
});

describe("Sound events and controls", () => {
  it("emits load with the duration in seconds", () => {
    const sound = createSound();
    const onLoad = vi.fn();
    sound.on("load", onLoad);

    FakeHowl.latest.load(42.7);

    expect(onLoad).toHaveBeenCalledWith(42.7);
  });

  it("emits end when a non-looping sound ends", () => {
    const sound = createSound();
    const onEnd = vi.fn();
    sound.on("end", onEnd);

    startLatest().end();

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not emit end for a looping sound", () => {
    const sound = createSound({ loop: true });
    const onEnd = vi.fn();
    sound.on("end", onEnd);

    startLatest().end();

    expect(onEnd).not.toHaveBeenCalled();
  });

  it("ignores end from an outgoing cross-faded Howl after loop is switched off", () => {
    const sound = createSound({ fadeIn: 100, fadeOut: 100, loop: true });
    const onEnd = vi.fn();
    sound.on("end", onEnd);
    const first = startLatest();
    vi.advanceTimersByTime(DURATION_S * 1000 - 100);

    sound.loop(false);
    first.end();

    expect(onEnd).not.toHaveBeenCalled();
  });

  it.each(["loaderror", "playerror"])("emits error on %s", (event) => {
    const sound = createSound();
    const onError = vi.fn();
    sound.on("error", onError);

    FakeHowl.latest.emit(event, 1, "boom");

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a Howl without a sound as an error after listeners are attached", async () => {
    FakeHowl.nextHasNoSound = true;
    const sound = createSound();
    const onError = vi.fn();
    sound.on("error", onError);

    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a Howl constructor failure as an error after listeners are attached", async () => {
    FakeHowl.nextThrows = true;
    const sound = createSound();
    const onError = vi.fn();
    sound.on("error", onError);

    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("volume() updates the options and the playing Howl", () => {
    const sound = createSound();
    const howl = startLatest();

    sound.volume(0.25);

    expect(sound.options.volume).toBe(0.25);
    expect(howl.callsOf("volume")).toEqual([[0.25]]);
  });

  it("loop() toggles Howler looping when there is no fade-out", () => {
    const sound = createSound({ fadeIn: 200, fadeOut: 0 });
    const howl = startLatest();

    sound.loop(true);

    expect(sound.options.loop).toBe(true);
    expect(howl.callsOf("loop")).toEqual([[true]]);
  });

  it("loop() with a fade-out leaves Howler looping off and cross-fades at the end instead", () => {
    const sound = createSound({ fadeOut: 300 });
    const howl = startLatest();

    sound.loop(true);
    vi.advanceTimersByTime(DURATION_S * 1000 - 300);

    expect(howl.callsOf("loop")).toEqual([]);
    expect(FakeHowl.instances).toHaveLength(2);
  });

  it("playing() and progress() read the current Howl", () => {
    const sound = createSound();
    const howl = startLatest();
    howl.seek(3);

    expect(sound.playing()).toBe(true);
    expect(sound.progress()).toBe(3);
  });
});
