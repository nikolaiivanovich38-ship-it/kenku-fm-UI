import { describe, expect, it } from "vitest";

import { MAX_DECODE_SECONDS, SoundLengths } from "./soundLengths";

/** A Storage stand-in that can be told to fail, as localStorage can in a private window. */
function memoryStorage(failing = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => {
      if (failing) throw new Error("storage refused");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (failing) throw new Error("storage refused");
      data.set(key, value);
    },
  };
}

describe("SoundLengths (PERF-7)", () => {
  it("knows nothing about a sound it has not heard", () => {
    const lengths = new SoundLengths();
    expect(lengths.get("file:///a.ogg")).toBeUndefined();
    expect(lengths.isShort("file:///a.ogg")).toBe(false);
  });

  it(`calls a sound short up to ${MAX_DECODE_SECONDS} seconds and long after`, () => {
    const lengths = new SoundLengths();
    lengths.remember("file:///hit.ogg", 2.5);
    lengths.remember("file:///edge.ogg", MAX_DECODE_SECONDS);
    lengths.remember("file:///rain.ogg", 600);

    expect(lengths.isShort("file:///hit.ogg")).toBe(true);
    expect(lengths.isShort("file:///edge.ogg")).toBe(true);
    expect(lengths.isShort("file:///rain.ogg")).toBe(false);
  });

  it("ignores lengths that are not a real number of seconds", () => {
    const lengths = new SoundLengths();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      lengths.remember("file:///x.ogg", bad);
    }
    expect(lengths.get("file:///x.ogg")).toBeUndefined();
  });

  it("keeps what it learned for the next start of the player", () => {
    const storage = memoryStorage();
    new SoundLengths(storage).remember("file:///hit.ogg", 3);

    expect(new SoundLengths(storage).isShort("file:///hit.ogg")).toBe(true);
  });

  it("forgets the oldest sounds beyond its limit", () => {
    const lengths = new SoundLengths(undefined, 2);
    lengths.remember("file:///1.ogg", 1);
    lengths.remember("file:///2.ogg", 2);
    lengths.remember("file:///3.ogg", 3);

    expect(lengths.get("file:///1.ogg")).toBeUndefined();
    expect(lengths.get("file:///3.ogg")).toBe(3);
  });

  it("still works in memory when storage refuses or holds rubbish", () => {
    const failing = new SoundLengths(memoryStorage(true));
    failing.remember("file:///hit.ogg", 3);
    expect(failing.isShort("file:///hit.ogg")).toBe(true);

    const storage = memoryStorage();
    storage.data.set("lyre.soundLengths", "{not json");
    expect(new SoundLengths(storage).get("file:///hit.ogg")).toBeUndefined();
    storage.data.set("lyre.soundLengths", JSON.stringify({ "file:///a.ogg": "long", "file:///b.ogg": 4 }));
    const read = new SoundLengths(storage);
    expect(read.get("file:///a.ogg")).toBeUndefined();
    expect(read.get("file:///b.ogg")).toBe(4);
  });
});
