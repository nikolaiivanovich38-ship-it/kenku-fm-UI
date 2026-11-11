/**
 * Audio profile overrides (PLY-12 data, DAT-11): a track can sound different
 * inside one playlist or in one scene. Stored per place, handed out keyed by
 * placeKey (src/common/domain) so resolveProfile can use them directly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placeKey, type ProfilePlace } from "../../../common/domain";
import { ValidationError } from "../errors";
import { makeTestStore } from "../test/testStore";
import { createTracks, deleteTracks } from "./tracks";
import { addTracksToPlaylist, createPlaylist, deletePlaylist, removePlaylistItems } from "./playlists";
import { createCampaign, createScene, createSession, deleteScene, moveScene } from "./campaigns";
import { clearProfileOverride, getProfileOverride, getProfileOverrides, setProfileOverride } from "./profiles";

let t: ReturnType<typeof makeTestStore>;
beforeEach(() => {
  t = makeTestStore();
});
afterEach(() => t.close());

function sample() {
  const [bed, other] = createTracks(t.store, [
    { title: "Eerie bed", file: { path: "/m/eerie.flac" }, durationMs: 441_000 },
    { title: "Bells", file: { path: "/m/bells.flac" } },
  ]);
  const playlist = createPlaylist(t.store, { title: "Abbey" });
  const campaign = createCampaign(t.store, { name: "Crown" });
  const session = createSession(t.store, { campaignId: campaign.id, name: "Abbey" });
  const scene = createScene(t.store, { sessionId: session.id, name: "Ruins" });
  const inPlaylist: ProfilePlace = { kind: "playlist", playlistId: playlist.id };
  const inScene: ProfilePlace = { kind: "scene", campaignId: campaign.id, sessionId: session.id, sceneId: scene.id };
  return { bed, other, playlist, campaign, session, scene, inPlaylist, inScene };
}

describe("audio profile overrides", () => {
  it("sets, replaces and clears an override per playlist and per scene", async () => {
    const s = sample();
    const sceneProfile = { endMs: 190_000, after: "next" as const, fadeOut: { ms: 8000, shape: 30 } };
    setProfileOverride(t.store, s.inScene, s.bed.id, sceneProfile);
    setProfileOverride(t.store, s.inPlaylist, s.bed.id, { endMs: 300_000 });
    setProfileOverride(t.store, s.inPlaylist, s.bed.id, { endMs: 250_000 }); // replaces
    setProfileOverride(t.store, s.inPlaylist, s.other.id, {});
    expect(getProfileOverride(t.store, s.inScene, s.bed.id)).toEqual(sceneProfile);
    expect(getProfileOverrides(t.store)).toEqual({
      [placeKey(s.inPlaylist)]: { [s.bed.id]: { endMs: 250_000 }, [s.other.id]: {} },
      [placeKey(s.inScene)]: { [s.bed.id]: sceneProfile },
    });
    expect(getProfileOverrides(t.store, { trackId: s.other.id })).toEqual({ [placeKey(s.inPlaylist)]: { [s.other.id]: {} } });
    clearProfileOverride(t.store, s.inPlaylist, s.bed.id);
    expect(getProfileOverride(t.store, s.inPlaylist, s.bed.id)).toBeNull();
    expect(() => clearProfileOverride(t.store, s.inPlaylist, s.bed.id)).toThrow(/No audio profile/);
  });

  it("forgets a track's own settings in a playlist once the track leaves it (review nice-to-have)", async () => {
    const s = sample();
    const [entry, again] = addTracksToPlaylist(t.store, s.playlist.id, [s.bed.id, s.bed.id]);
    setProfileOverride(t.store, s.inPlaylist, s.bed.id, { endMs: 300_000 });
    removePlaylistItems(t.store, [entry.id]);
    // Still in the playlist once: its settings there stay.
    expect(getProfileOverride(t.store, s.inPlaylist, s.bed.id)).toEqual({ endMs: 300_000 });
    removePlaylistItems(t.store, [again.id]);
    expect(getProfileOverride(t.store, s.inPlaylist, s.bed.id)).toBeNull();
  });

  it("0.5.1: keeps Start at with the profile (a marker's time, or null for the Beginning) and checks it", async () => {
    const s = sample();
    const profile = { markers: [{ atMs: 30_000, label: "Bells" }], startAtMs: 30_000 };
    setProfileOverride(t.store, s.inScene, s.bed.id, profile);
    expect(getProfileOverride(t.store, s.inScene, s.bed.id)).toEqual(profile);
    setProfileOverride(t.store, s.inScene, s.bed.id, { startAtMs: null });
    expect(getProfileOverride(t.store, s.inScene, s.bed.id)).toEqual({});
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { startAtMs: -1 })).toThrow(ValidationError);
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { startMs: 5000, endMs: 9000, startAtMs: 9500 })).toThrow(/Start at/);
  });

  it("checks the profile and the place", async () => {
    const s = sample();
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { loopCrossfadeMs: 1.5 })).toThrow(ValidationError);
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { startMs: 5000, endMs: 5000 })).toThrow(/end must come after the start/);
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { startMs: 5000, loopStartMs: 1000 })).toThrow(/loop cannot start before/);
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { endMs: 5000, loopStartMs: 6000 })).toThrow(/loop must start before the end/);
    expect(() => setProfileOverride(t.store, s.inScene, s.bed.id, { markers: "none" } as never)).toThrow(ValidationError);
    expect(() => setProfileOverride(t.store, { kind: "playlist", playlistId: "missing" }, s.bed.id, {})).toThrow(/No playlist/);
    expect(() => setProfileOverride(t.store, s.inPlaylist, "missing", {})).toThrow(/No track/);
    // The scene must be in that session of that campaign.
    const otherSession = createSession(t.store, { campaignId: s.campaign.id, name: "Other" });
    expect(() => setProfileOverride(t.store, { ...s.inScene, sessionId: otherSession.id } as ProfilePlace, s.bed.id, {})).toThrow(
      /not in that session/,
    );
    expect(() => setProfileOverride(t.store, { kind: "room" } as never, s.bed.id, {})).toThrow(ValidationError);
  });

  it("goes with its scene when the scene moves, and goes away with the scene, playlist or track", async () => {
    const s = sample();
    setProfileOverride(t.store, s.inScene, s.bed.id, { endMs: 1000 });
    setProfileOverride(t.store, s.inPlaylist, s.bed.id, { endMs: 2000 });
    setProfileOverride(t.store, s.inPlaylist, s.other.id, { endMs: 3000 });
    const later = createSession(t.store, { campaignId: s.campaign.id, name: "Later" });
    moveScene(t.store, s.scene.id, { sessionId: later.id, placement: "end" });
    const moved = placeKey({ kind: "scene", campaignId: s.campaign.id, sessionId: later.id, sceneId: s.scene.id });
    expect(Object.keys(getProfileOverrides(t.store))).toEqual([placeKey(s.inPlaylist), moved]);
    deleteScene(t.store, s.scene.id);
    await deleteTracks(t.store, [s.other.id]);
    expect(getProfileOverrides(t.store)).toEqual({ [placeKey(s.inPlaylist)]: { [s.bed.id]: { endMs: 2000 } } });
    deletePlaylist(t.store, s.playlist.id);
    expect(getProfileOverrides(t.store)).toEqual({});
  });
});
