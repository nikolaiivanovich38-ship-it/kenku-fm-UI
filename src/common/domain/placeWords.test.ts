/**
 * UX-16, PLY-13: places and origins in words, the same on every screen (core.js L.placeLabel, the Now playing bar's
 * originOf, _shared.js whereWords).
 */
import { describe, expect, it } from "vitest";

import { originWords, orderPlaceWords, placeLabel, type PlaceNames } from "./placeWords";
import type { UsePlace } from "./round5";

const names: PlaceNames = {
  campaign: (c) => ({ crown: "The Sunken Crown" })[c],
  session: (c, s) => (c === "crown" && s === "s14" ? { number: 14, name: "The Drowned Abbey" } : c === "crown" && s === "s15" ? { number: 15, name: "" } : undefined),
  scene: (c, s, sc) => (c === "crown" && s === "s14" && sc === "sc3" ? "The abbey ruins" : undefined),
};

const ruins: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
const s14: UsePlace = { kind: "session", campaignId: "crown", sessionId: "s14" };
const crown: UsePlace = { kind: "campaign", campaignId: "crown" };

describe("placeLabel: a place in words", () => {
  it("names a scene with its session's number", () => {
    expect(placeLabel(ruins, names)).toBe("The abbey ruins (Session 14)");
  });
  it("names a session by number and name, or number alone when it has no name", () => {
    expect(placeLabel(s14, names)).toBe("Session 14: The Drowned Abbey");
    expect(placeLabel({ kind: "session", campaignId: "crown", sessionId: "s15" }, names)).toBe("Session 15");
  });
  it("names a campaign", () => {
    expect(placeLabel(crown, names)).toBe("The Sunken Crown");
  });
  it("says what kind of place it was when the place has gone", () => {
    expect(placeLabel({ ...ruins, sceneId: "gone" }, names)).toBe("a scene");
    expect(placeLabel({ ...s14, sessionId: "gone" }, names)).toBe("a session");
    expect(placeLabel({ kind: "campaign", campaignId: "gone" }, names)).toBe("a campaign");
  });
});

describe("orderPlaceWords: where a play order applies", () => {
  it("a playlist's own order applies everywhere it has none of its own", () => {
    expect(orderPlaceWords(null, names)).toBe("everywhere it has no order of its own");
  });
  it("a scene is named without its session, a session or campaign in full", () => {
    expect(orderPlaceWords(ruins, names)).toBe("in the scene The abbey ruins");
    expect(orderPlaceWords(s14, names)).toBe("in Session 14: The Drowned Abbey");
    expect(orderPlaceWords(crown, names)).toBe("in The Sunken Crown");
  });
});

describe("originWords: where what plays comes from (the Now playing bar)", () => {
  it("a scene, with the playlist it plays through", () => {
    expect(originWords({ place: ruins, playlistName: "Abbey: eerie, low energy" }, names)).toBe("Scene: The abbey ruins (Session 14) · Abbey: eerie, low energy");
    expect(originWords({ place: ruins, playlistName: null }, names)).toBe("Scene: The abbey ruins (Session 14)");
  });
  it("a playlist, with the session or campaign list it was played from", () => {
    expect(originWords({ place: crown, playlistName: "The Company themes" }, names)).toBe("Playlist: The Company themes · The Sunken Crown");
    expect(originWords({ place: s14, playlistName: "Wistful with some warmth" }, names)).toBe("Playlist: Wistful with some warmth · Session 14: The Drowned Abbey");
    expect(originWords({ place: null, playlistName: "The Company themes" }, names)).toBe("Playlist: The Company themes");
  });
  it("a track on its own", () => {
    expect(originWords({ place: null, playlistName: null }, names)).toBe("Single track");
  });
});
