import { describe, expect, it } from "vitest";

import { HISTORY_MAX, PlaceHistory, placeExists, placeLabel, trailOf, type Place, type PlaceNames } from "./history";

const at = (path: string, label = path): Place => ({ path, label, scrolls: {}, focus: "" });

const NAMES: PlaceNames = {
  loaded: true,
  campaign: (id) => (id === "crown" ? "The Sunken Crown" : null),
  session: (c, s) => (c === "crown" && s === "s14" ? 14 : null),
  playlist: (id) => (id === "p-abbess" ? "The Abbess" : null),
  board: (id) => (id === "abbey" ? "Drowned Abbey" : null),
  track: (id) => (id === "t13" ? "Ashes" : null),
};

describe("Back's history of places (UX-18, round 6 part 7)", () => {
  it("is empty at the very start: Back has nowhere to go", () => {
    const h = new PlaceHistory();
    expect(h.peek("campaigns")).toBeNull();
    expect(h.back("campaigns")).toBeNull();
  });

  it("walks back one place per press, newest first, through five steps and more", () => {
    const h = new PlaceHistory();
    const route = ["library", "library/t13", "profile/t13", "boards", "board/abbey", "live", "outputs"];
    for (let i = 1; i < route.length; i++) h.leave(at(route[i - 1]), route[i]);
    let here = "outputs";
    const walked: string[] = [];
    for (let place = h.back(here); place; place = h.back(here)) {
      walked.push(place.path);
      here = place.path;
    }
    expect(walked).toEqual(["live", "board/abbey", "boards", "profile/t13", "library/t13", "library"]);
  });

  it("keeps what the place was like when Nik left: label, scroll positions and the control used", () => {
    const h = new PlaceHistory();
    h.leave({ path: "session/crown/s14", label: "Session 14", scrolls: { view: 400 }, focus: "button|Scene 3: The abbey ruins|0" }, "playlists");
    expect(h.peek("playlists")).toEqual({ path: "session/crown/s14", label: "Session 14", scrolls: { view: 400 }, focus: "button|Scene 3: The abbey ruins|0" });
  });

  it(`keeps ${HISTORY_MAX} places and forgets the oldest`, () => {
    const h = new PlaceHistory();
    for (let i = 0; i < HISTORY_MAX + 10; i++) h.leave(at(`board/b${i}`), `board/b${i + 1}`);
    expect(h.size).toBe(HISTORY_MAX);
    let here = `board/b${HISTORY_MAX + 10}`;
    let last: Place | null = null;
    for (let place = h.back(here); place; place = h.back(here)) {
      last = place;
      here = place.path;
    }
    expect(last?.path).toBe("board/b10");
  });

  it("skips a place that is gone (a deleted board) and the place Nik is already in", () => {
    const h = new PlaceHistory();
    h.leave(at("library"), "board/gone");
    h.leave(at("board/gone"), "playlists");
    h.leave(at("library"), "playlists");
    const exists = (path: string) => path !== "board/gone";
    expect(h.back("library", exists)?.path).toBeUndefined();
    const g = new PlaceHistory();
    g.leave(at("library"), "board/gone");
    g.leave(at("board/gone"), "playlists");
    expect(g.peek("playlists", exists)?.path).toBe("library");
  });

  it("records nothing for a move to the same place", () => {
    const h = new PlaceHistory();
    h.leave(at("library"), "library");
    expect(h.size).toBe(0);
  });
});

describe("what Back calls a place, and whether it is still there", () => {
  it.each([
    ["campaign/crown", "The Sunken Crown"],
    ["session/crown/s14", "Session 14"],
    ["playlist/p-abbess", "The Abbess"],
    ["board/abbey", "Drowned Abbey"],
    ["library/t13", "Library: Ashes"],
    ["profile/t13", "Audio profile: Ashes"],
    ["profile/t13/sc:crown:s14:sc3", "Audio profile: Ashes"],
    ["library", "Library"],
    ["boards", "Pad boards"],
    ["outputs", "Rooms"],
    ["live", "Live"],
    ["settings", "Settings"],
    ["look", "Look and feel"],
  ])("%s is %s", (path, label) => {
    expect(placeLabel(path, NAMES)).toBe(label);
  });

  it("names a place by its kind while the library has not answered", () => {
    expect(placeLabel("board/abbey")).toBe("Pad board");
    expect(placeLabel("session/crown/s14")).toBe("Session");
  });

  it("knows a deleted board, playlist, session or track is gone; until the library answers nothing is", () => {
    expect(placeExists("board/abbey", NAMES)).toBe(true);
    expect(placeExists("board/gone", NAMES)).toBe(false);
    expect(placeExists("playlist/gone", NAMES)).toBe(false);
    expect(placeExists("session/crown/s99", NAMES)).toBe(false);
    expect(placeExists("library/t99", NAMES)).toBe(false);
    expect(placeExists("library", NAMES)).toBe(true);
    expect(placeExists("board/gone", { ...NAMES, loaded: false })).toBe(true);
  });
});

describe("the trail (round 6 part 6)", () => {
  it("gives each screen's parents as links; the screen's title follows them", () => {
    expect(trailOf("session/crown/s14", NAMES)).toEqual([
      { href: "#/campaigns", label: "Campaigns" },
      { href: "#/campaign/crown", label: "The Sunken Crown" },
    ]);
    expect(trailOf("campaign/crown", NAMES)).toEqual([{ href: "#/campaigns", label: "Campaigns" }]);
    expect(trailOf("board/abbey", NAMES)).toEqual([{ href: "#/boards", label: "Pad boards" }]);
    expect(trailOf("playlist/p-abbess", NAMES)).toEqual([{ href: "#/playlists", label: "Playlists" }]);
    expect(trailOf("profile/t13", NAMES)).toEqual([{ href: "#/library/t13", label: "Library" }]);
    expect(trailOf("backup", NAMES)).toEqual([{ href: "#/library", label: "Library" }]);
  });

  it.each(["campaigns", "library", "library/t13", "playlists", "boards", "outputs", "settings", "look", "live"])("%s has none", (path) => {
    expect(trailOf(path, NAMES)).toEqual([]);
  });
});
