import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainLookup, DomainPlaylist, DomainTrack } from "../../../common/domain";
import { Mixer } from "../graph/mixer";
import { SourceLoader } from "../sources/sourceLoader";
import { encodeFakeAudio, FakeAudioContext, FakeNode } from "../testing/fakeAudio";
import { padPreview, playlistPreview, PreviewPlayer, PreviewState, trackPreview } from "./previewPlayer";
import { fakePreviewOutput } from "./testing/fakePreviewOutput";

/** The player page: its table output is what Discord records. */
let page: FakeAudioContext;
let mixer: Mixer;
/** The game master's headphones: a separate context. */
let headphones: FakeAudioContext;
let output: ReturnType<typeof fakePreviewOutput>;
let player: PreviewPlayer;
let changes: { state: PreviewState | null; announcement: string }[];

const track = (id: string, title: string, extra: Partial<DomainTrack> = {}): DomainTrack => ({
  id,
  kind: "music",
  title,
  metaTitle: "",
  fileName: `${id}.ogg`,
  durationMs: 60_000,
  role: null,
  loop: null,
  energy: null,
  tags: {},
  ...extra,
});
const media = (t: DomainTrack) => ({ url: `file:///music/${t.fileName}` });
const last = <T>(list: T[]): T | undefined => list[list.length - 1];

beforeEach(() => {
  page = new FakeAudioContext();
  mixer = new Mixer(page);
  mixer.outputs.table.connect(page.destination);
  headphones = new FakeAudioContext();
  output = fakePreviewOutput(headphones);
  for (const name of ["tavern", "storm", "rain"]) {
    headphones.mediaDurations.set(`file:///music/${name}.ogg`, 120);
  }
  const loader = new SourceLoader({
    context: headphones,
    createElement: () => headphones.createMediaElement(),
    fetchBytes: async (url) => (url.endsWith("door.wav") ? encodeFakeAudio(2, 1000) : null),
  });
  player = new PreviewPlayer({ output, scheduler: headphones.clock, load: (request) => loader.load(request) });
  changes = [];
  player.on("change", (state, announcement) => changes.push({ state, announcement }));
});

describe("PreviewPlayer (PRV-1): only the game master hears it", () => {
  it("plays a track on the preview output and never on the table mix that Discord records", async () => {
    const tavern = track("tavern", "Tavern");
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.flush();
    await headphones.advance(1);
    expect(headphones.signalAt(output.input as FakeNode)).toBeGreaterThan(0);
    expect(page.signalAt(mixer.outputs.table as unknown as FakeNode)).toBe(0);
    expect(page.signalAt(page.destination)).toBe(0);
    expect(player.current()).toEqual({ key: "tavern", label: "Tavern", kind: "track", trackId: "tavern", playlistId: null, padKey: null, from: null, paused: false, gainDb: 0 });
    expect(last(changes)?.announcement).toBe("Previewing in your headphones: Tavern");
  });

  it("cannot be wired into the player page's graph: the preview lives in another audio context", () => {
    expect(() => output.input.connect(mixer.outputs.table)).toThrow(/different audio contexts/);
  });

  it("plays one preview at a time: starting another stops the first", async () => {
    const tavern = track("tavern", "Tavern");
    const storm = track("storm", "Storm");
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.flush();
    player.toggle(trackPreview(storm, media(storm)));
    await headphones.flush();
    await headphones.advance(0.5);
    expect(headphones.elementsHoldingMedia()).toBe(1);
    expect(headphones.elements.find((e) => e.holdsMedia)?.src).toBe("file:///music/storm.ogg");
    expect(player.current()?.key).toBe("storm");
  });

  it("pressing Preview again on the same item stops it", async () => {
    const tavern = track("tavern", "Tavern");
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.flush();
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.advance(0.5);
    expect(player.current()).toBeNull();
    expect(headphones.elementsHoldingMedia()).toBe(0);
    expect(last(changes)).toEqual({ state: null, announcement: "Preview stopped" });
  });

  it("stop() stops whatever is previewing and frees it", async () => {
    const tavern = track("tavern", "Tavern");
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.flush();
    player.stop();
    await headphones.advance(0.5);
    expect(player.isPreviewing("tavern")).toBe(false);
    expect(headphones.connectedNodeCount()).toBe(2); // only the output's own input and the headphone volume remain wired
    player.stop(); // nothing playing: no second announcement
    expect(changes.filter((c) => c.announcement === "Preview stopped")).toHaveLength(1);
  });

  it("clears itself when the preview reaches its end", async () => {
    headphones.mediaDurations.set("file:///music/rain.ogg", 2);
    const rain = track("rain", "Rain");
    player.toggle(trackPreview(rain, media(rain)));
    await headphones.flush();
    await headphones.advance(3);
    expect(player.current()).toBeNull();
    expect(last(changes)?.state).toBeNull();
  });

  it("reports a preview that cannot play in plain words, and clears", async () => {
    headphones.failingUrls.add("file:///music/storm.ogg");
    const storm = track("storm", "Storm");
    player.toggle(trackPreview(storm, media(storm)));
    await headphones.flush();
    expect(player.current()).toBeNull();
    expect(last(changes)?.announcement).toBe("Could not play the preview of Storm.");
  });

  it("a pad's sound is decoded so it starts at once, and is named as a pad", async () => {
    player.toggle(padPreview({ boardId: "b1", padId: "p1", label: "Door", media: { url: "file:///fx/door.wav" } }));
    await headphones.flush();
    expect(player.current()).toMatchObject({ key: "pad:b1/p1", label: "Door (pad)", kind: "pad", padKey: "b1/p1" });
    expect(headphones.decodeCalls).toBe(1);
    expect(headphones.runningSourceCount()).toBe(1);
  });

  it("says where the preview is in its file, about twenty times a second, while it plays (the Audio profile's playhead)", async () => {
    const tavern = track("tavern", "Tavern");
    const positions: [string, number][] = [];
    player.on("position", (key, seconds) => positions.push([key, seconds]));
    player.play({ ...trackPreview(tavern, media(tavern)), options: { startAt: 30 } });
    await headphones.flush();
    await headphones.advance(1);
    expect(positions.length).toBeGreaterThanOrEqual(15);
    expect(last(positions)?.[0]).toBe("tavern");
    expect(last(positions)?.[1]).toBeCloseTo(31, 0);
    expect(player.position()).toEqual({ key: "tavern", seconds: expect.closeTo(31, 0) });
    player.stop();
    const count = positions.length;
    await headphones.advance(1);
    expect(positions).toHaveLength(count);
    expect(player.position()).toBeNull();
  });

  it("a quiet preview (the Audio profile says its own words) is not announced", async () => {
    const tavern = track("tavern", "Tavern");
    player.play({ ...trackPreview(tavern, media(tavern)), quiet: true });
    await headphones.flush();
    player.stop();
    expect(changes.map((c) => c.announcement)).toEqual(["", ""]);
    expect(changes[0].state).toMatchObject({ key: "tavern", label: "Tavern" });
  });

  it("a preview that cannot play says so, quiet or not, before it clears (review w3-polish 1)", async () => {
    headphones.failingUrls.add("file:///music/storm.ogg");
    const storm = track("storm", "Storm");
    const order: string[] = [];
    player.on("failed", (key, message) => order.push(`failed ${key}: ${message}`));
    player.on("change", (state) => order.push(`change ${state?.key ?? "none"}`));
    player.play({ ...trackPreview(storm, media(storm)), quiet: true });
    await headphones.flush();
    expect(order).toEqual(["change storm", "failed storm: Could not play the preview of Storm.", "change none"]);
  });

  it("dispose() stops the preview and lets go of listeners", async () => {
    const tavern = track("tavern", "Tavern");
    player.toggle(trackPreview(tavern, media(tavern)));
    await headphones.flush();
    const listener = vi.fn();
    player.on("change", listener);
    player.dispose();
    await headphones.advance(0.5);
    expect(headphones.elementsHoldingMedia()).toBe(0);
    expect(player.listenerCount("change")).toBe(0);
  });
});

describe("what a Preview button plays (prototype: core.js L.preview*)", () => {
  const tavern = track("tavern", "", { metaTitle: "Tavern (tags)" });
  const storm = track("storm", "Storm");
  const lookup = (playlists: DomainPlaylist[]): DomainLookup => ({
    track: (id) => [tavern, storm].find((t) => t.id === id),
    playlist: (id) => playlists.find((p) => p.id === id),
    tracks: () => [tavern, storm],
  });

  it("a track: keyed by its id, named by its title (or the title in its tags)", () => {
    expect(trackPreview(tavern, media(tavern))).toMatchObject({ key: "tavern", label: "Tavern (tags)" });
  });

  it("a playlist: its first track, named after the playlist and the track", () => {
    const pl: DomainPlaylist = { id: "pl1", name: "Night", lane: "music", kind: "manual", trackIds: ["storm", "tavern"] };
    const item = playlistPreview(pl, lookup([pl]), media);
    expect(item).toMatchObject({ key: "pl:pl1", label: "Night: Storm", media: { url: "file:///music/storm.ogg" } });
  });

  it("an empty playlist says so instead", () => {
    const pl: DomainPlaylist = { id: "pl2", name: "Empty", lane: "amb", kind: "manual", trackIds: [] };
    expect(playlistPreview(pl, lookup([pl]), media)).toEqual({ message: "This playlist has no tracks yet" });
  });
});
