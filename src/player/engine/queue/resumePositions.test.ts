import { describe, expect, it } from "vitest";
import { storedResumePositions } from "./resumePositions";

function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("where Pick up where it stopped tracks stopped, kept across restarts (lead's decision 2)", () => {
  it("keeps each track's position and finds it again after a restart", () => {
    const storage = memory();
    const first = storedResumePositions(storage);
    first.set("t19", 84.5);
    first.set("t20", 12);
    first.delete("t20");
    const next = storedResumePositions(storage);
    expect(next.get("t19")).toBe(84.5);
    expect(next.has("t20")).toBe(false);
  });

  it("ignores anything unreadable, and keeps working when storage refuses", () => {
    const storage = memory();
    storage.data["lyre-resume-positions"] = "{not json";
    expect(storedResumePositions(storage).size).toBe(0);
    storage.data["lyre-resume-positions"] = JSON.stringify({ t1: "x", t2: -1, t3: 5 });
    expect([...storedResumePositions(storage).entries()]).toEqual([["t3", 5]]);
    const broken = { getItem: (): string | null => null, setItem: (): void => { throw new Error("full"); } };
    const positions = storedResumePositions(broken);
    expect(() => positions.set("t1", 3)).not.toThrow();
    expect(positions.get("t1")).toBe(3);
  });
});
