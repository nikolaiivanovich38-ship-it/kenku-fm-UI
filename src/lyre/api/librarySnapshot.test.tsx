/**
 * LibrarySnapshot: the library as the audio host reads it (LyreAudioLibrary), answering at once from what it
 * loaded through LyreApi and kept current from change events.
 */
import { describe, expect, it, vi } from "vitest";

import { playlistTracks, sceneSequence } from "../../common/domain";
import type { LyreAudioLibrary } from "../audio/lyreAudio";
import type { LibraryTrack, LyreApi } from "../../common/lyre/api";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LibrarySnapshot } from "./librarySnapshot";

describe("LibrarySnapshot", () => {
  it("answers the audio host at once: tracks, playlists, scenes, profiles, file addresses and pads", async () => {
    const api = createFakeLyreApi();
    const library: LyreAudioLibrary = await LibrarySnapshot.load(api);
    expect([...library.tracks()]).toHaveLength(69);
    expect(library.track("t13").metaTitle).toBe("Bridge of Death");
    expect(playlistTracks(library.playlist("p-abbey-eerie"), library).map((t) => t.id)).toEqual(await api.playlists.tracks("p-abbey-eerie"));
    const scene = library.scene({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" });
    expect(scene.name).toBe("The abbey ruins");
    expect(sceneSequence(scene, library)[0].trackId).toBe("t13");
    expect(library.scene({ campaignId: "crown", sessionId: "s14", sceneId: "nope" })).toBeUndefined();
    expect(library.profileOverrides()["sc:crown:s14:sc3"].t13.endMs).toBe(190_000);
    expect(library.media(library.track("t01"))).toEqual({ url: "file:///H:/Audio/Scores/Basil%20Poledouris/Conan%20the%20Barbarian/1-11%20Riders%20of%20Doom.flac", trackId: "t01" });
    expect(library.media({ ...library.track("t01"), id: "gone" })).toBeNull();
    expect(library.pad("combat", "fireball")).toEqual({ label: "Fireball", trackIds: ["f03"], order: "roundrobin", mode: "oneshot", fadeMs: 1500, volume: 0.8 });
    expect(library.pad("weather", "mugs")).toMatchObject({ label: "Mugs clink" });
    expect(library.pad("combat", "nope")).toBeUndefined();
  });

  it("PLY-15, DAT-15: has the library's Normalise volume setting, each track's choice and loudness, and follows their changes", async () => {
    const api = createFakeLyreApi();
    const library = await LibrarySnapshot.load(api);
    expect(library.normaliseSettings()).toEqual({ on: false, target: "standard" });
    expect(library.track("t02").loudness).toEqual({ lufs: -22.6, truePeakDb: -8 });
    expect(library.playlist("p-ashen").normalise).toBe("on");
    await api.library.setNormaliseSettings({ on: true, target: "quiet" });
    await api.library.setNormalise("t02", "off");
    await vi.waitFor(() => expect(library.normaliseSettings()).toEqual({ on: true, target: "quiet" }));
    await vi.waitFor(() => expect(library.track("t02").normalise).toBe("off"));
    // A track measured in the background arrives with a "peaks" event (the fake measures loudness with the peaks).
    expect(library.track("t43").loudness).toBeNull();
    await api.library.peaksOf("t43");
    await vi.waitFor(() => expect(library.track("t43").loudness).not.toBeNull());
  });

  it("a pad that plays any effect with a tag plays every FX track with that tag", async () => {
    const api = createFakeLyreApi();
    await api.boards.updatePad("court", "glass", { sound: { kind: "tag", tag: { group: "mood", value: "Dread" } } });
    const library = await LibrarySnapshot.load(api);
    const dreadFx = (await api.library.listTracks()).filter((t) => (t.kind === "fx" || t.role === "sting") && t.tags.mood.includes("Dread")).map((t) => t.id);
    expect(dreadFx.length).toBeGreaterThan(1);
    expect(library.pad("court", "glass").trackIds).toEqual(dreadFx);
  });

  it("shows a change made through the API once its event arrives, and tells its listeners", async () => {
    const api = createFakeLyreApi();
    const library = await LibrarySnapshot.load(api);
    const changed = vi.fn();
    library.subscribe(changed);
    await api.library.updateTrack("t01", { title: "Riders" });
    await api.playlists.addTracks("p-after", ["t12"]);
    await api.sessions.updateScene({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, { name: "Ruins" });
    await api.boards.updatePad("combat", "fireball", { label: "Fire!" });
    await api.profiles.set("t13", null, { endMs: 300_000 });
    await vi.waitFor(() => {
      expect(library.track("t01").title).toBe("Riders");
      expect(playlistTracks(library.playlist("p-after"), library).map((t) => t.id)).toContain("t12");
      expect(library.scene({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" }).name).toBe("Ruins");
      expect(library.pad("combat", "fireball").label).toBe("Fire!");
      expect(library.track("t13").profile.endMs).toBe(300_000);
    });
    expect(changed).toHaveBeenCalled();
    await api.history.undo();
    await vi.waitFor(() => expect(library.track("t13").profile.endMs).toBe(318_000));
  });

  it("keeps the newest answer when an older reload arrives late, and stops following changes once disposed", async () => {
    const api = createFakeLyreApi();
    let delay = 0;
    const slowTracks: LyreApi = {
      ...api,
      library: {
        ...api.library,
        listTracks: async () => {
          const answer = await api.library.listTracks();
          const wait = delay;
          await new Promise((r) => setTimeout(r, wait));
          return answer;
        },
      },
    };
    const library = await LibrarySnapshot.load(slowTracks);
    delay = 50;
    await api.library.updateTrack("t01", { title: "First" });
    await new Promise((r) => setTimeout(r, 5));
    delay = 0;
    await api.library.updateTrack("t01", { title: "Second" });
    await vi.waitFor(() => expect(library.track("t01").title).toBe("Second"));
    await new Promise((r) => setTimeout(r, 80));
    expect(library.track("t01").title).toBe("Second");
    library.dispose();
    await api.library.updateTrack("t01", { title: "Third" });
    await new Promise((r) => setTimeout(r, 20));
    expect(library.track("t01").title).toBe("Second");
  });

  it("never shares objects with the API's answers", async () => {
    const api = createFakeLyreApi();
    const library = await LibrarySnapshot.load(api);
    const t: LibraryTrack = (await api.library.listTracks())[0];
    t.title = "Changed elsewhere";
    expect(library.track(t.id).title).not.toBe("Changed elsewhere");
  });
});
