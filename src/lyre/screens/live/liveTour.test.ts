import { describe, expect, it } from "vitest";

import { LIVE_TOUR } from "./liveTour";

describe("the Live tour (round 10, T7)", () => {
  it("has the six steps of the design, in order", () => {
    expect(LIVE_TOUR.map((s) => s.title)).toEqual(["Next scene", "On air: what the players hear", "Preview: only you", "Pads and their keys", "Undo", "Fade all and Stop all"]);
  });
  it("points each step at something with a selector a page can use", () => {
    for (const step of LIVE_TOUR) expect(() => document.querySelector(step.target)).not.toThrow();
  });
});
