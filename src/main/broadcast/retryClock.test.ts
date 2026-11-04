import { describe, expect, it } from "vitest";
import { RetryClock } from "./retryClock";

describe("RetryClock (UX finding 6)", () => {
  it("turns a wait that starts into the time the next attempt is due", () => {
    const clock = new RetryClock();
    expect(clock.update("bot", "Connection to “Tavern” lost. Trying again in 4 s…", 1_000)).toBe(5_000);
  });

  it("keeps the due time while the same wait goes on, and starts again when the wait changes", () => {
    const clock = new RetryClock();
    clock.update("bot", "Trying again in 1 s…", 1_000);
    expect(clock.update("bot", "Trying again in 1 s…", 1_900)).toBe(2_000);
    expect(clock.update("bot", "Trying again in 2 s…", 2_050)).toBe(4_050);
  });

  it("forgets the wait once the reason is not a wait any more", () => {
    const clock = new RetryClock();
    clock.update("bot", "Trying again in 1 s…", 0);
    expect(clock.update("bot", "Could not join", 10)).toBeUndefined();
    expect(clock.get("bot")).toBeUndefined();
  });

  it("forgets a bot's voice connections that have gone, or the whole bot", () => {
    const clock = new RetryClock();
    clock.update("a", "Trying again in 1 s…", 0);
    clock.update("a:1", "Trying again in 1 s…", 0);
    clock.update("a:2", "Trying again in 1 s…", 0);
    clock.forget("a", ["a:2"]);
    expect([clock.get("a"), clock.get("a:1"), clock.get("a:2")]).toEqual([1_000, undefined, 1_000]);
    clock.forget("a");
    expect([clock.get("a"), clock.get("a:2")]).toEqual([undefined, undefined]);
  });
});
