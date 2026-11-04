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
  placeKey,
  playlistTracks,
  resolveProfile,
  sceneSequence,
  usesOfBoard,
  usesOfPlaylist,
  usesOfTrack,
  type ProfilePlace,
} from "../domain";
import { isRefused, LYRE_API_METHODS, REFUSAL_CODES, type Done, type LyreApi, type LyreArea, type LyreEvent, type RefusalCode, type SceneAddress, type WriteResult } from "./api";
import { lookupFrom } from "./lookup";

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
      stop();
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

      it("resizes keeping each pad's row and column; pads that no longer fit go to spare, and undo puts them back", async () => {
        const done = valueOf(await api.boards.resize("abbey", 3, 3));
        expect(done.movedToSpare).toEqual(["organ", "stonedoor", "heartab"]);
        expect(done.board.slots.map((p) => p?.id ?? null)).toEqual(["bell", "bells", "whisper", "choir", "drip", "chains", "slam", "splash", "scream"]);
        expect(done.board.spare.map((p) => p.id)).toEqual(["organ", "stonedoor", "heartab"]);
        const wider = valueOf(await api.boards.resize("abbey", 5, 3));
        expect(wider.board.slots.map((p) => p?.id ?? null)).toEqual(["bell", "bells", "whisper", null, null, "choir", "drip", "chains", null, null, "slam", "splash", "scream", null, null]);
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
        expect((await api.import.findMissing()).map((m) => m.id)).not.toContain(fx.missingTrackId);
        expect((await api.history.state()).canUndo).toBe(true);
        expectRefused(await api.import.applyRelink([{ trackId: "nope", to: match.to }]), "not-found");
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
      expect(REFUSAL_CODES.filter((c) => !refused.has(c)), "refusal codes the contract never saw").toEqual([]);
    });
  });
}
