import { describe, expect, it } from "vitest";

import { DomainTrack, placeKey, ProfilePlace } from "../../common/domain";
import { laneProfile, trackProfile } from "./trackProfile";

function track(over: Partial<DomainTrack> = {}): DomainTrack {
  return {
    id: "t1",
    kind: "music",
    title: "Theme",
    metaTitle: "",
    fileName: "theme.ogg",
    durationMs: 60_000,
    role: null,
    loop: null,
    energy: null,
    tags: {},
    ...over,
  };
}

const scene: ProfilePlace = { kind: "scene", campaignId: "c", sessionId: "s", sceneId: "sc" };
const playlist: ProfilePlace = { kind: "playlist", playlistId: "pl" };

describe("trackProfile: what a track does at its end when nothing says otherwise (PLY-4)", () => {
  it.each([
    ["loop_bed", null, "loop"],
    ["sting", "yes", "next"],
    ["transition", null, "next"],
    ["effect", null, "stop"],
    ["underscore", "yes", "loop"],
    ["underscore", "crossfade", "loop"],
    ["underscore", "no", "next"],
    [null, null, "next"],
  ] as const)("a %s with loop advice %s: %s", (role, loop, after) => {
    expect(trackProfile(track({ role, loop }), [], {}).profile.after).toBe(after);
  });

  it("the track's own profile wins over its role", () => {
    expect(trackProfile(track({ role: "sting", profile: { after: "loop" } }), [], {}).profile.after).toBe("loop");
  });

  it("a scene's own settings win over the playlist's, which win over the track's", () => {
    const t = track({ profile: { endMs: 50_000 } });
    const overrides = {
      [placeKey(playlist)]: { t1: { endMs: 40_000 } },
      [placeKey(scene)]: { t1: { endMs: 30_000 } },
    };
    expect(trackProfile(t, [scene, playlist], overrides)).toMatchObject({ source: "scene", profile: { endMs: 30_000 } });
    expect(trackProfile(t, [playlist], overrides)).toMatchObject({ source: "playlist", profile: { endMs: 40_000 } });
    expect(trackProfile(t, [], overrides)).toMatchObject({ source: "track", profile: { endMs: 50_000 } });
  });

  it("an override without its own 'after' still takes the role's", () => {
    const overrides = { [placeKey(playlist)]: { t1: { endMs: 40_000 } } };
    expect(trackProfile(track({ role: "loop_bed" }), [playlist], overrides).profile.after).toBe("loop");
  });
});

describe("laneProfile: what each lane asks of a track", () => {
  it("ambience always loops", () => {
    expect(laneProfile(track({ kind: "amb" }), "ambience", [], {}).after).toBe("loop");
    expect(laneProfile(track({ kind: "amb", profile: { after: "stop" } }), "ambience", [], {}).after).toBe("loop");
  });

  it("an effect plays once", () => {
    expect(laneProfile(track({ kind: "fx", loop: "yes" }), "effects", [], {}).after).toBe("stop");
  });

  it("music keeps the track's own choice", () => {
    expect(laneProfile(track({ role: "loop_bed" }), "music", [], {}).after).toBe("loop");
  });
});
