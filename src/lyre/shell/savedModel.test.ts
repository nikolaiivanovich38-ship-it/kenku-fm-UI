import { describe, expect, it } from "vitest";

import { MERGE_MS, NoteRules, noteDuration, savedText } from "./savedModel";

describe("the Saved pop-up's words (UX-19, round 6 part 5)", () => {
  it('says "Saved: " and what, with any detail after " · "', () => {
    expect(savedText("The Sunken Crown notes")).toBe("Saved: The Sunken Crown notes");
    expect(savedText("The abbey ruins music", "2 tracks from position 3")).toBe("Saved: The abbey ruins music · 2 tracks from position 3");
  });

  it("stays 3 s, longer text up to 6 s", () => {
    expect(noteDuration("Saved: notes")).toBe(3000);
    expect(noteDuration("x".repeat(80))).toBe(80 * 55);
    expect(noteDuration("x".repeat(400))).toBe(6000);
  });
});

describe("one pop-up for the same save (merge and timing)", () => {
  it("the same save again within 2 s refreshes the one pop-up and is not read out again", () => {
    const rules = new NoteRules();
    expect(rules.show("saved:notes", 1000)).toEqual({ refresh: false, readOut: true });
    expect(rules.show("saved:notes", 1000 + MERGE_MS - 1)).toEqual({ refresh: true, readOut: false });
    // Each refresh restarts the 2 s from itself.
    expect(rules.show("saved:notes", 1000 + 2 * MERGE_MS - 2)).toEqual({ refresh: true, readOut: false });
  });

  it("after 2 s, or for another save, it is a new pop-up, read out", () => {
    const rules = new NoteRules();
    rules.show("saved:notes", 0);
    expect(rules.show("saved:notes", MERGE_MS + 1)).toEqual({ refresh: false, readOut: true });
    expect(rules.show("saved:name", MERGE_MS + 2)).toEqual({ refresh: false, readOut: true });
  });

  it("once the pop-up has gone, the same save is a new one", () => {
    const rules = new NoteRules();
    rules.show("saved:notes", 0);
    rules.hidden();
    expect(rules.show("saved:notes", 100)).toEqual({ refresh: false, readOut: true });
  });

  it("is not read out within half a second of the same event being announced (Could 14)", () => {
    const rules = new NoteRules();
    rules.said(1000);
    expect(rules.show("saved:x", 1400).readOut).toBe(false);
    expect(rules.show("saved:y", 1600).readOut).toBe(true);
  });

  it("UX-R6: an announcement within half a second of a pop-up that was read out is not spoken too", () => {
    const rules = new NoteRules();
    rules.show("saved:repeat", 1000);
    expect(rules.said(1030)).toBe(false);
    expect(rules.said(1600)).toBe(true);
    // A pop-up that was not read out (a refresh) does not quiet the next announcement.
    rules.show("saved:repeat", 1700);
    expect(rules.said(1730)).toBe(true);
  });
});
