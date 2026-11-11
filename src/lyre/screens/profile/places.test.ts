/**
 * Where a track plays (the "Settings for" choice) and what "the next track" is in each place, from the prototype's
 * sample data (profile.js places(), placeName(), contexts()).
 */
import { describe, expect, it } from "vitest";

import { prototypeSeed } from "../../../common/lyre/seed";
import { libraryView, nextContexts, placeName, placesOf, hasOwn, sceneOf } from "./places";

const seed = prototypeSeed();
const view = libraryView(seed.tracks, seed.playlists, seed.campaigns, seed.overrides);

describe("places", () => {
  it("lists the playlists a track is in and the scenes that play it, directly or through a playlist", () => {
    const { pls, scs } = placesOf("t13", view);
    expect(pls.map((p) => p.label)).toEqual(expect.arrayContaining(["Abbey: eerie, low energy", "Gothic dread"]));
    expect(pls.every((p) => p.key.startsWith("pl:"))).toBe(true);
    expect(scs).toContainEqual({ key: "sc:crown:s14:sc3", label: "The abbey ruins (The Sunken Crown, session 14)" });
    expect(new Set(scs.map((s) => s.key)).size).toBe(scs.length);
  });

  it("PLY-14: lists the session lists that keep the track on hand, or a playlist with it", () => {
    const { sss } = placesOf("t03", view);
    expect(sss).toContainEqual({ key: "ss:crown:s14", label: "Session 14: The Drowned Abbey (The Sunken Crown)" });
    expect(placeName("ss:crown:s14", view)).toBe("the session Session 14: The Drowned Abbey");
  });

  it("names a place in plain words", () => {
    expect(placeName("", view)).toBe("the track's own settings");
    expect(placeName("pl:p-gothic", view)).toBe("the playlist Gothic dread");
    expect(placeName("sc:crown:s14:sc3", view)).toBe("the scene The abbey ruins");
  });

  it("knows which places have their own settings (the track's own always counts)", () => {
    expect(hasOwn("t13", "", view.overrides)).toBe(true);
    expect(hasOwn("t13", "sc:crown:s14:sc3", view.overrides)).toBe(true);
    expect(hasOwn("t13", "pl:p-gothic", view.overrides)).toBe(false);
  });

  it("finds a scene from its key", () => {
    expect(sceneOf("sc:crown:s14:sc3", view)?.scene.name).toBe("The abbey ruins");
    expect(sceneOf("sc:crown:s14:nope", view)).toBeNull();
  });
});

describe("the next track", () => {
  it("in a scene with its own settings, is the next one in that scene's music", () => {
    const [c, ...rest] = nextContexts("t13", "sc:crown:s14:sc3", view);
    expect(rest).toEqual([]);
    expect(c.label).toBe("Next in the scene The abbey ruins");
    expect(c.next).not.toBe("t13");
    expect(c.place).toBe("sc:crown:s14:sc3");
  });

  it("for the track's own settings, comes from each place that uses them, and leaves out places with their own", () => {
    const list = nextContexts("t13", "", view);
    expect(list.length).toBeGreaterThan(1);
    expect(list.map((c) => c.place)).not.toContain("sc:crown:s14:sc3");
    expect(list.some((c) => c.label === "In the playlist Gothic dread")).toBe(true);
  });

  it("for a track no scene or playlist uses, is the next Library track of the same kind", () => {
    const lonely = seed.tracks.find((t) => t.kind === "music" && placesOf(t.id, view).pls.length === 0 && placesOf(t.id, view).scs.length === 0);
    expect(lonely).toBeDefined();
    const [c] = nextContexts(lonely!.id, "", view);
    expect(c).toMatchObject({ label: "The next track in the Library", place: "", lib: true });
  });
});
