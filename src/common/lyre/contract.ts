/**
 * The LyreApi contract (WP5, wave 3), as a Vitest suite any implementation must pass: the in-memory fake now
 * (fake.test.ts), the main-process implementation later. Each implementation supplies a factory that returns a fresh
 * API seeded with the prototype's sample data (seed.ts) and an empty undo history, plus the few files it needs.
 *
 * The suite covers every method (a guard fails when one is never called), every refusal code, undo and redo,
 * change events, and that what the API returns agrees with the shared rules in src/common/domain: dynamic
 * playlists, scene order, profiles per place and "Used in".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  keyOfPlace,
  placeKey,
  playlistTracks,
  profilePlacesFor,
  reflowBoard,
  resolvePlayOrder,
  resolveProfile,
  shapeOf,
  trackNameIn,
  sceneSequence,
  usesOfBoard,
  usesOfPlaylist,
  usesOfTrack,
  normaliseLine,
  repeatsOneIn,
  tracksInPlaceOrder,
  folderPath,
  trackHasTag,
  usualPadSteps,
  usualSceneSteps,
  type CueStep,
  type ProfilePlace,
} from "../domain";
import { isRefused, LYRE_API_METHODS, REFUSAL_CODES, type Done, type LyreApi, type LyreArea, type LyreEvent, type RefusalCode, type SceneAddress, type WriteResult } from "./api";
import { lookupFrom, repeatOnesOf, tagTreeOf, trackNamesOf, withDividers } from "./lookup";
import { fileAddress } from "./media";

export interface ContractFixture {
  /** A fresh API over the prototype's sample data, with nothing to undo. */
  api: LyreApi;
  /** Two or more readable audio files outside the library; the first is in a folder named "Ambience". */
  newAudioFiles: string[];
  /** A path that is not an audio file (for example notes.txt). */
  notAudioFile: string;
  /** A sample track whose file is not where the library expects it. */
  missingTrackId: string;
  /** A folder that holds a file with the missing track's file name. */
  relinkFolder: string;
  /** A folder Lyre does not watch yet. */
  folderToWatch: string;
  /**
   * DAT-7: where Save to a file may write a .lyre file, and a file that is not a Lyre file, when the implementation
   * saves and opens files. Without it, save, open and bring in must refuse with "unavailable" (not built yet).
   */
  transferFiles?: { saveTo: string; notLyreFile: string };
  /**
   * UX-19: makes the library's next write fail as a full or read-only drive would (the test builds' "Make the next
   * save fail"), so the contract sees the "not-saved" refusal and Try again.
   */
  failNextWrite(): Promise<void> | void;
  close?(): Promise<void> | void;
}

/** Throws with the refusal's words when a write was refused, so a failing test says why. */
export function valueOf<T>(result: WriteResult<T>): T {
  if (isRefused(result)) throw new Error(`Refused (${result.refusal.code}): ${result.refusal.message}`);
  return (result as Done<T>).value;
}

function expectRefused(result: WriteResult<unknown>, code: RefusalCode): void {
  expect(result.ok, `expected a refusal "${code}"`).toBe(false);
  if (!isRefused(result)) return;
  expect(result.refusal.code).toBe(code);
  expect(result.refusal.message.length).toBeGreaterThan(5);
}

const last = <T>(list: readonly T[]): T => list[list.length - 1];

const CROWN = "crown";
const S14 = "s14";
const sc = (sceneId: string, sessionId = S14, campaignId = CROWN): SceneAddress => ({ campaignId, sessionId, sceneId });

export function lyreApiContract(name: string, makeFixture: () => Promise<ContractFixture> | ContractFixture): void {
  const called = new Set<string>();
  const refused = new Set<RefusalCode>();

  /** Wraps the API so the suite knows which methods and refusals it has exercised. */
  function recording(api: LyreApi): LyreApi {
    const wrapped: Record<string, unknown> = { subscribe: (l: (e: LyreEvent) => void) => api.subscribe(l) };
    for (const [area, methods] of Object.entries(LYRE_API_METHODS)) {
      const target = (api as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[area];
      const out: Record<string, unknown> = {};
      for (const method of methods) {
        out[method] = async (...args: unknown[]) => {
          called.add(`${area}.${method}`);
          const result = await target[method](...args);
          if (result && typeof result === "object" && (result as { ok?: boolean }).ok === false) refused.add((result as { refusal: { code: RefusalCode } }).refusal.code);
          return result;
        };
      }
      wrapped[area] = out;
    }
    return wrapped as unknown as LyreApi;
  }

  describe(`LyreApi contract: ${name}`, () => {
    let fx: ContractFixture;
    let api: LyreApi;
    let events: LyreEvent[];
    let stop: () => void;

    beforeEach(async () => {
      fx = await makeFixture();
      api = recording(fx.api);
      events = [];
      stop = api.subscribe((e) => events.push(e));
    });
    afterEach(async () => {
      stop?.();
      await fx.close?.();
    });

    /** Waits for a "changed" event naming every area given. */
    async function changedEvent(...areas: LyreArea[]) {
      await vi.waitFor(() => {
        const hit = events.some((e) => e.type === "changed" && areas.every((a) => e.areas.includes(a)));
        expect(hit, `a changed event for ${areas.join(", ")}`).toBe(true);
      });
    }
    async function lookup() {
      return lookupFrom(await api.library.listTracks(), await api.playlists.list());
    }
    async function scene(address: SceneAddress) {
      const c = await api.campaigns.get(address.campaignId);
      return c.sessions.find((s) => s.id === address.sessionId).scenes.find((x) => x.id === address.sceneId);
    }
    async function board(id: string) {
      return (await api.boards.list()).find((b) => b.id === id);
    }
    async function track(id: string) {
      return (await api.library.listTracks()).find((t) => t.id === id);
    }

    describe("library", () => {
      it("lists every sample track with its three names, folder, tags in groups and New mark", async () => {
        const tracks = await api.library.listTracks();
        expect(tracks).toHaveLength(69);
        expect(tracks.filter((t) => t.kind === "amb")).toHaveLength(10);
        expect(tracks.filter((t) => t.kind === "fx")).toHaveLength(14);
        const t01 = tracks.find((t) => t.id === "t01");
        expect(t01).toMatchObject({ metaTitle: "Riders of Doom", fileName: "1-11 Riders of Doom.flac", artist: "Basil Poledouris", album: "Conan the Barbarian", role: "sting", loop: "no", energy: 4, durationMs: 95_000, isNew: false });
        expect(t01.folder).toBe("H:\\Audio\\Scores\\Basil Poledouris\\Conan the Barbarian");
        expect(t01.tags).toEqual({ mood: ["Heroic", "Epic"], motif: ["The Company"], scene: ["Combat"] });
        const t43 = tracks.find((t) => t.id === "t43");
        expect(t43).toMatchObject({ title: "", isNew: true, energy: null, role: null, loop: null });
        expect(tracks.find((t) => t.id === "t13").profile).toMatchObject({ endMs: 318_000, after: "loop", loopStartMs: 64_000, loopCrossfadeMs: 2_000 });
      });

      it("gives each track the address the player loads its audio from", async () => {
        const t01 = await track("t01");
        expect(t01.url).toBe(fileAddress("H:\\Audio\\Scores\\Basil Poledouris\\Conan the Barbarian\\1-11 Riders of Doom.flac"));
        expect(t01.url).toBe("file:///H:/Audio/Scores/Basil%20Poledouris/Conan%20the%20Barbarian/1-11%20Riders%20of%20Doom.flac");
      });

      it("searches by the start of any word, in one lane, best matches first, with the total", async () => {
        const conan = await api.library.search({ text: "conan" });
        expect(new Set(conan.trackIds)).toEqual(new Set(["t01", "t31", "t32"]));
        expect((await api.library.search({ text: "conan grief" })).trackIds).toEqual(["t32"]);
        expect((await api.library.search({ text: "lothl" })).trackIds).toEqual(["t41"]);
        const door = await api.library.search({ text: "door", lane: "fx" });
        expect(new Set(door.trackIds)).toEqual(new Set(["f08", "f10"]));
        // FX is sound effects and stings; music is every music track, stings too (as the Library's filter shows them).
        const fx = await api.library.search({ text: "", lane: "fx", limit: 100 });
        expect(fx.trackIds).toContain("t01");
        expect(fx.total).toBe(14 + 5);
        const music = await api.library.search({ text: "", lane: "music", limit: 5 });
        expect(music.trackIds).toHaveLength(5);
        expect(music.total).toBe(45);
        expect((await api.library.search({ text: "", lane: "amb", limit: 100 })).trackIds).toHaveLength(10);
        expect((await api.library.search({ text: "zzzz" })).total).toBe(0);
      });

      it("changes a track's title, notes, energy, role, loop advice and kind, and refuses impossible values", async () => {
        const done = valueOf(await api.library.updateTrack("t02", { title: "Thin red line", notes: "Fade early", energy: 2, role: "underscore", loop: "crossfade" }));
        expect(done).toMatchObject({ id: "t02", title: "Thin red line", notes: "Fade early", energy: 2, loop: "crossfade" });
        expect(await track("t02")).toMatchObject({ title: "Thin red line", energy: 2 });
        await changedEvent("tracks", "history");
        expect(valueOf(await api.library.updateTrack("t44", { kind: "amb" })).kind).toBe("amb");
        expectRefused(await api.library.updateTrack("t02", { energy: 7 }), "invalid");
        expectRefused(await api.library.updateTrack("nope", { title: "x" }), "not-found");
      });

      it("clears the New mark once a new track has a title of its own and a tag", async () => {
        valueOf(await api.library.updateTrack("t43", { title: "Memories of Mother" }));
        expect((await track("t43")).isNew).toBe(true);
        valueOf(await api.tags.tagTracks({ trackIds: ["t43"], add: [{ group: "mood", value: "Grief" }] }));
        expect((await track("t43")).isNew).toBe(false);
      });

      it("lists the library folders", async () => {
        const folders = await api.library.listFolders();
        expect(folders.map((f) => f.path)).toEqual(expect.arrayContaining(["H:\\Audio\\Scores", "H:\\Audio\\Ambience", "H:\\Audio\\Effects"]));
        expect(folders.every((f) => typeof f.watched === "boolean")).toBe(true);
      });

      it("opens a track's folder, or says the file has gone", async () => {
        expectRefused(await api.library.showInFolder(fx.missingTrackId), "file-missing");
        expectRefused(await api.library.showInFolder("nope"), "not-found");
      });

      /** The track's peaks, waiting for them to be worked out (a "changed" event for "peaks" says when). */
      async function peaksWhenReady(trackId: string): Promise<number[]> {
        let levels = await api.library.peaksOf(trackId);
        if (levels === null) {
          await changedEvent("peaks");
          await vi.waitFor(async () => {
            levels = await api.library.peaksOf(trackId);
            expect(levels, "peaks after a changed event").not.toBeNull();
          });
        }
        return levels as number[];
      }

      it("works out a track's loudness peaks: about 1,000 levels from 0 to 1, the same each time it is asked", async () => {
        const { added } = valueOf(await api.import.start({ from: "paths", paths: [fx.newAudioFiles[1]] }));
        const levels = await peaksWhenReady(added[0]);
        expect(levels.length).toBeGreaterThanOrEqual(500);
        expect(levels.length).toBeLessThanOrEqual(4096);
        expect(levels.every((level) => typeof level === "number" && level >= 0 && level <= 1)).toBe(true);
        expect(new Set(levels).size, "a shape, not one even band").toBeGreaterThan(1);
        expect(await api.library.peaksOf(added[0])).toEqual(levels);
      });

      it("works out new tracks' peaks after an import without being asked", async () => {
        const { added } = valueOf(await api.import.start({ from: "paths", paths: fx.newAudioFiles }));
        await changedEvent("peaks");
        await vi.waitFor(async () => {
          for (const id of added) expect(await api.library.peaksOf(id), `peaks of ${id}`).not.toBeNull();
        });
      });

      it("has no peaks for a track it does not have", async () => {
        expect(await api.library.peaksOf("nope")).toBeNull();
      });
    });

    describe("tags", () => {
      it("lists the tag groups with their values in order", async () => {
        const groups = await api.tags.listGroups();
        expect(groups.map((g) => [g.id, g.name])).toEqual([["mood", "Mood"], ["motif", "Leitmotif"], ["scene", "Scene type"]]);
        expect(groups[1].values).toEqual(["The Company", "Drowned Abbess", "Ashen King", "Greyhollow"]);
      });

      it("adds tags to many tracks, finding a value in any letter case and creating a new one", async () => {
        const done = valueOf(await api.tags.tagTracks({ trackIds: ["t43", "t44"], add: [{ group: "mood", value: "eerie" }, { group: "mood", value: "haunted" }] }));
        expect(done.created).toEqual([{ group: "mood", value: "Haunted" }]);
        expect((await track("t43")).tags.mood).toEqual(["Eerie", "Haunted"]);
        expect((await api.tags.listGroups())[0].values).toContain("Haunted");
        await changedEvent("tracks", "tags", "history");
        valueOf(await api.tags.tagTracks({ trackIds: ["t43", "t44"], remove: [{ group: "mood", value: "Eerie" }] }));
        expect((await track("t44")).tags.mood).toEqual(["Haunted"]);
      });

      it("refuses an unknown group, an empty value and an unknown track", async () => {
        expectRefused(await api.tags.tagTracks({ trackIds: ["t01"], add: [{ group: "colour", value: "Red" }] }), "invalid");
        expectRefused(await api.tags.tagTracks({ trackIds: ["t01"], add: [{ group: "mood", value: "  " }] }), "invalid");
        expectRefused(await api.tags.tagTracks({ trackIds: ["nope"], add: [{ group: "mood", value: "Eerie" }] }), "not-found");
      });

      it("a dynamic playlist follows tags as they change", async () => {
        expect(await api.playlists.tracks("p-wistful")).not.toContain("t23");
        valueOf(await api.tags.tagTracks({ trackIds: ["t23"], add: [{ group: "mood", value: "Warm" }] }));
        expect(await api.playlists.tracks("p-wistful")).toContain("t23");
      });
    });

    describe("playlists", () => {
      it("lists every playlist in order, as domain playlists with notes", async () => {
        const list = await api.playlists.list();
        expect(list).toHaveLength(21);
        expect(list[0]).toMatchObject({ id: "p-company", kind: "manual", lane: "music", trackIds: ["t24", "t08", "t17", "t29", "t34", "t40"], notes: "" });
        expect(list.find((p) => p.id === "p-combat-big")).toMatchObject({ kind: "dynamic", rule: { energy: [4, 5], leaveOutStings: true } });
      });

      it("gives every playlist's tracks exactly as the shared rule playlistTracks does", async () => {
        const lk = await lookup();
        for (const pl of await api.playlists.list()) {
          expect(await api.playlists.tracks(pl.id), pl.id).toEqual(playlistTracks(pl, lk).map((t) => t.id));
        }
        expect(await api.playlists.tracks("p-abbey-eerie")).toEqual(["t13", "t14", "t21", "t42"]);
      });

      it("says which playlists hold a track, manual or by a dynamic rule, as playlistTracks does", async () => {
        const lk = await lookup();
        const lists = await api.playlists.list();
        for (const id of ["t13", "t39", "t01", "f04", "b01", "t43"]) {
          const expected = lists.filter((p) => playlistTracks(p, lk).some((t) => t.id === id)).map((p) => p.id);
          expect(new Set(await api.playlists.containing(id)), id).toEqual(new Set(expected));
        }
      });

      it("makes a manual or dynamic playlist at the top of the list", async () => {
        const m = valueOf(await api.playlists.create({ kind: "manual", lane: "music", name: "Harbour", trackIds: ["t05", "t16"] }));
        expect(m).toMatchObject({ name: "Harbour", kind: "manual", lane: "music", trackIds: ["t05", "t16"], notes: "" });
        const d = valueOf(await api.playlists.create({ kind: "dynamic", lane: "amb", name: "Wet places", rule: { conds: [{ group: "mood", match: "any", values: ["Melancholy"] }] } }));
        const list = await api.playlists.list();
        expect(list.slice(0, 2).map((p) => p.id)).toEqual([d.id, m.id]);
        expect(await api.playlists.tracks(d.id)).toEqual(["b01"]);
        await changedEvent("playlists", "history");
        expectRefused(await api.playlists.create({ kind: "manual", lane: "music", name: "  " }), "invalid");
        expectRefused(await api.playlists.create({ kind: "manual", lane: "music", name: "X", trackIds: ["nope"] }), "not-found");
      });

      it("renames, keeps notes and changes a dynamic rule, refusing a rule it cannot keep", async () => {
        expect(valueOf(await api.playlists.update("p-inn", { name: "The Gull and Lantern", notes: "Loud" }))).toMatchObject({ name: "The Gull and Lantern", notes: "Loud" });
        const rule = { conds: [{ group: "mood", match: "any" as const, values: ["Eerie"] }], energy: [0, 2] as [number, number] };
        valueOf(await api.playlists.update("p-gothic", { rule }));
        expect(await api.playlists.tracks("p-gothic")).toEqual(playlistTracks({ id: "p-gothic", name: "", lane: "music", kind: "dynamic", rule }, await lookup()).map((t) => t.id));
        // A condition still being written (no values) is kept and matches nothing.
        valueOf(await api.playlists.update("p-gothic", { rule: { conds: [{ group: "scene", match: "any", values: [] }] } }));
        expect(await api.playlists.tracks("p-gothic")).toEqual([]);
        expectRefused(await api.playlists.update("p-inn", { rule }), "wrong-kind");
        expectRefused(await api.playlists.update("p-gothic", { rule: { conds: [], energy: [4, 2] } }), "invalid");
        expectRefused(await api.playlists.update("p-gothic", { rule: { conds: [{ group: "colour", match: "any", values: ["Red"] }] } }), "invalid");
        expectRefused(await api.playlists.update("p-gothic", { rule: { conds: [{ group: "mood", match: "any", values: ["Not a tag"] }] } }), "invalid");
        expectRefused(await api.playlists.update("p-inn", { name: "" }), "invalid");
        expectRefused(await api.playlists.update("nope", { notes: "x" }), "not-found");
      });

      it("freezes a dynamic playlist into a manual copy placed after it", async () => {
        const before = await api.playlists.tracks("p-abbey-eerie");
        const copy = valueOf(await api.playlists.copyAsManual("p-abbey-eerie"));
        expect(copy).toMatchObject({ name: "Abbey: eerie, low energy (manual)", kind: "manual", lane: "music", trackIds: before });
        const ids = (await api.playlists.list()).map((p) => p.id);
        expect(ids.indexOf(copy.id)).toBe(ids.indexOf("p-abbey-eerie") + 1);
        expectRefused(await api.playlists.copyAsManual("nope"), "not-found");
      });

      it("deletes a playlist and takes it out of every campaign, session, scene and place's own settings", async () => {
        valueOf(await api.profiles.set("t41", { kind: "playlist", playlistId: "p-abbess" }, { endMs: 100_000 }));
        expect((await api.campaigns.usesOf({ kind: "playlist", id: "p-abbess" })).length).toBeGreaterThan(0);
        valueOf(await api.playlists.delete("p-abbess"));
        expect((await api.playlists.list()).some((p) => p.id === "p-abbess")).toBe(false);
        expect(await api.campaigns.usesOf({ kind: "playlist", id: "p-abbess" })).toEqual([]);
        expect((await scene(sc("sc3"))).music.some((r) => r.id === "p-abbess")).toBe(false);
        expect((await api.profiles.overrides())["pl:p-abbess"]).toBeUndefined();
        expect(await track("t41")).toBeDefined();
        await changedEvent("playlists", "campaigns");
        expectRefused(await api.playlists.delete("p-abbess"), "not-found");
      });

      it("adds tracks to a manual playlist at the end or at a place, never twice", async () => {
        expect(valueOf(await api.playlists.addTracks("p-after", ["t12", "t07"]))).toEqual({ added: ["t12"], alreadyIn: ["t07"] });
        valueOf(await api.playlists.addTracks("p-after", ["t15"], 1));
        expect(await api.playlists.tracks("p-after")).toEqual(["t07", "t15", "t32", "t09", "t12"]);
        expectRefused(await api.playlists.addTracks("p-wistful", ["t12"]), "wrong-kind");
        expectRefused(await api.playlists.addTracks("p-after", ["nope"]), "not-found");
      });

      it("removes and reorders tracks in a manual playlist", async () => {
        valueOf(await api.playlists.removeTrack("p-after", "t32"));
        expect(await api.playlists.tracks("p-after")).toEqual(["t07", "t09"]);
        valueOf(await api.playlists.moveTrack("p-company", "t40", 0));
        expect((await api.playlists.tracks("p-company"))[0]).toBe("t40");
        valueOf(await api.playlists.moveTrack("p-company", "t40", 99));
        expect(last((await api.playlists.tracks("p-company")))).toBe("t40");
        expectRefused(await api.playlists.removeTrack("p-after", "t32"), "not-found");
        expectRefused(await api.playlists.moveTrack("p-wistful", "t33", 0), "wrong-kind");
      });
    });

    describe("pad boards", () => {
      it("lists every board with its grid, pads and spare pads", async () => {
        const boards = await api.boards.list();
        expect(boards.map((b) => b.id)).toEqual(["combat", "weather", "abbey", "spells", "court"]);
        const combat = boards[0];
        expect(combat).toMatchObject({ name: "Combat", cols: 4, rows: 3, spare: [] });
        expect(combat.slots).toHaveLength(12);
        expect(combat.slots[11]).toBeNull();
        expect(combat.slots[4]).toMatchObject({ id: "fireball", label: "Fireball", key: "q", mode: "oneshot", color: "ember", sound: { kind: "variants", order: "in_turn" } });
        expect(boards[1].spare.map((p) => p.id)).toEqual(["mugs"]);
        expect(boards[1].slots[0].sound.trackIds).toEqual(["f04"]);
      });

      it("makes a board with an empty grid, renames it, and refuses a grid it cannot have", async () => {
        const b = valueOf(await api.boards.create({ name: "Harbour at night", cols: 3, rows: 2 }));
        expect(b).toMatchObject({ name: "Harbour at night", cols: 3, rows: 2, spare: [] });
        expect(b.slots).toEqual([null, null, null, null, null, null]);
        expect(valueOf(await api.boards.rename(b.id, "Docks")).name).toBe("Docks");
        await changedEvent("boards", "history");
        expectRefused(await api.boards.create({ name: "Big", cols: 9, rows: 2 }), "invalid");
        expectRefused(await api.boards.rename(b.id, " "), "invalid");
        expectRefused(await api.boards.rename("nope", "x"), "not-found");
      });

      it("resizes as reflowBoard packs the pads; only what does not fit goes to spare, it comes back when the grid grows, and undo puts it all back", async () => {
        const done = valueOf(await api.boards.resize("abbey", 3, 3));
        expect(done.movedToSpare).toEqual(["splash", "scream", "heartab"]);
        expect(done.cameBack).toEqual([]);
        expect(done.board.slots.map((p) => p?.id ?? null)).toEqual(["bell", "bells", "whisper", "organ", "choir", "drip", "chains", "stonedoor", "slam"]);
        expect(done.board.spare.map((p) => [p.id, p.aside])).toEqual([["splash", false], ["scream", false], ["heartab", false]]);
        const wider = valueOf(await api.boards.resize("abbey", 5, 3));
        expect(wider.cameBack).toEqual(["splash", "scream", "heartab"]);
        expect(wider.board.slots.map((p) => p?.id ?? null)).toEqual(["bell", "bells", "whisper", "organ", "choir", "drip", "chains", "stonedoor", "slam", "splash", "scream", "heartab", null, null, null]);
        valueOf(await api.history.undo());
        valueOf(await api.history.undo());
        const back = await board("abbey");
        expect([back.cols, back.rows, back.spare.length]).toEqual([4, 3, 0]);
        expect(back.slots[3].id).toBe("organ");
        expectRefused(await api.boards.resize("abbey", 0, 3), "invalid");
        expectRefused(await api.boards.resize("nope", 2, 2), "not-found");
      });

      it("duplicates a board with new pads, used nowhere yet, after the original", async () => {
        const copy = valueOf(await api.boards.duplicate("spells"));
        expect(copy.name).toBe("Spellwork (copy)");
        expect(copy.slots.map((p) => p?.label ?? null)).toEqual((await board("spells")).slots.map((p) => p?.label ?? null));
        expect(copy.slots[0].id).not.toBe("spark");
        expect(await api.campaigns.usesOf({ kind: "board", id: copy.id })).toEqual([]);
        const ids = (await api.boards.list()).map((b) => b.id);
        expect(ids.indexOf(copy.id)).toBe(ids.indexOf("spells") + 1);
      });

      it("deletes a board and takes it out of every campaign, session and scene", async () => {
        valueOf(await api.boards.delete("combat"));
        expect(await board("combat")).toBeUndefined();
        expect(await api.campaigns.usesOf({ kind: "board", id: "combat" })).toEqual([]);
        expect((await scene(sc("sc4"))).boardIds).toEqual(["abbey"]);
        await changedEvent("boards", "campaigns");
        expectRefused(await api.boards.delete("combat"), "not-found");
      });

      it("adds a pad in an empty place only", async () => {
        const pad = valueOf(await api.boards.addPad("combat", 11));
        expect(pad).toMatchObject({ label: "New pad", key: "", mode: "oneshot", sound: { kind: "single", trackIds: [] } });
        expect((await board("combat")).slots[11].id).toBe(pad.id);
        expectRefused(await api.boards.addPad("combat", 0), "invalid");
        expectRefused(await api.boards.addPad("combat", 12), "invalid");
      });

      it("changes a pad's label, sound, mode, key, colour, icon, volume and fade, refusing what a pad cannot have", async () => {
        const pad = valueOf(await api.boards.updatePad("combat", "shield", { label: "Shield bash", mode: "retrigger", key: "Z", color: "moss", icon: "star", volume: 0.5, fadeOutMs: 500, sound: { kind: "variants", trackIds: ["f01", "f12"], order: "in_turn" } }));
        expect(pad).toMatchObject({ label: "Shield bash", mode: "retrigger", key: "z", color: "moss", icon: "star", volume: 0.5, fadeOutMs: 500, sound: { kind: "variants", trackIds: ["f01", "f12"], order: "in_turn", tag: null } });
        expect(valueOf(await api.boards.updatePad("combat", "shield", { key: "F5" })).key).toBe("F5");
        expect(valueOf(await api.boards.updatePad("combat", "shield", { sound: { kind: "tag", tag: { group: "mood", value: "Tense" } } })).sound).toMatchObject({ kind: "tag", tag: { group: "mood", value: "Tense" } });
        // Two pads may share a key (the editor warns); taking it from the other pad clears that pad's key.
        valueOf(await api.boards.updatePad("combat", "shield", { key: "q" }));
        expect(valueOf(await api.boards.updatePad("combat", "fireball", { key: "" })).key).toBe("");
        expectRefused(await api.boards.updatePad("combat", "shield", { key: "ab" }), "invalid");
        expectRefused(await api.boards.updatePad("combat", "shield", { volume: 2 }), "invalid");
        expectRefused(await api.boards.updatePad("combat", "shield", { color: "pink" as never }), "invalid");
        expectRefused(await api.boards.updatePad("combat", "shield", { label: "" }), "invalid");
        expectRefused(await api.boards.updatePad("combat", "shield", { sound: { trackIds: ["nope"] } }), "not-found");
        expectRefused(await api.boards.updatePad("combat", "nope", { label: "x" }), "not-found");
      });

      it("duplicates a pad without its key into the next empty place, or spare when the grid is full", async () => {
        const one = valueOf(await api.boards.duplicatePad("combat", "sword"));
        expect(one.place).toEqual({ slot: 11 });
        expect(one.pad).toMatchObject({ label: "Sword clash (copy)", key: "" });
        const two = valueOf(await api.boards.duplicatePad("combat", "sword"));
        expect(two.place).toBe("spare");
        expect((await board("combat")).spare.map((p) => p.id)).toEqual([two.pad.id]);
      });

      it("moves pads: onto another pad swaps them; from spare onto a pad sends that pad to spare", async () => {
        expect(valueOf(await api.boards.movePad("combat", "sword", { slot: 1 })).swappedWith).toBe("arrows");
        let b = await board("combat");
        expect([b.slots[0].id, b.slots[1].id]).toEqual(["arrows", "sword"]);
        valueOf(await api.boards.movePad("combat", "horn", "spare"));
        b = await board("combat");
        expect(b.slots[10]).toBeNull();
        expect(b.spare.map((p) => p.id)).toEqual(["horn"]);
        expect(valueOf(await api.boards.movePad("combat", "horn", { slot: 0 })).swappedWith).toBe("arrows");
        b = await board("combat");
        expect(b.slots[0].id).toBe("horn");
        expect(b.spare.map((p) => p.id)).toEqual(["arrows"]);
        expectRefused(await api.boards.movePad("combat", "horn", { slot: 40 }), "invalid");
        expectRefused(await api.boards.movePad("combat", "nope", "spare"), "not-found");
      });

      it("puts spare pads back into empty places, in order", async () => {
        expect(valueOf(await api.boards.putAllBack("weather")).putBack).toEqual([]);
        valueOf(await api.boards.resize("weather", 4, 3));
        expect(valueOf(await api.boards.putAllBack("weather")).putBack).toEqual(["mugs"]);
        const b = await board("weather");
        expect(b.slots[8].id).toBe("mugs");
        expect(b.spare).toEqual([]);
      });

      it("deletes a pad", async () => {
        valueOf(await api.boards.deletePad("weather", "mugs"));
        valueOf(await api.boards.deletePad("weather", "owl"));
        const b = await board("weather");
        expect(b.spare).toEqual([]);
        expect(b.slots[2]).toBeNull();
        expectRefused(await api.boards.deletePad("weather", "owl"), "not-found");
      });
    });

    describe("campaigns", () => {
      it("lists whole campaign trees: sessions with number, date and status, scenes with music, ambience and boards", async () => {
        const list = await api.campaigns.list();
        expect(list.map((c) => c.id)).toEqual(["crown", "sixth", "masks"]);
        const crown = list[0];
        expect(crown).toMatchObject({ name: "The Sunken Crown", system: "D&D 5e", theme: "hearth", description: "A drowned kingdom, a crown under the sea and a company of five.", playlistIds: ["p-company", "p-ashen", "p-combat-big", "x-stings"], boardIds: ["combat", "weather"] });
        expect(crown.obsidian).toEqual({ vault: "Tabletop", note: "Campaigns/The Sunken Crown/Overview.md", sessionsFolder: "Campaigns/The Sunken Crown/Sessions" });
        expect(crown.sessions.map((s) => [s.number, s.status, s.date])).toEqual([[12, "played", "2026-10-08"], [13, "played", "2026-10-22"], [14, "next", "2026-11-05"], [15, "draft", null]]);
        const sc3 = crown.sessions[2].scenes[2];
        expect(sc3).toMatchObject({ id: "sc3", name: "The abbey ruins", startsWhen: "They crest the cliff path", ambience: { kind: "playlist", id: "a-abbey" }, boardIds: ["abbey", "weather"] });
        expect(sc3.music).toEqual([{ kind: "track", id: "t13" }, { kind: "playlist", id: "p-abbey-eerie" }, { kind: "track", id: "t42" }, { kind: "playlist", id: "p-abbess" }]);
        expect((await api.campaigns.get("crown")).sessions[2].scenes).toHaveLength(6);
        expect(await api.campaigns.get("nope")).toBeNull();
      });

      it("makes a campaign with a first draft session holding an opening scene, and asks for a name", async () => {
        const c = valueOf(await api.campaigns.create({ name: "Curse of Strahd", system: "D&D 5e" }));
        expect(c).toMatchObject({ name: "Curse of Strahd", system: "D&D 5e", theme: "candle", description: "", playlistIds: [], boardIds: [] });
        expect(c.sessions).toHaveLength(1);
        expect(c.sessions[0]).toMatchObject({ number: 1, status: "draft", name: "" });
        expect(c.sessions[0].scenes.map((s) => s.name)).toEqual(["Opening scene"]);
        expect(last((await api.campaigns.list())).id).toBe(c.id);
        await changedEvent("campaigns", "history");
        const refused = await api.campaigns.create({ name: "  " });
        expectRefused(refused, "invalid");
        if (isRefused(refused)) expect(refused.refusal.field).toBe("name");
      });

      it("changes a campaign's details and refuses a theme it does not have", async () => {
        const c = valueOf(await api.campaigns.update("sixth", { name: "Sixth Year", theme: "parchment", description: "Secrets", notes: "Owls", obsidian: { vault: "V", note: "N.md", sessionsFolder: "S" } }));
        expect(c).toMatchObject({ name: "Sixth Year", theme: "parchment", description: "Secrets", notes: "Owls", obsidian: { vault: "V", note: "N.md", sessionsFolder: "S" } });
        expectRefused(await api.campaigns.update("sixth", { theme: "neon" as never }), "invalid");
        expectRefused(await api.campaigns.update("nope", { notes: "x" }), "not-found");
      });

      it("keeps playlists and boards on hand for a campaign or one session, in order", async () => {
        valueOf(await api.campaigns.setOnHand({ campaignId: "crown" }, "playlists", ["x-stings", "p-company"]));
        valueOf(await api.campaigns.setOnHand({ campaignId: "crown", sessionId: "s14" }, "boards", ["spells", "abbey"]));
        const crown = await api.campaigns.get("crown");
        expect(crown.playlistIds).toEqual(["x-stings", "p-company"]);
        expect(crown.sessions[2].boardIds).toEqual(["spells", "abbey"]);
        expectRefused(await api.campaigns.setOnHand({ campaignId: "crown" }, "boards", ["nope"]), "not-found");
        expectRefused(await api.campaigns.setOnHand({ campaignId: "crown", sessionId: "nope" }, "boards", []), "not-found");
      });

      it("0.5.1: moves a campaign in the Campaigns screen's order, which is kept", async () => {
        const before = (await api.campaigns.list()).map((c) => c.id);
        const last = before[before.length - 1];
        valueOf(await api.campaigns.move(last, 0));
        expect((await api.campaigns.list()).map((c) => c.id)).toEqual([last, ...before.slice(0, -1)]);
        valueOf(await api.campaigns.move(last, before.length - 1));
        expect((await api.campaigns.list()).map((c) => c.id)).toEqual(before);
        expectRefused(await api.campaigns.move("nope", 0), "not-found");
      });

      it("says where every playlist, board and track is used, as the shared rules do", async () => {
        const campaigns = await api.campaigns.list();
        for (const p of await api.playlists.list()) expect(await api.campaigns.usesOf({ kind: "playlist", id: p.id }), p.id).toEqual(usesOfPlaylist(p.id, campaigns));
        for (const b of await api.boards.list()) expect(await api.campaigns.usesOf({ kind: "board", id: b.id }), b.id).toEqual(usesOfBoard(b.id, campaigns));
        for (const id of ["t13", "t39", "t40", "b02", "t01", "t02"]) expect(await api.campaigns.usesOf({ kind: "track", id }), id).toEqual(usesOfTrack(id, campaigns));
      });

      it("Use in…: exactly the ticked places use a playlist or board afterwards", async () => {
        valueOf(await api.campaigns.setUses({ kind: "playlist", id: "p-halls" }, [{ campaignId: "crown" }, { campaignId: "crown", sessionId: "s14", sceneId: "sc1" }]));
        expect(await api.campaigns.usesOf({ kind: "playlist", id: "p-halls" })).toEqual([
          { level: "campaign", campaignId: "crown" },
          { level: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc1", role: "music", position: 1 },
        ]);
        // An ambience playlist becomes the scene's ambience; unticking a scene takes it out.
        valueOf(await api.campaigns.setUses({ kind: "playlist", id: "a-hall" }, [{ campaignId: "crown", sessionId: "s14", sceneId: "sc2" }]));
        expect((await scene(sc("sc2"))).ambience).toEqual({ kind: "playlist", id: "a-hall" });
        expect((await scene(sc("y1", "w3", "sixth"))).ambience).toBeNull();
        valueOf(await api.campaigns.setUses({ kind: "board", id: "court" }, [{ campaignId: "crown", sessionId: "s15" }]));
        expect(await api.campaigns.usesOf({ kind: "board", id: "court" })).toEqual([{ level: "session", campaignId: "crown", sessionId: "s15" }]);
        expectRefused(await api.campaigns.setUses({ kind: "board", id: "nope" }, []), "not-found");
        expectRefused(await api.campaigns.setUses({ kind: "board", id: "court" }, [{ campaignId: "nope" }]), "not-found");
      });
    });

    describe("sessions and scenes", () => {
      it("adds the next session: next when the campaign has none, else a draft", async () => {
        const s16 = valueOf(await api.sessions.create("crown"));
        expect(s16).toMatchObject({ number: 16, status: "draft", campaignId: "crown" });
        expect(s16.scenes.map((s) => s.name)).toEqual(["Opening scene"]);
        const c = valueOf(await api.campaigns.create({ name: "One-shot" }));
        expect(valueOf(await api.sessions.create(c.id))).toMatchObject({ number: 2, status: "next" });
        expectRefused(await api.sessions.create("nope"), "not-found");
      });

      it("changes a session; making one next makes the old next played or draft", async () => {
        valueOf(await api.sessions.update("crown", "s15", { status: "next", name: "Black sails!", date: "2026-11-26" }));
        let crown = await api.campaigns.get("crown");
        expect(crown.sessions.map((s) => s.status)).toEqual(["played", "played", "played", "next"]);
        valueOf(await api.sessions.update("crown", "s12", { status: "next" }));
        crown = await api.campaigns.get("crown");
        expect(crown.sessions.map((s) => s.status)).toEqual(["next", "played", "played", "draft"]);
        expect(valueOf(await api.sessions.update("crown", "s15", { date: null, noteLink: "Sessions/15.md" }))).toMatchObject({ date: null, noteLink: "Sessions/15.md" });
        expectRefused(await api.sessions.update("crown", "s15", { date: "5 Nov" }), "invalid");
        expectRefused(await api.sessions.update("crown", "nope", { name: "x" }), "not-found");
      });

      it("moves a session and renumbers the sessions in their new order", async () => {
        valueOf(await api.sessions.move("crown", "s15", 0));
        const crown = await api.campaigns.get("crown");
        expect(crown.sessions.map((s) => [s.id, s.number])).toEqual([["s15", 12], ["s12", 13], ["s13", 14], ["s14", 15]]);
        expectRefused(await api.sessions.move("crown", "nope", 0), "not-found");
      });

      it("adds, changes, moves, duplicates and deletes scenes", async () => {
        const added = valueOf(await api.sessions.createScene("crown", "s14", "sc2"));
        expect(added).toMatchObject({ name: "New scene", music: [], ambience: null, boardIds: [] });
        let ids = (await api.campaigns.get("crown")).sessions[2].scenes.map((s) => s.id);
        expect(ids.indexOf(added.id)).toBe(2);
        const end = valueOf(await api.sessions.createScene("crown", "s14"));
        ids = (await api.campaigns.get("crown")).sessions[2].scenes.map((s) => s.id);
        expect(last(ids)).toBe(end.id);
        expect(valueOf(await api.sessions.updateScene(sc(added.id), { name: "Storm", startsWhen: "Lightning", notes: "Loud", noteLink: "n.md" }))).toMatchObject({ name: "Storm", startsWhen: "Lightning", notes: "Loud", noteLink: "n.md" });
        valueOf(await api.sessions.moveScene(sc(added.id), 0));
        expect((await api.campaigns.get("crown")).sessions[2].scenes[0].id).toBe(added.id);
        const copy = valueOf(await api.sessions.duplicateScene(sc("sc3")));
        expect(copy).toMatchObject({ name: "The abbey ruins (copy)", music: (await scene(sc("sc3"))).music, boardIds: ["abbey", "weather"] });
        ids = (await api.campaigns.get("crown")).sessions[2].scenes.map((s) => s.id);
        expect(ids.indexOf(copy.id)).toBe(ids.indexOf("sc3") + 1);
        valueOf(await api.sessions.deleteScene(sc("sc3")));
        expect(await scene(sc("sc3"))).toBeUndefined();
        expect((await api.profiles.overrides())["sc:crown:s14:sc3"]).toBeUndefined();
        await changedEvent("campaigns", "profiles");
        expectRefused(await api.sessions.deleteScene(sc("sc3")), "not-found");
        expectRefused(await api.sessions.updateScene(sc("sc3"), { name: "x" }), "not-found");
        expectRefused(await api.sessions.createScene("crown", "s14", "nope"), "not-found");
      });

      it("keeps a scene's music in the order given, and its playing order is the shared sceneSequence", async () => {
        const music = [{ kind: "playlist" as const, id: "p-after" }, { kind: "track" as const, id: "t40" }, { kind: "playlist" as const, id: "x-stings" }];
        valueOf(await api.sessions.setSceneMusic(sc("sc6"), music));
        const s6 = await scene(sc("sc6"));
        expect(s6.music).toEqual(music);
        const seq = sceneSequence(s6, await lookup());
        const expected = [...(await api.playlists.tracks("p-after")), "t40", ...(await api.playlists.tracks("x-stings"))];
        expect(seq.map((x) => x.trackId)).toEqual(expected);
        expectRefused(await api.sessions.setSceneMusic(sc("sc6"), [{ kind: "playlist", id: "a-abbey" }]), "wrong-kind");
        expectRefused(await api.sessions.setSceneMusic(sc("sc6"), [{ kind: "track", id: "b01" }]), "wrong-kind");
        expectRefused(await api.sessions.setSceneMusic(sc("sc6"), [{ kind: "track", id: "nope" }]), "not-found");
      });

      it("gives a scene one ambience track or ambience playlist, or none", async () => {
        valueOf(await api.sessions.setSceneAmbience(sc("sc1"), { kind: "track", id: "b05" }));
        expect((await scene(sc("sc1"))).ambience).toEqual({ kind: "track", id: "b05" });
        valueOf(await api.sessions.setSceneAmbience(sc("sc1"), null));
        expect((await scene(sc("sc1"))).ambience).toBeNull();
        expectRefused(await api.sessions.setSceneAmbience(sc("sc1"), { kind: "track", id: "t01" }), "wrong-kind");
        expectRefused(await api.sessions.setSceneAmbience(sc("sc1"), { kind: "playlist", id: "p-inn" }), "wrong-kind");
      });

      it("keeps a scene's pad boards in order", async () => {
        valueOf(await api.sessions.setSceneBoards(sc("sc1"), ["spells", "weather"]));
        expect((await scene(sc("sc1"))).boardIds).toEqual(["spells", "weather"]);
        expectRefused(await api.sessions.setSceneBoards(sc("sc1"), ["nope"]), "not-found");
      });
    });

    describe("audio profiles", () => {
      it("gives each place's own settings, and resolveProfile picks the scene's before the playlist's and the track's", async () => {
        const overrides = await api.profiles.overrides();
        expect(overrides["sc:crown:s14:sc3"].t13).toMatchObject({ endMs: 190_000, after: "next" });
        const scenePlace: ProfilePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
        const playlistPlace: ProfilePlace = { kind: "playlist", playlistId: "p-abbey-eerie" };
        valueOf(await api.profiles.set("t13", playlistPlace, { endMs: 250_000, after: "stop" }));
        const after = await api.profiles.overrides();
        expect(after[placeKey(playlistPlace)].t13).toMatchObject({ endMs: 250_000, after: "stop" });
        const t13 = await track("t13");
        expect(resolveProfile(t13, [scenePlace, playlistPlace], after)).toMatchObject({ source: "scene", profile: { endMs: 190_000 } });
        expect(resolveProfile(t13, [playlistPlace], after)).toMatchObject({ source: "playlist", profile: { endMs: 250_000, after: "stop" } });
        expect(resolveProfile(t13, [], after)).toMatchObject({ source: "track", profile: { endMs: 318_000 } });
        await changedEvent("profiles", "history");
      });

      it("changes a track's own profile, which the track then carries", async () => {
        valueOf(await api.profiles.set("t05", null, { startMs: 2_000, endMs: 150_000, fadeOut: { ms: 3_000, shape: 20 } }));
        expect((await track("t05")).profile).toMatchObject({ startMs: 2_000, endMs: 150_000, fadeOut: { ms: 3_000, shape: 20 } });
        await changedEvent("tracks", "profiles");
      });

      it("0.5.1: keeps Start at with a profile, the track's own or a place's; null is the Beginning", async () => {
        valueOf(await api.profiles.set("t05", null, { markers: [{ atMs: 30_000, label: "Bells" }], startAtMs: 30_000 }));
        expect((await track("t05")).profile).toMatchObject({ startAtMs: 30_000 });
        const place: ProfilePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
        valueOf(await api.profiles.set("t05", place, { startAtMs: null }));
        expect((await api.profiles.overrides())[placeKey(place)].t05.startAtMs ?? null).toBeNull();
        expectRefused(await api.profiles.set("t05", null, { startAtMs: -5 }), "invalid");
      });

      it("refuses a profile that cannot play, an unknown track or place", async () => {
        expectRefused(await api.profiles.set("t05", null, { startMs: 50_000, endMs: 40_000 }), "invalid");
        expectRefused(await api.profiles.set("t05", null, { startMs: 10_000, endMs: 40_000, loopStartMs: 45_000 }), "invalid");
        expectRefused(await api.profiles.set("t05", null, { fadeIn: { ms: 1_000, shape: 120 } }), "invalid");
        expectRefused(await api.profiles.set("t05", null, { fadeIn: { ms: -1, shape: 50 } }), "invalid");
        expectRefused(await api.profiles.set("nope", null, {}), "not-found");
        expectRefused(await api.profiles.set("t05", { kind: "playlist", playlistId: "nope" }, {}), "not-found");
        expectRefused(await api.profiles.set("t05", { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "nope" }, {}), "not-found");
      });

      it("goes back to the track's settings in a place, and undo brings the place's own back", async () => {
        const place: ProfilePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
        valueOf(await api.profiles.clear("t13", place));
        expect((await api.profiles.overrides())["sc:crown:s14:sc3"]?.t13).toBeUndefined();
        valueOf(await api.history.undo());
        expect((await api.profiles.overrides())["sc:crown:s14:sc3"].t13).toMatchObject({ endMs: 190_000 });
        expectRefused(await api.profiles.clear("t01", place), "not-found");
      });
    });

    describe("import", () => {
      it("adds audio files as New tracks with progress, finds them again without adding twice, and lists problems", async () => {
        const result = valueOf(await api.import.start({ from: "paths", paths: [...fx.newAudioFiles, fx.notAudioFile] }));
        expect(result.added).toHaveLength(fx.newAudioFiles.length);
        expect(result.trackIds).toEqual(expect.arrayContaining(result.added));
        expect(result.problems.map((p) => p.file)).toEqual([fx.notAudioFile]);
        expect(result.cancelled).toBe(false);
        expect(result.summary.length).toBeGreaterThan(5);
        const tracks = await api.library.listTracks();
        expect(tracks).toHaveLength(69 + fx.newAudioFiles.length);
        const first = tracks.find((t) => t.id === result.trackIds[0]);
        expect(first).toMatchObject({ kind: "amb", title: "", isNew: true });
        expect(first.url).toBe(fileAddress(fx.newAudioFiles[0]));
        expect(first.metaTitle.length).toBeGreaterThan(0);
        await changedEvent("tracks");
        await vi.waitFor(() => expect(events.some((e) => e.type === "import-progress" && e.progress.phase === "done")).toBe(true));
        const again = valueOf(await api.import.start({ from: "paths", paths: fx.newAudioFiles }));
        expect(again.added).toEqual([]);
        expect(new Set(again.alreadyInLibrary)).toEqual(new Set(result.added));
      });

      it("runs one import at a time", async () => {
        const [a, b] = await Promise.all([api.import.start({ from: "paths", paths: [fx.newAudioFiles[0]] }), api.import.start({ from: "paths", paths: [fx.newAudioFiles[1]] })]);
        expect([a.ok, b.ok].sort()).toEqual([false, true]);
        expectRefused(a.ok ? b : a, "busy");
      });

      it("watches a folder once", async () => {
        expect(valueOf(await api.import.watchFolder({ from: "path", path: fx.folderToWatch }))).toEqual({ path: fx.folderToWatch, watched: true });
        expect(await api.library.listFolders()).toContainEqual({ path: fx.folderToWatch, watched: true });
        await changedEvent("folders");
        expectRefused(await api.import.watchFolder({ from: "path", path: fx.folderToWatch }), "already-watched");
      });

      it("finds missing files, plans where they went, and relinks the confirmed ones in one undo step", async () => {
        const missing = await api.import.findMissing();
        expect(missing.map((m) => m.id)).toContain(fx.missingTrackId);
        const plan = valueOf(await api.import.planRelink({ from: "path", path: fx.relinkFolder }));
        const match = plan.matches.find((m) => m.trackId === fx.missingTrackId);
        expect(match).toBeDefined();
        expect(plan.matches.length + plan.ambiguous.length + plan.notFound.length).toBe(missing.length);
        const done = valueOf(await api.import.applyRelink([{ trackId: match.trackId, to: match.to }]));
        expect(done.relinked).toEqual([fx.missingTrackId]);
        expect((await track(fx.missingTrackId)).url).toBe(fileAddress(match.to));
        expect((await api.import.findMissing()).map((m) => m.id)).not.toContain(fx.missingTrackId);
        expect((await api.history.state()).canUndo).toBe(true);
        expectRefused(await api.import.applyRelink([{ trackId: "nope", to: match.to }]), "not-found");
      });

      it("SEC-17: Preview the file found is allowed for one planned file at a time, until Find missing files closes", async () => {
        const plan = valueOf(await api.import.planRelink({ from: "path", path: fx.relinkFolder }));
        const check = plan.matches.find((m) => m.confidence === "name");
        if (check) expect(valueOf(await api.import.previewFound(check.trackId))).toEqual({ url: check.toUrl });
        expectRefused(await api.import.previewFound("nope"), "not-found");
        const done = await api.import.endRelinkPreview();
        expect(done.ok && done.changed).toEqual(["folders"]);
      });
    });

    describe("design round 5", () => {
      const ruins = { kind: "scene" as const, campaignId: CROWN, sessionId: S14, sceneId: "sc3" };
      const s14 = { kind: "session" as const, campaignId: CROWN, sessionId: S14 };

      it("PLY-15: the library's Normalise volume setting is off at first with Standard; Save keeps it, as one undo step", async () => {
        expect(await api.library.normaliseSettings()).toEqual({ on: false, target: "standard" });
        expect(valueOf(await api.library.setNormaliseSettings({ on: true, target: "loud" }))).toEqual({ on: true, target: "loud" });
        await changedEvent("tracks", "history");
        expect(await api.library.normaliseSettings()).toEqual({ on: true, target: "loud" });
        const same = await api.library.setNormaliseSettings({ on: true, target: "loud" });
        expect(same.ok && same.changed).toEqual([]);
        expectRefused(await api.library.setNormaliseSettings({ on: true, target: "deafening" as never }), "invalid");
        valueOf(await api.history.undo());
        expect(await api.library.normaliseSettings()).toEqual({ on: false, target: "standard" });
      });

      it("PLY-15: a track's and a playlist's own choice is On, Off or the library's (null); the samples have Ashen King on and t26 off", async () => {
        expect((await track("t26")).normalise).toBe("off");
        expect((await track("t02")).normalise).toBeNull();
        expect((await api.playlists.list()).find((p) => p.id === "p-ashen").normalise).toBe("on");
        expect(valueOf(await api.library.setNormalise("t02", "on")).normalise).toBe("on");
        await changedEvent("tracks", "history");
        expect(valueOf(await api.library.setNormalise("t26", null)).normalise).toBeNull();
        expect(valueOf(await api.playlists.setNormalise("p-ashen", "off")).normalise).toBe("off");
        await changedEvent("playlists", "history");
        valueOf(await api.history.undo());
        expect((await api.playlists.list()).find((p) => p.id === "p-ashen").normalise).toBe("on");
        expectRefused(await api.library.setNormalise("t02", "library" as never), "invalid");
        expectRefused(await api.library.setNormalise("nope", "on"), "not-found");
        expectRefused(await api.playlists.setNormalise("p-ashen", "loud" as never), "invalid");
        expectRefused(await api.playlists.setNormalise("nope", "on"), "not-found");
        const same = await api.library.setNormalise("t02", "on");
        expect(same.ok && same.changed).toEqual([]);
      });

      it("DAT-15: each track carries what Lyre measured from its file, or null until then", async () => {
        const tracks = await api.library.listTracks();
        const t02 = tracks.find((x) => x.id === "t02");
        expect(t02.loudness).toEqual({ lufs: -22.6, truePeakDb: -8 });
        expect(normaliseLine(t02, null, { on: true, target: "standard" })).toBe("-22.6 LUFS · +4.6 dB");
        expect(tracks.find((x) => x.id === "t43").loudness).toBeNull();
        expect(tracks.filter((x) => x.loudness).length).toBe(66);
      });

      it("PLY-13: each playlist has its own play order, each place its own, and resolvePlayOrder agrees with the samples", async () => {
        const playlists = await api.playlists.list();
        const own = (id: string) => playlists.find((p) => p.id === id).order;
        expect(own("p-combat-big")).toEqual({ shuffle: true, repeat: "all" });
        expect(own("a-inn")).toEqual({ shuffle: false, repeat: "all" });
        expect(own("p-abbey-eerie")).toBeNull();
        const orders = await api.playlists.playOrders();
        expect(orders).toEqual({ "sc:crown:s14:sc3": { "p-abbey-eerie": { shuffle: true, repeat: "off" } }, "ss:crown:s14": { "p-wistful": { shuffle: true, repeat: "all" } } });
        expect(resolvePlayOrder("p-abbey-eerie", own("p-abbey-eerie"), ruins, orders)).toEqual({ order: { shuffle: true, repeat: "off" }, source: "place" });
        expect(resolvePlayOrder("p-abbey-eerie", own("p-abbey-eerie"), { ...ruins, sceneId: "sc4" }, orders).source).toBe("default");
      });

      it("PLY-13: chooses and clears a play order in one place or for the playlist itself, refusing what it cannot keep", async () => {
        expect(valueOf(await api.playlists.setPlayOrder("p-company", { kind: "campaign", campaignId: CROWN }, { shuffle: true, repeat: "one" }))).toEqual({ shuffle: true, repeat: "one" });
        expect((await api.playlists.playOrders())["cp:crown"]).toEqual({ "p-company": { shuffle: true, repeat: "one" } });
        valueOf(await api.playlists.setPlayOrder("p-company", null, { shuffle: false, repeat: "off" }));
        expect((await api.playlists.list()).find((p) => p.id === "p-company").order).toEqual({ shuffle: false, repeat: "off" });
        await changedEvent("playlists", "history");
        valueOf(await api.playlists.clearPlayOrder("p-abbey-eerie", ruins));
        expect((await api.playlists.playOrders())["sc:crown:s14:sc3"]).toBeUndefined();
        valueOf(await api.history.undo());
        expect((await api.playlists.playOrders())["sc:crown:s14:sc3"]).toEqual({ "p-abbey-eerie": { shuffle: true, repeat: "off" } });
        expectRefused(await api.playlists.setPlayOrder("p-company", null, { shuffle: true, repeat: "twice" as never }), "invalid");
        expectRefused(await api.playlists.setPlayOrder("nope", null, { shuffle: true, repeat: "all" }), "not-found");
        expectRefused(await api.playlists.setPlayOrder("p-company", { ...ruins, sceneId: "nope" }, { shuffle: true, repeat: "all" }), "not-found");
        const before = await api.history.state();
        const same = await api.playlists.clearPlayOrder("p-company", ruins);
        expect(same.ok && same.changed).toEqual([]);
        expect(await api.history.state()).toEqual(before);
      });

      it("DAT-14: a scene names a track for itself; trackNameIn shows it there and the track's own name elsewhere", async () => {
        const campaigns = await api.campaigns.list();
        const names = trackNamesOf(campaigns);
        expect(names).toEqual({ "sc:crown:s14:sc4": { t39: "The wight rises" }, "sc:crown:s14:sc6": { t07: "Dawn over the abbey" } });
        const t07 = await track("t07");
        const aftermath = { kind: "scene" as const, campaignId: CROWN, sessionId: S14, sceneId: "sc6" };
        expect(trackNameIn(t07, aftermath, names).name).toBe("Dawn over the abbey");
        expect(trackNameIn(t07, ruins, names).name).toBe(t07.title);
        valueOf(await api.sessions.setTrackName(sc("sc3"), "t13", "  The abbey sleeps "));
        expect((await scene(sc("sc3"))).trackNames).toEqual({ t13: "The abbey sleeps" });
        await changedEvent("campaigns", "history");
        valueOf(await api.sessions.setTrackName(sc("sc6"), "t07", ""));
        expect((await scene(sc("sc6"))).trackNames).toEqual({});
        expectRefused(await api.sessions.setTrackName(sc("sc3"), "t13", "n".repeat(201)), "invalid");
        expectRefused(await api.sessions.setTrackName(sc("nope"), "t13", "X"), "not-found");
        expectRefused(await api.sessions.setTrackName(sc("sc3"), "nope", "X"), "not-found");
      });

      it("DAT-13: chooses a track's shape or goes back to the suggestion; the Shape filter and rule shapes follow shapeOf", async () => {
        const tracks = await api.library.listTracks();
        expect(tracks.find((x) => x.id === "t06")).toMatchObject({ shape: "builds" });
        expect(tracks.every((x) => x.suggestedShape === null || typeof x.suggestedShape === "string")).toBe(true);
        expect(valueOf(await api.library.setShape("t01", "peaksThenFalls")).shape).toBe("peaksThenFalls");
        await changedEvent("tracks", "history");
        expectRefused(await api.library.setShape("t01", "wobbly" as never), "invalid");
        expectRefused(await api.library.setShape("nope", "steady"), "not-found");
        const all = await api.library.listTracks();
        const builds = all.filter((x) => shapeOf(x).shape === "builds" || shapeOf(x).shape === "peaksThenFalls").map((x) => x.id);
        const found = await api.library.search({ text: "", shapes: ["builds", "peaksThenFalls"], limit: 500 });
        expect([...found.trackIds].sort()).toEqual([...builds].sort());
        expect(found.trackIds).toEqual(expect.arrayContaining(["t01", "t06"]));
        valueOf(await api.playlists.update("p-combat-big", { rule: { conds: [], shapes: ["builds"] } }));
        const pl = (await api.playlists.list()).find((p) => p.id === "p-combat-big");
        expect(pl.kind === "dynamic" && pl.rule.shapes).toEqual(["builds"]);
        expect(await api.playlists.tracks("p-combat-big")).toEqual(playlistTracks(pl, lookupFrom(all, await api.playlists.list())).map((x) => x.id));
        expect(await api.playlists.tracks("p-combat-big")).toContain("t06");
        expectRefused(await api.playlists.update("p-combat-big", { rule: { conds: [], shapes: ["swells" as never] } }), "invalid");
        valueOf(await api.library.setShape("t06", null));
        expect((await track("t06")).shape).toBeNull();
      });

      it("ORG-12: keeps single tracks on hand and uses a track in places, as usesOfTrack says", async () => {
        expect((await api.campaigns.get(CROWN)).trackIds).toEqual(["t26"]);
        valueOf(await api.campaigns.setOnHand({ campaignId: CROWN, sessionId: S14 }, "tracks", ["t02", "t09"]));
        expect((await api.campaigns.get(CROWN)).sessions.find((s) => s.id === S14).trackIds).toEqual(["t02", "t09"]);
        expectRefused(await api.campaigns.setOnHand({ campaignId: CROWN }, "tracks", ["nope"]), "not-found");
        valueOf(await api.campaigns.setUses({ kind: "track", id: "t09" }, [{ campaignId: CROWN }, { campaignId: CROWN, sessionId: S14, sceneId: "sc1" }]));
        valueOf(await api.campaigns.setUses({ kind: "track", id: "b05" }, [{ campaignId: CROWN, sessionId: S14, sceneId: "sc2" }]));
        const campaigns = await api.campaigns.list();
        for (const id of ["t09", "t26", "b05", "t02"]) expect(await api.campaigns.usesOf({ kind: "track", id }), id).toEqual(usesOfTrack(id, campaigns));
        expect((await api.campaigns.usesOf({ kind: "track", id: "t09" })).map((u) => u.level)).toEqual(["campaign", "scene"]);
        expect((await scene(sc("sc2"))).ambience).toEqual({ kind: "track", id: "b05" });
        expect((await scene(sc("sc1"))).music).toContainEqual({ kind: "track", id: "t09" });
        expectRefused(await api.campaigns.setUses({ kind: "track", id: "nope" }, []), "not-found");
      });

      it("PLY-14: a session list keeps its own audio settings for a track, ahead of the playlist's", async () => {
        valueOf(await api.profiles.set("t03", s14, { endMs: 60_000, after: "stop" }));
        const overrides = await api.profiles.overrides();
        expect(overrides["ss:crown:s14"]).toEqual({ t03: { endMs: 60_000, after: "stop" } });
        const t03 = await track("t03");
        expect(resolveProfile(t03, profilePlacesFor(s14, "p-wistful"), overrides)).toMatchObject({ source: "session", profile: { endMs: 60_000, after: "stop" } });
        expectRefused(await api.profiles.set("t03", { ...s14, sessionId: "nope" }, {}), "not-found");
        valueOf(await api.profiles.clear("t03", s14));
        expect((await api.profiles.overrides())["ss:crown:s14"]).toBeUndefined();
        expect(keyOfPlace(s14)).toBe(placeKey(s14));
      });

      it("SFX-11: a pad put in Spare pads by hand stays there when the grid grows; one sent there by a resize comes back", async () => {
        expect((await board("weather")).spare.map((p) => [p.id, p.aside])).toEqual([["mugs", true]]);
        valueOf(await api.boards.movePad("weather", "fire", "spare"));
        expect((await board("weather")).spare.map((p) => [p.id, p.aside])).toEqual([["mugs", true], ["fire", true]]);
        const before = await board("weather");
        const grown = valueOf(await api.boards.resize("weather", 4, 3));
        const isAside = (p: (typeof before.spare)[number]) => p.aside;
        const want = reflowBoard(before.slots, before.spare, 4, 3, isAside);
        expect(grown.board.slots.map((p) => p?.id ?? null)).toEqual(want.slots.map((p) => p?.id ?? null));
        expect(grown.board.spare.map((p) => p.id)).toEqual(["mugs", "fire"]);
        expect(grown.cameBack).toEqual([]);
        valueOf(await api.boards.resize("weather", 2, 2));
        const small = await board("weather");
        expect(small.spare.map((p) => [p.id, p.aside])).toEqual([["horse", false], ["storm", false], ["wind", false], ["mugs", true], ["fire", true]]);
        expect(valueOf(await api.boards.resize("weather", 4, 2)).cameBack).toEqual(["horse", "storm", "wind"]);
        // A spare pad dragged onto a pad sends that pad to Spare pads by hand.
        valueOf(await api.boards.movePad("weather", "mugs", { slot: 0 }));
        expect((await board("weather")).spare.find((p) => p.id === "thunder")?.aside).toBe(true);
        expect((await board("weather")).slots[0]).toMatchObject({ id: "mugs", aside: false });
      });

      it("DAT-8: missing files with their name and folder; a relink plan gives each found file an address to preview", async () => {
        const missing = await api.import.findMissing();
        const m = missing.find((x) => x.id === fx.missingTrackId);
        expect(m.fileName).toBe("07 Memories of Mother.flac");
        expect(m.path.endsWith(m.fileName)).toBe(true);
        expect(m.folder.length).toBeGreaterThan(0);
        expect(m.sizeBytes === null || typeof m.sizeBytes === "number").toBe(true);
        const plan = valueOf(await api.import.planRelink({ from: "path", path: fx.relinkFolder }));
        const match = plan.matches.find((x) => x.trackId === fx.missingTrackId);
        expect(match.toUrl).toBe(fileAddress(match.to));
      });

      it("DAT-7: says what a file would hold for each scope, and why the audio can be left out", async () => {
        const crown = await api.transfer.estimate({ kind: "campaign", campaignId: CROWN });
        expect(crown).toMatchObject({ title: "The Sunken Crown", fileName: "The Sunken Crown.lyre", counts: { campaigns: 1, sessions: 4 } });
        expect(crown.counts.tracks).toBeGreaterThan(10);
        expect(crown.counts.playlists).toBeGreaterThanOrEqual(4);
        expect(crown.leaveAudioOutBecause).toBeNull();
        const tags = await api.transfer.estimate({ kind: "tags" });
        expect(tags).toMatchObject({ counts: { tracks: 0, tagGroups: 3 }, leaveAudioOutBecause: "Tags have no audio files." });
        const ruinsFile = await api.transfer.estimate({ kind: "scene", campaignId: CROWN, sessionId: S14, sceneId: "sc3" });
        expect(ruinsFile).toMatchObject({ title: "The abbey ruins", counts: { campaigns: 1, sessions: 1, scenes: 1 } });
        expect((await api.transfer.estimate({ kind: "board", boardId: "combat" })).counts.boards).toBe(1);
        expect((await api.transfer.estimate({ kind: "library" })).counts.tracks).toBe((await api.library.listTracks()).length);
        await expect(api.transfer.estimate({ kind: "playlist", playlistId: "nope" })).rejects.toThrow();
      });

      it("DAT-7: the move report has the sections the screen shows, or is null when nothing came across", async () => {
        const report = await api.transfer.movedReport();
        if (report === null) return;
        expect(report.from).toMatch(/Kenku FM/);
        expect(report.copied.length).toBeGreaterThan(0);
        for (const row of report.copied) expect(typeof row.what === "string" && typeof row.count === "number" && typeof row.nowIn === "string").toBe(true);
        expect(report.notBrought.length).toBeGreaterThan(0);
        expect(report.missing.every((m) => typeof m.fileName === "string")).toBe(true);
      });

      it("DAT-7: saves a file, opens it with each duplicate marked, and brings it in as chosen in one undo step", async () => {
        const files = fx.transferFiles;
        if (!files) {
          expectRefused(await api.transfer.save({ scope: { kind: "library" }, includeAudio: false }), "unavailable");
          expectRefused(await api.transfer.open({ from: "choose-file" }), "unavailable");
          expectRefused(await api.transfer.bringIn("any", { all: "skip" }), "unavailable");
          return;
        }
        const saved = valueOf(await api.transfer.save({ scope: { kind: "campaign", campaignId: CROWN }, includeAudio: false, path: files.saveTo }));
        expect(saved.path).toBe(files.saveTo);
        expect(saved.bytes).toBeGreaterThan(0);
        expect((await api.history.state()).canUndo).toBe(false);
        expectRefused(await api.transfer.open({ from: "path", path: files.notLyreFile }), "not-lyre-file");
        const opened = valueOf(await api.transfer.open({ from: "path", path: files.saveTo }));
        expect(opened.includesAudio).toBe(false);
        const campaignItem = opened.items.find((i) => i.kind === "campaign");
        expect(campaignItem).toMatchObject({ name: "The Sunken Crown", status: "duplicate", yours: { kind: "campaign", id: CROWN } });
        const before = (await api.campaigns.list()).length;
        const report = valueOf(await api.transfer.bringIn(opened.id, { each: { [campaignItem.key]: "keepBoth" }, all: "skip" }));
        expect(report.keptBoth.map((x) => x.kind)).toEqual(["campaign"]);
        expect(report.summary.length).toBeGreaterThan(10);
        expect((await api.campaigns.list()).length).toBe(before + 1);
        await changedEvent("campaigns", "history");
        valueOf(await api.history.undo());
        expect((await api.campaigns.list()).length).toBe(before);
        expectRefused(await api.transfer.bringIn("nope", { all: "skip" }), "not-found");
      });
    });

    describe("design round 6", () => {
      const ruins = { kind: "scene" as const, campaignId: CROWN, sessionId: S14, sceneId: "sc3" };
      const s14 = { kind: "session" as const, campaignId: CROWN, sessionId: S14 };

      it("ORG-13: a playlist's tracks reordered in one place play in that order there only; its own order is no order", async () => {
        expect(await api.playlists.trackOrders()).toEqual({});
        const own = await api.playlists.tracks("p-abbess");
        expect(own.length).toBeGreaterThanOrEqual(3);
        const moved = [own[1], own[0], ...own.slice(2)];
        expect(valueOf(await api.playlists.setTrackOrder("p-abbess", ruins, moved))).toEqual(moved);
        await changedEvent("playlists", "history");
        const orders = await api.playlists.trackOrders();
        expect(orders).toEqual({ "sc:crown:s14:sc3": { "p-abbess": moved } });
        const tracks = own.map((id) => ({ id }));
        expect(tracksInPlaceOrder(tracks, orders[keyOfPlace(ruins)]["p-abbess"]).map((t) => t.id)).toEqual(moved);
        expect(tracksInPlaceOrder(tracks, orders[keyOfPlace({ ...ruins, sceneId: "sc5" })]?.["p-abbess"]).map((t) => t.id)).toEqual(own);
        // Only the playlist's tracks count, each once; the rest follow.
        expect(valueOf(await api.playlists.setTrackOrder("p-abbess", s14, [own[2], "t-nope", own[2]]))).toEqual([own[2], own[0], own[1], ...own.slice(3)]);
        const same = await api.playlists.setTrackOrder("p-abbess", ruins, moved);
        expect(same.ok && same.changed).toEqual([]);
        expect(valueOf(await api.playlists.setTrackOrder("p-abbess", ruins, own))).toBeNull();
        expect((await api.playlists.trackOrders())["sc:crown:s14:sc3"]).toBeUndefined();
        valueOf(await api.history.undo());
        expect((await api.playlists.trackOrders())["sc:crown:s14:sc3"]).toEqual({ "p-abbess": moved });
        valueOf(await api.playlists.clearTrackOrder("p-abbess", ruins));
        expect((await api.playlists.trackOrders())["sc:crown:s14:sc3"]).toBeUndefined();
        const nothing = await api.playlists.clearTrackOrder("p-abbess", ruins);
        expect(nothing.ok && nothing.changed).toEqual([]);
        expectRefused(await api.playlists.setTrackOrder("p-abbess", null as never, moved), "invalid");
        expectRefused(await api.playlists.setTrackOrder("p-abbess", ruins, "a, b" as never), "invalid");
        expectRefused(await api.playlists.setTrackOrder("nope", ruins, moved), "not-found");
        expectRefused(await api.playlists.setTrackOrder("p-abbess", { ...ruins, sceneId: "nope" }, moved), "not-found");
        expectRefused(await api.playlists.clearTrackOrder("nope", ruins), "not-found");
      });

      it("ORG-13: an order goes with its place and its playlist", async () => {
        const own = await api.playlists.tracks("p-abbess");
        valueOf(await api.playlists.setTrackOrder("p-abbess", ruins, [...own].reverse()));
        valueOf(await api.sessions.deleteScene(sc("sc3")));
        expect(await api.playlists.trackOrders()).toEqual({});
        valueOf(await api.playlists.setTrackOrder("p-abbess", s14, [...own].reverse()));
        valueOf(await api.playlists.delete("p-abbess"));
        expect(await api.playlists.trackOrders()).toEqual({});
      });

      it("PLY-17: Repeat one on a scene's track is saved with the scene, as one undo step, and copied with the scene", async () => {
        expect((await scene(sc("sc3"))).repeatOnes).toEqual([]);
        valueOf(await api.sessions.setRepeatOne(sc("sc3"), "t13", true));
        await changedEvent("campaigns", "history");
        expect((await scene(sc("sc3"))).repeatOnes).toEqual(["t13"]);
        expect(repeatOnesOf(await api.campaigns.list())).toEqual({ "sc:crown:s14:sc3": ["t13"] });
        expect(repeatsOneIn(repeatOnesOf(await api.campaigns.list()), keyOfPlace(ruins), "t13")).toBe(true);
        const same = await api.sessions.setRepeatOne(sc("sc3"), "t13", true);
        expect(same.ok && same.changed).toEqual([]);
        const copy = valueOf(await api.sessions.duplicateScene(sc("sc3")));
        expect(copy.repeatOnes).toEqual(["t13"]);
        valueOf(await api.sessions.setRepeatOne(sc("sc3"), "t13", false));
        expect((await scene(sc("sc3"))).repeatOnes).toEqual([]);
        valueOf(await api.history.undo());
        expect((await scene(sc("sc3"))).repeatOnes).toEqual(["t13"]);
        expectRefused(await api.sessions.setRepeatOne(sc("nope"), "t13", true), "not-found");
        expectRefused(await api.sessions.setRepeatOne(sc("sc3"), "nope", true), "not-found");
        expectRefused(await api.sessions.setRepeatOne(sc("sc3"), "t13", "yes" as never), "invalid");
      });

      it("lead's decision (b6 notes, contracts Q1): a duplicated scene copies its track orders and play orders too: a copy is the whole scene", async () => {
        const ruinsPlace = { kind: "scene" as const, campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
        const own = (await api.playlists.tracks("p-abbess")).slice();
        valueOf(await api.playlists.setTrackOrder("p-abbess", ruinsPlace, [own[1], own[0], ...own.slice(2)]));
        valueOf(await api.playlists.setPlayOrder("p-abbess", ruinsPlace, { shuffle: true, repeat: "off" }));
        const copy = valueOf(await api.sessions.duplicateScene(sc("sc3")));
        const copyKey = keyOfPlace({ ...ruinsPlace, sceneId: copy.id });
        expect((await api.playlists.trackOrders())[copyKey]?.["p-abbess"]?.slice(0, 2)).toEqual([own[1], own[0]]);
        expect((await api.playlists.playOrders())[copyKey]?.["p-abbess"]).toEqual({ shuffle: true, repeat: "off" });
        // One undo step takes the copy away with its orders.
        valueOf(await api.history.undo());
        expect((await api.playlists.trackOrders())[copyKey]).toBeUndefined();
        expect((await api.playlists.trackOrders())[keyOfPlace(ruinsPlace)]?.["p-abbess"]?.slice(0, 2)).toEqual([own[1], own[0]]);
      });

      it("UX-19: a write the computer could not save is refused in plain words, changes nothing, and works when tried again", async () => {
        const before = await api.history.state();
        await fx.failNextWrite();
        const failed = await api.campaigns.update(CROWN, { notes: "Bring the map" });
        expectRefused(failed, "not-saved");
        expect(isRefused(failed) && failed.refusal.message).toBe("Lyre could not write it to your computer. Try again; if it fails again, check that the drive has space.");
        expect((await api.campaigns.get(CROWN)).notes).not.toBe("Bring the map");
        expect(await api.history.state()).toEqual(before);
        expect(valueOf(await api.campaigns.update(CROWN, { notes: "Bring the map" })).notes).toBe("Bring the map");
      });

      it("ORG-14: Find gives tracks and playlists in one call, grouped, each playlist with its tracks in its place's order", async () => {
        const found = await api.library.find({ text: "abbess" });
        expect(found.playlists.map((p) => p.id)).toContain("p-abbess");
        const abbess = found.playlists.find((p) => p.id === "p-abbess");
        expect(abbess).toMatchObject({ name: "The Abbess", lane: "music", kind: "manual", place: null });
        expect(abbess.trackIds).toEqual(await api.playlists.tracks("p-abbess"));
        expect(found.tracks).toEqual(await api.library.search({ text: "abbess" }));
        // In Live's session: a playlist of the session's list comes with that list's order and place.
        const own = await api.playlists.tracks("p-wistful");
        valueOf(await api.playlists.setTrackOrder("p-wistful", s14, [...own].reverse()));
        const inSession = await api.library.find({ text: "wistful", in: { campaignId: CROWN, sessionId: S14 } });
        expect(inSession.playlists.find((p) => p.id === "p-wistful")).toMatchObject({ place: s14, trackIds: [...own].reverse() });
        const inCampaign = await api.library.find({ text: "company", in: { campaignId: CROWN, sessionId: S14 } });
        expect(inCampaign.playlists.find((p) => p.id === "p-company")?.place).toEqual({ kind: "campaign", campaignId: CROWN });
        const ambience = await api.library.find({ text: "abbey", lane: "amb" });
        expect(ambience.playlists.length).toBeGreaterThan(0);
        expect(ambience.playlists.every((p) => p.lane === "amb")).toBe(true);
        expect((await api.library.find({ text: "zzzz-nothing" })).playlists).toEqual([]);
        expect((await api.library.find({ text: "a", limit: 2 })).playlists.length).toBeLessThanOrEqual(2);
      });
    });

    describe("design round 7", () => {
      const ruins = sc("sc3");
      const groupOf = async (id: string) => (await api.tags.listGroups()).find((g) => g.id === id);
      const trackOf = async (id: string) => (await api.library.listTracks()).find((t) => t.id === id);
      const playlistOf = async (id: string) => (await api.playlists.list()).find((p) => p.id === id);
      const boardOf = async (id: string) => (await api.boards.list()).find((b) => b.id === id);
      const sceneOf = async (address: SceneAddress) =>
        (await api.campaigns.get(address.campaignId)).sessions.find((s) => s.id === address.sessionId).scenes.find((x) => x.id === address.sceneId);

      it("DAT-10: tag groups and tags with their places, other words and colours, Grief inside Melancholy", async () => {
        const mood = await groupOf("mood");
        expect(mood).toMatchObject({ name: "Mood", color: null });
        expect(mood.tags.map((t) => t.name)).toEqual(mood.values);
        expect(mood.tags.find((t) => t.name === "Grief")).toEqual({ name: "Grief", parent: "Melancholy", also: [], color: null });
        expect(mood.tags.find((t) => t.name === "Melancholy")?.also).toEqual(["sad", "sorrowful"]);
        // Filtering by Melancholy finds the grieving tracks too (trackHasTag with tagTreeOf).
        const tree = tagTreeOf(await api.tags.listGroups());
        const t07 = await trackOf("t07");
        expect(t07.tags.mood).toContain("Grief");
        expect(t07.tags.mood).not.toContain("Melancholy");
        expect(trackHasTag(t07, "mood", "Melancholy", tree)).toBe(true);
      });

      it("DAT-10: rename and merge change every track and dynamic rule in one undo step; delete takes the tag off", async () => {
        const before = (await api.library.listTracks()).filter((t) => t.tags.mood.includes("Wistful")).length;
        const renamed = valueOf(await api.tags.renameTag({ group: "mood", value: "Wistful" }, "Longing"));
        expect(renamed.tracks).toBe(before);
        await changedEvent("tags", "tracks", "history");
        expect((await api.library.listTracks()).some((t) => t.tags.mood.includes("Wistful"))).toBe(false);
        expect((await groupOf("mood")).values).toContain("Longing");
        valueOf(await api.history.undo());
        expect((await groupOf("mood")).values).toContain("Wistful");
        expectRefused(await api.tags.renameTag({ group: "mood", value: "Wistful" }, "Tense"), "invalid");
        // A rule naming Eerie names Dread after Eerie merges into Dread; Eerie becomes another word for Dread.
        const ruled = (await api.playlists.list()).filter((p) => p.kind === "dynamic" && p.rule.conds.some((c) => c.group === "mood" && c.values.includes("Eerie")));
        const merged = valueOf(await api.tags.mergeTag({ group: "mood", value: "Eerie" }, "Dread"));
        expect(merged.tracks).toBeGreaterThan(0);
        for (const p of ruled) {
          const now = await playlistOf(p.id);
          expect(now.kind === "dynamic" && now.rule.conds.some((c) => c.values.includes("Eerie"))).toBe(false);
          expect(now.kind === "dynamic" && now.rule.conds.some((c) => c.values.includes("Dread"))).toBe(true);
        }
        expect((await groupOf("mood")).tags.find((t) => t.name === "Dread")?.also).toEqual(expect.arrayContaining(["eerie", "fear", "horror"]));
        expectRefused(await api.tags.mergeTag({ group: "mood", value: "Dread" }, "Dread"), "invalid");
        const gone = valueOf(await api.tags.deleteTag({ group: "mood", value: "Melancholy" }));
        expect(gone.tracks).toBeGreaterThan(0);
        // The tags inside it move up a level.
        expect((await groupOf("mood")).tags.find((t) => t.name === "Grief")?.parent).toBeNull();
        expectRefused(await api.tags.deleteTag({ group: "mood", value: "Nope" }), "not-found");
      });

      it("DAT-10: a track lists its tags in vocabulary order, as the Tags screen lists them; a merge leaves the merged tag in its place", async () => {
        const moods = async (id: string) => (await api.library.listTracks()).find((t) => t.id === id)?.tags.mood;
        // The sample tags t13 Dread, then Eerie; the vocabulary has Eerie first.
        expect(await moods("t13")).toEqual(["Eerie", "Dread"]);
        valueOf(await api.tags.tagTracks({ trackIds: ["t13"], add: [{ group: "mood", value: "Heroic" }] }));
        expect(await moods("t13")).toEqual(["Heroic", "Eerie", "Dread"]);
        // Moved up in the vocabulary, Dread moves up on every track.
        valueOf(await api.tags.moveTag({ group: "mood", value: "Dread" }, -1));
        expect(await moods("t13")).toEqual(["Heroic", "Dread", "Eerie"]);
        // Eerie merged into Heroic: Heroic stays where the vocabulary has it.
        valueOf(await api.tags.mergeTag({ group: "mood", value: "Eerie" }, "Heroic"));
        expect(await moods("t13")).toEqual(["Heroic", "Dread"]);
      });

      it("DAT-10: a tag inside another is listed right after it on a track, depth first, as the Tags screen lists them", async () => {
        const moods = async (id: string) => (await api.library.listTracks()).find((t) => t.id === id)?.tags.mood;
        // Saved order: … Wistful, Mysterious, Melancholy, Desperate, Tense, Grief, Eerie, Dread; Grief is inside Melancholy.
        valueOf(await api.tags.tagTracks({ trackIds: ["t15"], add: [{ group: "mood", value: "Tense" }] }));
        expect(await moods("t15")).toEqual(["Wistful", "Melancholy", "Grief", "Tense"]);
        // Dread put inside Grief: Melancholy › Grief › Dread, before Desperate and Tense.
        valueOf(await api.tags.updateTag({ group: "mood", value: "Dread" }, { parent: "Grief" }));
        valueOf(await api.tags.tagTracks({ trackIds: ["t15"], add: [{ group: "mood", value: "Dread" }] }));
        expect(await moods("t15")).toEqual(["Wistful", "Melancholy", "Grief", "Dread", "Tense"]);
      });

      it("DAT-10: groups and tags are made, coloured, nested, given other words and moved", async () => {
        const faction = valueOf(await api.tags.createGroup("Faction", "moss"));
        expect(faction).toMatchObject({ name: "Faction", color: "moss", values: [], tags: [] });
        expect((await api.tags.listGroups()).map((g) => g.name)).toEqual(["Mood", "Leitmotif", "Scene type", "Faction"]);
        expectRefused(await api.tags.createGroup("Faction"), "invalid");
        expectRefused(await api.tags.createGroup("Guild", "pink" as never), "invalid");
        expect(valueOf(await api.tags.createTag(faction.id, "Harbour guild"))).toEqual({ group: faction.id, value: "Harbour guild" });
        valueOf(await api.tags.createTag(faction.id, "Dock wardens", "Harbour guild"));
        expectRefused(await api.tags.createTag(faction.id, "Harbour guild"), "invalid");
        expectRefused(await api.tags.createTag("nope", "X"), "not-found");
        const info = valueOf(await api.tags.updateTag({ group: faction.id, value: "Dock wardens" }, { also: ["Wardens", "watch"], color: "sea" }));
        expect(info).toEqual({ name: "Dock wardens", parent: "Harbour guild", also: ["wardens", "watch"], color: "sea" });
        valueOf(await api.tags.updateTag({ group: faction.id, value: "Dock wardens" }, { parent: null }));
        expectRefused(await api.tags.updateTag({ group: faction.id, value: "Harbour guild" }, { parent: "Nope" }), "not-found");
        valueOf(await api.tags.moveTag({ group: faction.id, value: "Dock wardens" }, -1));
        expect((await groupOf(faction.id)).values).toEqual(["Dock wardens", "Harbour guild"]);
        valueOf(await api.tags.moveGroup(faction.id, -1));
        expect((await api.tags.listGroups()).map((g) => g.name)).toEqual(["Mood", "Leitmotif", "Faction", "Scene type"]);
        valueOf(await api.tags.updateGroup(faction.id, { name: "Factions", color: null }));
        expect(await groupOf(faction.id)).toMatchObject({ name: "Factions", color: null });
        // A new group shows on every track at once.
        expect((await trackOf("t07")).tags[faction.id]).toEqual([]);
        valueOf(await api.tags.deleteGroup(faction.id));
        expect(await groupOf(faction.id)).toBeUndefined();
        expectRefused(await api.tags.deleteGroup("nope"), "not-found");
      });

      it("ORG-4: folders hold playlists and boards, nest, and deleting one moves what was in it up a level", async () => {
        const abbey = valueOf(await api.folders.create("playlists", { name: "The abbey", moveIn: "p-abbess" }));
        expect(abbey).toMatchObject({ kind: "playlists", name: "The abbey", parentId: null, color: null });
        expect((await playlistOf("p-abbess")).folderId).toBe(abbey.id);
        await changedEvent("playlists", "history");
        const inner = valueOf(await api.folders.create("playlists", { name: "Villains", parentId: abbey.id }));
        valueOf(await api.folders.moveInto("playlists", "p-ashen", inner.id));
        expect(folderPath(await api.folders.list("playlists"), inner.id)).toBe("The abbey › Villains");
        valueOf(await api.folders.update(inner.id, { color: "plum" }));
        expect((await api.folders.list("playlists")).find((f) => f.id === inner.id)?.color).toBe("plum");
        valueOf(await api.folders.delete(abbey.id));
        expect((await api.folders.list("playlists")).find((f) => f.id === inner.id)?.parentId).toBeNull();
        expect((await playlistOf("p-abbess")).folderId).toBeNull();
        valueOf(await api.history.undo());
        expect((await playlistOf("p-abbess")).folderId).toBe(abbey.id);
        const boards = valueOf(await api.folders.create("boards", { name: "Places", moveIn: "weather" }));
        expect((await boardOf("weather")).folderId).toBe(boards.id);
        expectRefused(await api.folders.moveInto("boards", "weather", abbey.id), "invalid");
        expectRefused(await api.folders.create("playlists", { name: " " }), "invalid");
        expectRefused(await api.folders.moveInto("playlists", "nope", null), "not-found");
        expectRefused(await api.folders.update("nope", { name: "X" }), "not-found");
        expectRefused(await api.folders.delete("nope"), "not-found");
      });

      it("ORG-4: a manual playlist's dividers are lines, not tracks, and move like tracks", async () => {
        const tracks = await api.playlists.tracks("p-abbess");
        const div = valueOf(await api.playlists.addDivider("p-abbess", "After the font", 2));
        expect(div).toMatchObject({ name: "After the font", at: 2 });
        expect(await api.playlists.tracks("p-abbess")).toEqual(tracks);
        expect(withDividers(tracks, (await playlistOf("p-abbess")).dividers).map((e) => (e.kind === "track" ? e.trackId : e.name))).toEqual([tracks[0], tracks[1], "After the font", ...tracks.slice(2)]);
        valueOf(await api.playlists.moveItem("p-abbess", { dividerId: div.id }, 0));
        expect((await playlistOf("p-abbess")).dividers).toEqual([{ ...div, at: 0 }]);
        valueOf(await api.playlists.moveItem("p-abbess", { trackId: tracks[3] }, 0));
        expect((await api.playlists.tracks("p-abbess"))[0]).toBe(tracks[3]);
        expect((await playlistOf("p-abbess")).dividers[0].at).toBe(1);
        valueOf(await api.playlists.renameDivider("p-abbess", div.id, "The font"));
        valueOf(await api.playlists.removeDivider("p-abbess", div.id));
        expect((await playlistOf("p-abbess")).dividers).toEqual([]);
        expectRefused(await api.playlists.addDivider("p-combat-big", "Big", 0), "wrong-kind");
        expectRefused(await api.playlists.renameDivider("p-abbess", "nope", "X"), "not-found");
        expectRefused(await api.playlists.addDivider("p-abbess", "", 0), "invalid");
      });

      it("ORG-4: a pad board's dividers name rows", async () => {
        const board = valueOf(await api.boards.setDivider("abbey", 1, "Spells"));
        expect(board.dividers).toEqual([{ row: 1, name: "Spells" }]);
        expect((await boardOf("abbey")).dividers).toEqual([{ row: 1, name: "Spells" }]);
        valueOf(await api.boards.setDivider("abbey", 1, null));
        expect((await boardOf("abbey")).dividers).toEqual([]);
        expectRefused(await api.boards.setDivider("abbey", 9, "x"), "invalid");
        expectRefused(await api.boards.setDivider("nope", 0, "x"), "not-found");
      });

      it("ORG-5: put copies tracks into a playlist, moves them with Shift, makes pads on a board, adds to a scene", async () => {
        const into = valueOf(await api.library.put({ place: { kind: "playlist", playlistId: "p-ashen" }, what: { kind: "tracks", ids: ["t14"] }, from: "p-abbess" }));
        expect(into).toMatchObject({ added: ["t14"], alreadyIn: [], moved: false, placeName: "Ashen King" });
        expect(await api.playlists.tracks("p-abbess")).toContain("t14");
        valueOf(await api.history.undo());
        const moved = valueOf(await api.library.put({ place: { kind: "playlist", playlistId: "p-ashen" }, what: { kind: "tracks", ids: ["t14"] }, from: "p-abbess", move: true }));
        expect(moved.moved).toBe(true);
        expect(await api.playlists.tracks("p-abbess")).not.toContain("t14");
        expect(await api.playlists.tracks("p-ashen")).toContain("t14");
        const again = valueOf(await api.library.put({ place: { kind: "playlist", playlistId: "p-ashen" }, what: { kind: "tracks", ids: ["t14"] } }));
        expect(again).toMatchObject({ added: [], alreadyIn: ["t14"] });
        const pads = valueOf(await api.library.put({ place: { kind: "board", boardId: "spells" }, what: { kind: "tracks", ids: ["f04", "t39"] } }));
        expect(pads.added).toHaveLength(2);
        const spells = await boardOf("spells");
        const made = [...spells.slots, ...spells.spare].filter((p) => p && pads.added.includes(p.id));
        expect(made.map((p) => p.sound.trackIds)).toEqual([["f04"], ["t39"]]);
        const toScene = valueOf(await api.library.put({ place: { kind: "scene", ...ruins }, what: { kind: "playlists", ids: ["p-ashen", "p-abbess"] } }));
        expect(toScene).toMatchObject({ added: ["p-ashen"], alreadyIn: ["p-abbess"] });
        valueOf(await api.library.put({ place: { kind: "scene", ...ruins }, what: { kind: "boards", ids: ["spells"] } }));
        expect((await sceneOf(ruins)).boardIds).toContain("spells");
        expectRefused(await api.library.put({ place: { kind: "playlist", playlistId: "p-combat-big" }, what: { kind: "tracks", ids: ["t14"] } }), "wrong-kind");
        expectRefused(await api.library.put({ place: { kind: "board", boardId: "spells" }, what: { kind: "playlists", ids: ["p-ashen"] } }), "wrong-kind");
        expectRefused(await api.library.put({ place: { kind: "playlist", playlistId: "nope" }, what: { kind: "tracks", ids: ["t14"] } }), "not-found");
        expectRefused(await api.library.put({ place: { kind: "queue", roomId: "table" } as never, what: { kind: "tracks", ids: ["t14"] } }), "invalid");
      });

      it("PLY-8: a scene's own start and Then, a pad's steps; the usual is never kept; one undo step", async () => {
        const scene = await sceneOf(ruins);
        expect(scene).toMatchObject({ steps: null, movesOn: { when: "stay" } });
        const usual = usualSceneSteps(scene);
        const own: CueStep[] = [...usual, { do: "pad", boardId: "abbey", padId: "bell" }, { do: "fade", level: 0.3, ms: 2000 }];
        const saved = valueOf(await api.sessions.setSceneSteps(ruins, own, { when: "musicEnds" }));
        expect(saved).toMatchObject({ steps: own, movesOn: { when: "musicEnds" } });
        await changedEvent("campaigns", "history");
        expect(valueOf(await api.sessions.setSceneSteps(ruins, usual, { when: "stay" }))).toMatchObject({ steps: null, movesOn: { when: "stay" } });
        valueOf(await api.history.undo());
        expect((await sceneOf(ruins)).steps).toEqual(own);
        expectRefused(await api.sessions.setSceneSteps(ruins, [{ do: "sound" }], { when: "stay" }), "invalid");
        expectRefused(await api.sessions.setSceneSteps(ruins, [{ do: "pad", boardId: "abbey", padId: "nope" }], { when: "stay" }), "not-found");
        expectRefused(await api.sessions.setSceneSteps(ruins, null, { when: "after", ms: 5 }), "invalid");
        const pad = valueOf(await api.boards.setPadSteps("weather", "thunder", [{ do: "sound" }, { do: "stop", what: "music" }]));
        expect(pad.steps).toEqual([{ do: "sound" }, { do: "stop", what: "music" }]);
        expect(valueOf(await api.boards.setPadSteps("weather", "thunder", usualPadSteps())).steps).toBeNull();
        expectRefused(await api.boards.setPadSteps("weather", "thunder", [{ do: "board", boardId: "abbey" }]), "invalid");
        expectRefused(await api.boards.setPadSteps("weather", "nope", null), "not-found");
      });

      it("PLY-4, SHW-3: Ending, Pick up and Follow with are kept on the track", async () => {
        expect(await trackOf("t15")).toMatchObject({ fadesOut: false, resume: false, follow: null });
        const t = valueOf(await api.library.updateTrack("t15", { fadesOut: true, resume: true, follow: { kind: "playlist", id: "p-ashen" } }));
        expect(t).toMatchObject({ fadesOut: true, resume: true, follow: { kind: "playlist", id: "p-ashen" } });
        valueOf(await api.library.updateTrack("t39", { follow: { kind: "track", id: "t15" } }));
        expect((await trackOf("t39")).follow).toEqual({ kind: "track", id: "t15" });
        valueOf(await api.library.updateTrack("t15", { follow: null }));
        expect((await trackOf("t15")).follow).toBeNull();
        expectRefused(await api.library.updateTrack("t15", { follow: { kind: "track", id: "t15" } }), "invalid");
        expectRefused(await api.library.updateTrack("t15", { follow: { kind: "playlist", id: "nope" } }), "not-found");
      });

      it("DAT-3: one marker of a profile is the mix-out point", async () => {
        valueOf(await api.profiles.set("t13", null, { markers: [{ atMs: 30_000, label: "Low swell", mix: true }, { atMs: 64_000, label: "Choir enters" }] }));
        expect((await trackOf("t13")).profile?.markers).toEqual([{ atMs: 30_000, label: "Low swell", mix: true }, { atMs: 64_000, label: "Choir enters" }]);
        expectRefused(await api.profiles.set("t13", null, { markers: [{ atMs: 1, label: "a", mix: true }, { atMs: 2, label: "b", mix: true }] }), "invalid");
      });

      it("UX-12: Find and play finds tracks, playlists, pads and scenes", async () => {
        const found = await api.library.find({ text: "abbey" });
        expect(found.pads.map((p) => p.padId)).toContain("bell");
        expect(found.pads.find((p) => p.padId === "bell")).toEqual({ boardId: "abbey", padId: "bell", label: "Abbey bell", boardName: "Drowned Abbey" });
        expect(found.scenes.find((x) => x.sceneId === "sc3")).toEqual({ campaignId: CROWN, sessionId: S14, sceneId: "sc3", name: "The abbey ruins", sessionNumber: 14 });
        const amb = await api.library.find({ text: "abbey", lane: "amb" });
        expect(amb.pads).toEqual([]);
        expect(amb.scenes).toEqual([]);
        expect((await api.library.find({ text: "thunder", lane: "fx" })).pads.map((p) => p.padId)).toEqual(["thunder"]);
      });

      it("UX-12, PLY-8, UX-11, PRV-2: settings with the library and per computer", async () => {
        const start = await api.settings.get();
        expect(start).toEqual({
          crossfade: { ms: 3000, curve: "even" },
          shortcuts: {},
          nextSceneGuard: true,
          display: { density: "compact", textSize: 100, highContrast: false },
          devices: { airDevice: "", previewDevice: "", split: false, previewEar: "left" },
          globalKeys: false,
        });
        expect(valueOf(await api.settings.setShortcut("palette", "ctrl+j")).shortcuts).toEqual({ palette: "Ctrl+J" });
        await changedEvent("settings", "history");
        const taken = await api.settings.setShortcut("find", "Ctrl+J");
        expectRefused(taken, "invalid");
        expect(isRefused(taken) && taken.refusal.message).toMatch(/Find and play/);
        expect(valueOf(await api.settings.resetShortcuts()).shortcuts).toEqual({});
        valueOf(await api.history.undo());
        expect((await api.settings.get()).shortcuts).toEqual({ palette: "Ctrl+J" });
        expect(valueOf(await api.settings.setCrossfade({ ms: 5000, curve: "power" })).crossfade).toEqual({ ms: 5000, curve: "power" });
        expectRefused(await api.settings.setCrossfade({ ms: -1, curve: "even" }), "invalid");
        expect(valueOf(await api.settings.setNextSceneGuard(false)).nextSceneGuard).toBe(false);
        const before = await api.history.state();
        const computer = await api.settings.setComputer({ display: { density: "comfortable", textSize: 150 }, devices: { split: true, previewEar: "right" }, globalKeys: true });
        expect(valueOf(computer)).toMatchObject({ display: { density: "comfortable", textSize: 150, highContrast: false }, devices: { split: true, previewEar: "right" }, globalKeys: true });
        expect(computer.ok && computer.undoLabel).toBe(before.undoLabel);
        expect(await api.history.state()).toEqual(before);
        expectRefused(await api.settings.setComputer({ display: { textSize: 300 } }), "invalid");
        expectRefused(await api.settings.setComputer({ devices: { previewEar: "middle" as never } }), "invalid");
      });
    });

    describe("undo and redo", () => {
      it("starts with nothing to undo or redo", async () => {
        expect(await api.history.state()).toEqual({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
        expectRefused(await api.history.undo(), "nothing-to-undo");
        expectRefused(await api.history.redo(), "nothing-to-redo");
      });

      it("undoes and redoes a write, saying in plain words what it undoes, and tells screens what to reload", async () => {
        const write = await api.playlists.update("p-inn", { name: "The Gull" });
        expect(write.ok && write.undoLabel).toBeTruthy();
        const state = await api.history.state();
        expect(state).toMatchObject({ canUndo: true, canRedo: false });
        expect(write.ok && write.undoLabel).toBe(state.undoLabel);
        events.length = 0;
        expect(valueOf(await api.history.undo()).undone).toBe(state.undoLabel);
        expect((await api.playlists.list()).find((p) => p.id === "p-inn").name).toBe("Greyhollow inn");
        await changedEvent("playlists", "history");
        expect(await api.history.state()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: state.undoLabel });
        expect(valueOf(await api.history.redo()).redone).toBe(state.undoLabel);
        expect((await api.playlists.list()).find((p) => p.id === "p-inn").name).toBe("The Gull");
      });

      it("undoes a delete with everything it touched, and a new write clears redo", async () => {
        const usesBefore = await api.campaigns.usesOf({ kind: "board", id: "abbey" });
        valueOf(await api.boards.delete("abbey"));
        valueOf(await api.history.undo());
        expect(await board("abbey")).toBeDefined();
        expect(await api.campaigns.usesOf({ kind: "board", id: "abbey" })).toEqual(usesBefore);
        valueOf(await api.boards.rename("spells", "Spells"));
        expect((await api.history.state()).canRedo).toBe(false);
      });

      it("a refused write changes nothing and makes no undo step", async () => {
        valueOf(await api.boards.rename("spells", "Spells"));
        const before = await api.history.state();
        expectRefused(await api.boards.resize("spells", 9, 9), "invalid");
        expect(await api.history.state()).toEqual(before);
        expect((await board("spells")).cols).toBe(3);
      });

      it("a write that changes nothing makes no undo step and no event", async () => {
        valueOf(await api.boards.rename("spells", "Spells"));
        await changedEvent("boards");
        const before = await api.history.state();
        events.length = 0;
        const same = await api.playlists.addTracks("p-after", ["t07"]);
        expect(valueOf(same)).toEqual({ added: [], alreadyIn: ["t07"] });
        expect(same.ok && same.changed).toEqual([]);
        expect(await api.history.state()).toEqual(before);
        await new Promise((r) => setTimeout(r, 20));
        expect(events.filter((e) => e.type === "changed")).toEqual([]);
      });

      it("an import leaves nothing to undo", async () => {
        valueOf(await api.boards.rename("spells", "Spells"));
        valueOf(await api.import.start({ from: "paths", paths: [fx.newAudioFiles[1]] }));
        expect((await api.history.state()).canUndo).toBe(false);
      });
    });

    describe("change events", () => {
      it("every write names its areas in its result and in a changed event; unsubscribing stops events", async () => {
        const done = await api.sessions.updateScene(sc("sc1"), { notes: "Short" });
        expect(done.ok && done.changed).toEqual(expect.arrayContaining(["campaigns", "history"]));
        await changedEvent("campaigns", "history");
        stop();
        const seen = events.length;
        valueOf(await api.sessions.updateScene(sc("sc1"), { notes: "Shorter" }));
        await new Promise((r) => setTimeout(r, 20));
        expect(events.length).toBe(seen);
      });
    });

    // Last, so it sees every test above (Vitest runs a file's tests in order); a filtered run skips it.
    it("calls every method and meets every refusal code", () => {
      const all = Object.entries(LYRE_API_METHODS).flatMap(([area, methods]) => methods.map((m) => `${area}.${m}`));
      expect(all.filter((m) => !called.has(m)), "methods the contract never called").toEqual([]);
      // DAT-7: an implementation that saves files meets "not-lyre-file"; one that does not yet meets "unavailable".
      const cannotMeet = fx.transferFiles ? ["unavailable"] : ["not-lyre-file"];
      expect(REFUSAL_CODES.filter((c) => !refused.has(c) && !cannotMeet.includes(c)), "refusal codes the contract never saw").toEqual([]);
    });
  });
}
