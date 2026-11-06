/**
 * DAT-7 in the main-process LyreApi: Save to a file, Open a file and Bring in, over real .lyre files.
 * - A round trip of the prototype's sample data at every scope: saved from the sample library, brought into an empty
 *   one, it holds the same things with the same names, orders, tags and settings.
 * - Every refusal: not a Lyre file, damaged, changed, newer, unsafe names; nothing changes.
 * - Skip, Merge and Keep both, in one undo step, with a backup first; audio files unpacked and checked.
 * - A large library within the time budgets (docs/testing.md).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRefused, type LyreApi, type OpenedFile, type TransferScope, type WriteResult } from "../../common/lyre/api";
import { valueOf } from "../../common/lyre/contract";
import { prototypeSeed } from "../../common/lyre/seed";
import { createTracks, openLibrary, type Library } from "../data";
import { budget } from "../data/testing/perfBudget";
import { writeZip } from "../transfer/zip";
import { createLibraryApi, type LibraryHost } from "./libraryApi";
import { seedLibrary } from "./seedLibrary";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const host: LibraryHost = { chooseFiles: async () => null, chooseFolder: async () => null, showItemInFolder: () => undefined, chooseSaveFile: async () => null, chooseLyreFile: async () => null };

function folder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-transfer-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function libraryAt(dir: string, seeded: boolean): Promise<{ library: Library; api: LyreApi & { stopBackgroundWork(): void } }> {
  const library = openLibrary({ folder: path.join(dir, "library") });
  if (seeded) await seedLibrary(library, prototypeSeed());
  // A new library starts with Lyre's own tag groups; without them a round trip can compare the groups exactly.
  else library.store.changeWithoutHistory(() => library.store.run("DELETE FROM tag_groups"));
  const api = createLibraryApi(library, host, { transfer: { broughtInFolder: path.join(dir, "Brought in"), today: () => Date.UTC(2026, 10, 5, 12) } });
  cleanups.unshift(() => {
    api.stopBackgroundWork();
    library.close();
  });
  return { library, api };
}

function refusal(result: WriteResult<unknown>) {
  if (!isRefused(result)) throw new Error("expected a refusal");
  return result.refusal;
}

/** The library with ids replaced by names, so two libraries can be compared after ids were mapped. */
async function namesOf(api: LyreApi) {
  const tracks = await api.library.listTracks();
  const groups = new Map((await api.tags.listGroups()).map((g) => [g.id, g.name]));
  const playlists = await api.playlists.list();
  const boards = await api.boards.list();
  const campaigns = await api.campaigns.list();
  const overrides = await api.profiles.overrides();
  const orders = await api.playlists.playOrders();
  const trackOrders = await api.playlists.trackOrders();
  const t = (id: string) => tracks.find((x) => x.id === id)?.fileName ?? `?${id}`;
  const p = (id: string) => playlists.find((x) => x.name && x.id === id)?.name ?? `?${id}`;
  const b = (id: string) => boards.find((x) => x.id === id)?.name ?? `?${id}`;
  const ref = (r: { kind: string; id: string }) => `${r.kind}:${r.kind === "track" ? t(r.id) : p(r.id)}`;
  const placeName = (key: string) => {
    for (const c of campaigns) {
      if (key === `cp:${c.id}`) return `campaign ${c.name}`;
      for (const s of c.sessions) {
        if (key === `ss:${c.id}:${s.id}`) return `session ${c.name}/${s.number}`;
        for (const sc of s.scenes) if (key === `sc:${c.id}:${s.id}:${sc.id}`) return `scene ${c.name}/${s.number}/${sc.name}`;
      }
    }
    for (const pl of playlists) if (key === `pl:${pl.id}`) return `playlist ${pl.name}`;
    return `?${key}`;
  };
  const names = Object.fromEntries(campaigns.flatMap((c) => c.sessions.flatMap((s) => s.scenes.map((sc) => [`${c.name}/${sc.name}`, Object.fromEntries(Object.entries(sc.trackNames).map(([id, name]) => [t(id), name]))]))));
  return {
    tracks: tracks.map((x) => ({ file: x.fileName, title: x.title, kind: x.kind, tags: Object.fromEntries(Object.entries(x.tags).filter(([, v]) => v.length).map(([g, v]) => [groups.get(g), [...v].sort()])), energy: x.energy, role: x.role, shape: x.shape, profile: x.profile ?? null })).sort((a, b2) => a.file.localeCompare(b2.file)),
    playlists: playlists.map((x) => ({ name: x.name, lane: x.lane, order: x.order, ...(x.kind === "manual" ? { tracks: x.trackIds.map(t) } : { rule: { ...x.rule, conds: x.rule.conds.map((c) => ({ ...c, group: groups.get(c.group) })) } }) })),
    boards: boards.map((x) => ({ name: x.name, size: `${x.cols}x${x.rows}`, pads: x.slots.map((pad) => pad && `${pad.label} ${pad.key} ${pad.sound.trackIds.map(t).join("+")}${pad.sound.tag ? ` tag ${pad.sound.tag.value}` : ""}`), spare: x.spare.map((pad) => `${pad.label}${pad.aside ? " aside" : ""}`) })),
    campaigns: campaigns.map((c) => ({
      name: c.name, theme: c.theme, onHand: [...c.playlistIds.map(p), ...c.boardIds.map(b), ...c.trackIds.map(t)],
      sessions: c.sessions.map((s) => ({ number: s.number, name: s.name, status: s.status, onHand: [...s.playlistIds.map(p), ...s.boardIds.map(b), ...s.trackIds.map(t)], scenes: s.scenes.map((sc) => ({ name: sc.name, music: sc.music.map(ref), ambience: sc.ambience && ref(sc.ambience), boards: sc.boardIds.map(b), repeatOnes: sc.repeatOnes.map(t).sort() })) })),
    })),
    sceneNames: names,
    overrides: Object.fromEntries(Object.entries(overrides).map(([k, v]) => [placeName(k), Object.fromEntries(Object.entries(v).map(([id, prof]) => [t(id), prof]))])),
    orders: Object.fromEntries(Object.entries(orders).map(([k, v]) => [placeName(k), Object.fromEntries(Object.entries(v).map(([id, o]) => [p(id), o]))])),
    trackOrders: Object.fromEntries(Object.entries(trackOrders).map(([k, v]) => [placeName(k), Object.fromEntries(Object.entries(v).map(([id, ids]) => [p(id), ids.map(t)]))])),
  };
}

/** Round 7 in a .lyre file: tags inside tags with their other words, dividers, steps and Then, how a track plays, mix out. */
describe("DAT-7 with round 7's data", () => {
  it("keeps tag places, dividers, a scene's and a pad's own steps, Then, Follow with, Ending, Pick up and the mix-out marker", async () => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), true);
    const ruins = { campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
    valueOf(await from.api.playlists.addDivider("p-abbess", "After the font", 2));
    valueOf(await from.api.boards.setDivider("abbey", 1, "Spells"));
    valueOf(await from.api.tags.updateTag({ group: "mood", value: "Tense" }, { color: "ember" }));
    valueOf(await from.api.boards.setPadSteps("abbey", "bell", [{ do: "sound" }, { do: "pad", boardId: "abbey", padId: "slam" }]));
    valueOf(await from.api.sessions.setSceneSteps(ruins, [{ do: "fade", level: 0.3, ms: 2000 }, { do: "pad", boardId: "abbey", padId: "bell" }, { do: "scene", scene: { ...ruins, sceneId: "sc4" } }], { when: "musicEnds" }));
    valueOf(await from.api.library.updateTrack("t13", { fadesOut: true, resume: true, follow: { kind: "playlist", id: "p-ashen" } }));
    valueOf(await from.api.profiles.set("t13", null, { markers: [{ atMs: 30_000, label: "Low swell", mix: true }] }));
    const target = path.join(dir, "all.lyre");
    valueOf(await from.api.transfer.save({ scope: { kind: "library" }, includeAudio: false, path: target }));

    const to = await libraryAt(path.join(dir, "there"), false);
    const opened = valueOf(await to.api.transfer.open({ from: "path", path: target })) as OpenedFile;
    valueOf(await to.api.transfer.bringIn(opened.id, { all: "skip" }));
    const mood = (await to.api.tags.listGroups()).find((g) => g.name === "Mood");
    expect(mood.tags.find((t) => t.name === "Grief")?.parent).toBe("Melancholy");
    expect(mood.tags.find((t) => t.name === "Melancholy")?.also).toEqual(["sad", "sorrowful"]);
    expect(mood.tags.find((t) => t.name === "Tense")?.color).toBe("ember");
    const abbess = (await to.api.playlists.list()).find((p) => p.name === "The Abbess");
    expect(abbess.dividers).toEqual([{ id: expect.any(String), name: "After the font", at: 2 }]);
    const board = (await to.api.boards.list()).find((b) => b.name === "Drowned Abbey");
    expect(board.dividers).toEqual([{ row: 1, name: "Spells" }]);
    const pads = new Map([...board.slots, ...board.spare].filter(Boolean).map((p) => [p.label, p]));
    expect(pads.get("Abbey bell").steps).toEqual([{ do: "sound" }, { do: "pad", boardId: board.id, padId: pads.get("Door slams").id }]);
    const crown = (await to.api.campaigns.list()).find((c) => c.name === "The Sunken Crown");
    const s14 = crown.sessions.find((s) => s.number === 14);
    const scene = s14.scenes.find((x) => x.name === "The abbey ruins");
    const next = s14.scenes.find((x) => x.name === s14.scenes[s14.scenes.indexOf(scene) + 1].name);
    expect(scene.movesOn).toEqual({ when: "musicEnds" });
    expect(scene.steps).toEqual([
      { do: "fade", level: 0.3, ms: 2000 },
      { do: "pad", boardId: board.id, padId: pads.get("Abbey bell").id },
      { do: "scene", scene: { campaignId: crown.id, sessionId: s14.id, sceneId: next.id } },
    ]);
    const t13 = (await to.api.library.listTracks()).find((t) => t.fileName === "06 Bridge of Death.flac");
    const ashen = (await to.api.playlists.list()).find((p) => p.name === "Ashen King");
    expect(t13).toMatchObject({ fadesOut: true, resume: true, follow: { kind: "playlist", id: ashen.id } });
    expect(t13.profile?.markers).toEqual([{ atMs: 30_000, label: "Low swell", mix: true }]);
  });
});

const SCOPES: TransferScope[] = [
  { kind: "library" },
  { kind: "tags" },
  { kind: "campaign", campaignId: "crown" },
  { kind: "session", campaignId: "crown", sessionId: "s14" },
  { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" },
  { kind: "playlist", playlistId: "p-abbess" },
  { kind: "board", boardId: "combat" },
];

describe("DAT-7 Save to a file, then Bring in on another computer", () => {
  it.each(SCOPES.map((s) => [s.kind, s] as const))("a round trip of the sample library's %s keeps everything in it", async (_kind, scope) => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), true);
    // Round 6 (PLY-17, ORG-13): a Repeat one in a scene, and a playlist's track order in a scene and in a session list.
    const abbess = await from.api.playlists.tracks("p-abbess");
    valueOf(await from.api.sessions.setRepeatOne({ campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, "t13", true));
    valueOf(await from.api.playlists.setTrackOrder("p-abbess", { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" }, [...abbess].reverse()));
    valueOf(await from.api.playlists.setTrackOrder("p-wistful", { kind: "session", campaignId: "crown", sessionId: "s14" }, [...(await from.api.playlists.tracks("p-wistful"))].reverse()));
    from.library.store.clearHistory();
    const target = path.join(dir, "Shared", "file.lyre");
    fs.mkdirSync(path.dirname(target));
    const saved = valueOf(await from.api.transfer.save({ scope, includeAudio: false, path: target }));
    expect(saved.summary).toBe(`Saved file.lyre (${saved.bytes >= 1e6 ? `${Math.round(saved.bytes / 1e6)} MB` : `${Math.max(1, Math.round(saved.bytes / 1000))} KB`}) in ${path.join(dir, "Shared")}.`);
    expect((await from.api.history.state()).canUndo).toBe(false);

    // The other computer: an empty library, with only the sample's tag groups (a new library's own are the same three).
    const to = await libraryAt(path.join(dir, "there"), false);
    const opened = valueOf(await to.api.transfer.open({ from: "path", path: target })) as OpenedFile;
    expect(opened.items.every((i) => i.status === "new")).toBe(true);
    const report = valueOf(await to.api.transfer.bringIn(opened.id, { all: "skip" }));
    expect(report.skipped).toEqual([]);

    // What the file held, compared by names (ids are new on the other computer).
    const expected = await namesOf(from.api);
    const got = await namesOf(to.api);
    const estimate = await from.api.transfer.estimate(scope);
    expect(got.tracks.length).toBe(estimate.counts.tracks);
    const want = <T extends { name: string }>(all: T[], names: string[]) => all.filter((x) => names.includes(x.name));
    const files = got.tracks.map((x) => x.file);
    expect(got.tracks).toEqual(expected.tracks.filter((x) => files.includes(x.file)));
    expect(got.playlists).toEqual(want(expected.playlists, got.playlists.map((x) => x.name)));
    expect(got.boards).toEqual(want(expected.boards, got.boards.map((x) => x.name)));
    expect(got.playlists.length).toBe(estimate.counts.playlists);
    expect(got.boards.length).toBe(estimate.counts.boards);
    if (scope.kind === "library" || scope.kind === "campaign") {
      expect(got.campaigns).toEqual(want(expected.campaigns, got.campaigns.map((c) => c.name)));
      for (const [place, settings] of Object.entries(got.overrides)) expect(settings, place).toEqual(expected.overrides[place]);
      expect(Object.keys(got.overrides).length).toBeGreaterThan(0);
      for (const [place, orders] of Object.entries(got.orders)) expect(orders, place).toEqual(expected.orders[place]);
      expect(Object.keys(got.orders).length).toBeGreaterThan(0);
      for (const [scene, names] of Object.entries(got.sceneNames)) expect(names, scene).toEqual(expected.sceneNames[scene]);
      expect(got.trackOrders).toEqual(expected.trackOrders);
      expect(Object.keys(got.trackOrders).length).toBe(2);
    }
    if (scope.kind === "session") expect(Object.keys(got.trackOrders).sort()).toEqual(["scene The Sunken Crown/14/The abbey ruins", "session The Sunken Crown/14"]);
    if (scope.kind === "scene") expect(Object.keys(got.trackOrders)).toEqual(["scene The Sunken Crown/14/The abbey ruins"]);
    if (scope.kind === "session" || scope.kind === "scene") {
      const [c] = got.campaigns;
      expect(c.name).toBe("The Sunken Crown");
      const original = expected.campaigns.find((x) => x.name === c.name);
      const session = original.sessions.find((s) => s.number === 14);
      expect(c.sessions[0].scenes).toEqual(scope.kind === "scene" ? session.scenes.filter((sc) => sc.name === "The abbey ruins") : session.scenes);
    }
    if (scope.kind === "tags") {
      const groups = await to.api.tags.listGroups();
      expect(groups.map((g) => [g.name, g.values])).toEqual((await from.api.tags.listGroups()).map((g) => [g.name, g.values]));
    }
    // Their audio files were not in the file: the tracks wait for Find missing files.
    if (got.tracks.length) expect(report.missingFiles).toBe(got.tracks.length);
    // One step to undo.
    expect((await to.api.history.state()).undoLabel).toBe("Bring in file.lyre");
  });

  it("keeps a playlist's and a track's Normalise volume choice, and leaves the measured loudness behind (PLY-15)", async () => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), true);
    const target = path.join(dir, "file.lyre");
    valueOf(await from.api.transfer.save({ scope: { kind: "library" }, includeAudio: false, path: target }));
    const to = await libraryAt(path.join(dir, "there"), false);
    const opened = valueOf(await to.api.transfer.open({ from: "path", path: target })) as OpenedFile;
    valueOf(await to.api.transfer.bringIn(opened.id, { all: "skip" }));
    const ashen = (await to.api.playlists.list()).find((p) => p.name === "Ashen King");
    expect(ashen?.normalise).toBe("on");
    const was = (await from.api.library.listTracks()).find((t) => t.normalise === "off");
    expect(was).toBeDefined();
    const now = (await to.api.library.listTracks()).find((t) => t.fileName === was?.fileName);
    expect(now?.normalise).toBe("off");
    expect(now?.loudness).toBeNull();
  });

  it("takes the audio files along when asked, unpacks them next to the library and plays them from there", async () => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), false);
    const music = path.join(dir, "Music");
    fs.mkdirSync(music);
    // Each starts the way its kind of file starts: Lyre unpacks only what looks like audio (security review w4).
    const flac = Buffer.alloc(100_000, 7);
    flac.write("fLaC");
    fs.writeFileSync(path.join(music, "a.flac"), flac);
    fs.writeFileSync(path.join(music, "b.ogg"), "OggS bytes");
    createTracks(from.library.store, [{ kind: "music", file: { path: path.join(music, "a.flac"), size: 100_000 }, durationMs: 1000 }, { kind: "music", file: { path: path.join(music, "b.ogg"), size: 10 }, durationMs: 2000 }]);
    const [a, b] = await from.api.library.listTracks();
    valueOf(await from.api.playlists.create({ name: "Two", lane: "music", kind: "manual", trackIds: [a.id, b.id] }));
    const pl = (await from.api.playlists.list())[0];
    expect((await from.api.transfer.estimate({ kind: "playlist", playlistId: pl.id })).audioBytes).toBe(100_010);
    const target = path.join(dir, "Two.lyre");
    const saved = valueOf(await from.api.transfer.save({ scope: { kind: "playlist", playlistId: pl.id }, includeAudio: true, path: target }));
    expect(saved.bytes).toBeGreaterThan(100_010);

    const to = await libraryAt(path.join(dir, "there"), false);
    const opened = valueOf(await to.api.transfer.open({ from: "path", path: target })) as OpenedFile;
    expect(opened.includesAudio).toBe(true);
    const report = valueOf(await to.api.transfer.bringIn(opened.id, {}));
    expect(report.missingFiles).toBe(0);
    expect(report.summary).toContain("2 audio files were unpacked next to your library.");
    expect(await to.api.import.findMissing()).toEqual([]);
    const tracks = await to.api.library.listTracks();
    const unpacked = path.join(dir, "there", "Brought in", "Two");
    expect(tracks.map((t) => t.folder).sort()).toEqual([unpacked, unpacked]);
    expect(fs.readFileSync(path.join(unpacked, "a.flac"))).toEqual(flac);
  });

  it("a file saved with the audio files of tracks whose files are gone says so, and leaves them out", async () => {
    const dir = folder();
    const { api } = await libraryAt(dir, true);
    const saved = valueOf(await api.transfer.save({ scope: { kind: "playlist", playlistId: "p-abbess" }, includeAudio: true, path: path.join(dir, "The Abbess.lyre") }));
    expect(saved.summary).toMatch(/5 audio files Lyre cannot find were left out: Find missing files looks for them\.$/);
  });

  it("asks where to save, suggesting the scope's file name; closing the dialog saves nothing", async () => {
    const dir = folder();
    const library = openLibrary({ folder: path.join(dir, "library") });
    await seedLibrary(library, prototypeSeed());
    const asked: string[] = [];
    let answer: string | null = null;
    const api = createLibraryApi(library, { ...host, chooseSaveFile: async (name) => (asked.push(name), answer) }, { transfer: { today: () => Date.UTC(2026, 10, 5, 12) } });
    cleanups.unshift(() => library.close());
    expect(valueOf(await api.transfer.save({ scope: { kind: "library" }, includeAudio: false }))).toBeNull();
    answer = path.join(dir, "mine");
    const saved = valueOf(await api.transfer.save({ scope: { kind: "campaign", campaignId: "crown" }, includeAudio: false }));
    expect(asked).toEqual(["Lyre library 2026-11-05.lyre", "The Sunken Crown.lyre"]);
    // A name without .lyre gets it, so the file opens again.
    expect(saved.path).toBe(path.join(dir, "mine.lyre"));
  });
});

describe("DAT-7 Open a file: anything Lyre does not open is refused in plain words, and nothing changes", () => {
  async function refusedWith(make: (file: string) => Promise<void> | void, name = "file.lyre") {
    const dir = folder();
    const { api } = await libraryAt(dir, true);
    const before = await namesOf(api);
    const file = path.join(dir, name);
    await make(file);
    const words = refusal(await api.transfer.open({ from: "path", path: file }));
    expect(await namesOf(api)).toEqual(before);
    expect((await api.history.state()).canUndo).toBe(false);
    return words;
  }
  /** A real file of the sample's campaign, for tests that change it. */
  async function realFile(file: string) {
    const dir = folder();
    const { api } = await libraryAt(dir, true);
    valueOf(await api.transfer.save({ scope: { kind: "campaign", campaignId: "crown" }, includeAudio: false, path: file }));
    return fs.readFileSync(file);
  }

  it("a file that does not end in .lyre", async () => {
    const r = await refusedWith((f) => fs.writeFileSync(f, "notes"), "notes.txt");
    expect(r).toEqual({ code: "not-lyre-file", message: '"notes.txt" is not a Lyre file. Lyre opens files saved with Save to a file (they end in .lyre).' });
  });

  it("a .lyre file that is not a zip, or is cut off part-way, is damaged", async () => {
    expect((await refusedWith((f) => fs.writeFileSync(f, "x"), "broken.lyre")).message).toBe('"broken.lyre" is damaged: it stops part-way, so Lyre cannot tell what is in it. Nothing was brought in. Ask for the file again.');
    const cut = await refusedWith(async (f) => {
      const whole = await realFile(f);
      fs.writeFileSync(f, whole.subarray(0, Math.floor(whole.length / 2)));
    });
    expect(cut.message).toContain("is damaged: it stops part-way");
  });

  it("a file whose bytes were changed", async () => {
    const r = await refusedWith(async (f) => {
      const whole = await realFile(f);
      whole[200] ^= 0xff;
      fs.writeFileSync(f, whole);
    });
    expect(r.message).toContain("is damaged");
  });

  it("a zip that is not a Lyre file, and one from a newer Lyre", async () => {
    expect((await refusedWith((f) => writeZip(f, [{ name: "photo.jpg", bytes: Buffer.from("x") }]).then((): void => undefined))).message).toContain("is not a Lyre file");
    const newer = await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: Buffer.from(JSON.stringify({ format: "lyre-library-file", version: 2 })) }]).then((): void => undefined));
    expect(newer.message).toBe('"file.lyre" was saved by a newer version of Lyre. Update Lyre, then open it again. Nothing was brought in.');
  });

  it("names that could leave the brought-in folder: an entry, an audio name, a track's file name", async () => {
    const manifest = (audio: unknown[] = []) => Buffer.from(JSON.stringify({ format: "lyre-library-file", version: 1, madeWith: "Lyre 0.4.0", savedAt: 0, scope: { kind: "library" }, title: "x", counts: { tracks: 0, playlists: 0, boards: 0, campaigns: 0, sessions: 0, scenes: 0, tagGroups: 0 }, audio }));
    const lib = (tracks: unknown[] = []) => Buffer.from(JSON.stringify({ tracks, tagGroups: [], playlists: [], boards: [], campaigns: [], overrides: {}, playOrders: {} }));
    const unsafe = 'holds files or names Lyre never puts in a Lyre file';
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest() }, { name: "library.json", bytes: lib() }, { name: "../../evil.dll", bytes: Buffer.from("MZ") }], { allowAnyName: true }).then((): void => undefined))).message).toContain(unsafe);
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest() }, { name: "library.json", bytes: lib() }, { name: "run.exe", bytes: Buffer.from("MZ") }]).then((): void => undefined))).message).toContain(unsafe);
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest([{ entry: "audio/../x.flac", trackId: "t", bytes: 1 }]) }, { name: "library.json", bytes: lib() }]).then((): void => undefined))).message).toContain(unsafe);
    const track: Record<string, unknown> = { id: "t", kind: "music", title: "", metaTitle: "", fileName: "..\\..\\Windows\\x.flac", durationMs: 1, role: null, loop: null, energy: null, tags: {}, profile: null, shape: null, artist: "", album: "", folder: "", notes: "", sizeBytes: null };
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest() }, { name: "library.json", bytes: lib([track]) }]).then((): void => undefined))).message).toContain(unsafe);
  });

  it("library.json in a shape Lyre does not write, and a prototype trick in it", async () => {
    const manifest = Buffer.from(JSON.stringify({ format: "lyre-library-file", version: 1, madeWith: "x", savedAt: 0, scope: { kind: "library" }, title: "x", counts: { tracks: 0, playlists: 0, boards: 0, campaigns: 0, sessions: 0, scenes: 0, tagGroups: 0 }, audio: [] }));
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest }, { name: "library.json", bytes: Buffer.from('{"tracks":"all of them"}') }]).then((): void => undefined))).message).toContain("is damaged");
    expect((await refusedWith((f) => writeZip(f, [{ name: "lyre.json", bytes: manifest }, { name: "library.json", bytes: Buffer.from('{"tracks":[],"tagGroups":[],"playlists":[],"boards":[],"campaigns":[],"overrides":{"__proto__":{"polluted":{}}},"playOrders":{}}') }]).then((): void => undefined))).message).toContain("is damaged");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("DAT-7 Bring in: Skip, Merge or Keep both, in one undo step, with a backup first", () => {
  async function ownCampaignFile() {
    const dir = folder();
    const lib = await libraryAt(dir, true);
    const file = path.join(dir, "The Sunken Crown from Sam.lyre");
    valueOf(await lib.api.transfer.save({ scope: { kind: "campaign", campaignId: "crown" }, includeAudio: false, path: file }));
    const opened = valueOf(await lib.api.transfer.open({ from: "path", path: file })) as OpenedFile;
    return { ...lib, dir, opened };
  }

  it("marks what you have already, and Skip for all keeps the library as it was", async () => {
    const { api, opened } = await ownCampaignFile();
    expect(opened.madeWith).toMatch(/^Lyre \d+\.\d+\.\d+, 5 Nov 2026$/);
    // You have every tag in it already, so there is no tags item.
    expect(opened.items.every((i) => i.status === "duplicate")).toBe(true);
    expect(opened.items.map((i) => i.kind)).toEqual(["campaign", ...opened.items.filter((i) => i.kind === "playlist").map(() => "playlist"), ...opened.items.filter((i) => i.kind === "board").map(() => "board"), "tracks"]);
    expect(opened.items.find((i) => i.kind === "campaign")).toMatchObject({ name: "The Sunken Crown", detail: "4 sessions, 9 scenes · yours has the same name", yours: { kind: "campaign", id: "crown" } });
    const before = await namesOf(api);
    const report = valueOf(await api.transfer.bringIn(opened.id, { all: "skip" }));
    expect(await namesOf(api)).toEqual(before);
    expect(report.summary).toMatch(/^Nothing new was brought in: you have everything in it already\. \d+ duplicates skipped\.$/);
  });

  it("Keep both adds copies named (from Sam) that use the copies, and Undo takes all of it back", async () => {
    const { api, library, opened } = await ownCampaignFile();
    const before = await namesOf(api);
    const count = () => (fs.existsSync(library.backupFolder) ? fs.readdirSync(library.backupFolder).length : 0);
    const backups = count();
    const report = valueOf(await api.transfer.bringIn(opened.id, { all: "keepBoth" }));
    expect(count()).toBe(backups + 1);
    const after = await namesOf(api);
    const copy = after.campaigns.find((c) => c.name === "The Sunken Crown (from Sam)");
    expect(copy.sessions.map((s) => s.number)).toEqual([12, 13, 14, 15]);
    // The copy's scenes play the copied playlists and tracks.
    expect(copy.sessions[2].scenes[2].music.some((m) => m.startsWith("playlist:") && m.endsWith("(from Sam)"))).toBe(true);
    expect(after.tracks.some((t) => t.title.endsWith("(from Sam)"))).toBe(true);
    expect(report.summary).toContain(`${report.keptBoth.length} copies named "(from Sam)".`);
    expect((await api.history.state()).undoLabel).toBe("Bring in The Sunken Crown from Sam.lyre");
    valueOf(await api.history.undo());
    expect(await namesOf(api)).toEqual(before);
  });

  it("Merge adds their sessions to your campaign as drafts and their new tracks to your playlists", async () => {
    const dir = folder();
    const theirs = await libraryAt(path.join(dir, "theirs"), true);
    valueOf(await theirs.api.playlists.addTracks("p-abbess", ["t01"]));
    const file = path.join(dir, "Crown.lyre");
    valueOf(await theirs.api.transfer.save({ scope: { kind: "campaign", campaignId: "crown" }, includeAudio: false, path: file }));
    const mine = await libraryAt(path.join(dir, "mine"), true);
    const opened = valueOf(await mine.api.transfer.open({ from: "path", path: file })) as OpenedFile;
    valueOf(await mine.api.transfer.bringIn(opened.id, { all: "merge" }));
    const crown = await mine.api.campaigns.get("crown");
    expect(crown.sessions.map((s) => [s.number, s.status])).toEqual([[12, "played"], [13, "played"], [14, "next"], [15, "draft"], [16, "draft"], [17, "draft"], [18, "draft"], [19, "draft"]]);
    expect((await mine.api.playlists.list()).find((p) => p.id === "p-abbess")).toMatchObject({ trackIds: ["t41", "t14", "t15", "t21", "t36", "t01"] });
    expect((await mine.api.library.listTracks()).length).toBe(prototypeSeed().tracks.length);
  });

  it("refuses to bring in a file that is no longer open", async () => {
    const { api, opened } = await ownCampaignFile();
    valueOf(await api.transfer.bringIn(opened.id, {}));
    expect(refusal(await api.transfer.bringIn(opened.id, {})).code).toBe("not-found");
  });
});

describe("DAT-7 a large library", () => {
  it.skipIf(process.env.CUE_DESK_SKIP_PERF === "1")("saves, opens and brings in 20,000 tracks within the budgets, never holding the process for long", async () => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), true);
    const many = Array.from({ length: 20_000 }, (_, i) => ({ kind: "music" as const, title: `Cue ${i}`, file: { path: path.join(dir, "Music", `${i}.flac`), size: 9_000_000 }, durationMs: 120_000 + i }));
    for (let i = 0; i < many.length; i += 2000) createTracks(from.library.store, many.slice(i, i + 2000));
    const target = path.join(dir, "big.lyre");
    let longest = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    const started = performance.now();
    valueOf(await from.api.transfer.save({ scope: { kind: "library" }, includeAudio: false, path: target }));
    const saved = performance.now();
    const to = await libraryAt(path.join(dir, "there"), false);
    last = performance.now();
    longest = 0;
    const openedAt = performance.now();
    const opened = valueOf(await to.api.transfer.open({ from: "path", path: target })) as OpenedFile;
    const openTook = performance.now() - openedAt;
    const report = valueOf(await to.api.transfer.bringIn(opened.id, {}));
    const done = performance.now();
    clearInterval(timer);
    expect(report.missingFiles).toBe(20_000 + prototypeSeed().tracks.length);
    expect(saved - started).toBeLessThan(budget(5_000));
    expect(openTook).toBeLessThan(budget(3_000));
    expect(done - saved).toBeLessThan(budget(30_000));
    // Bringing in runs in batches with the process free between them (the library's process answers other calls).
    expect(longest).toBeLessThan(budget(1_500));
  }, 120_000);
});

describe("PERF-10: every file the library opens is closed (no DEP0137 FileHandle warning)", () => {
  it("a .lyre file opened and not brought in is closed when the library stops", async () => {
    const dir = folder();
    const from = await libraryAt(path.join(dir, "here"), true);
    const target = path.join(dir, "file.lyre");
    valueOf(await from.api.transfer.save({ scope: { kind: "board", boardId: "combat" }, includeAudio: false, path: target }));
    const handles: fs.promises.FileHandle[] = [];
    const open = fs.promises.open;
    const spy = vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      handles.push(handle);
      return handle;
    });
    const to = await libraryAt(path.join(dir, "there"), false);
    valueOf(await to.api.transfer.open({ from: "path", path: target }));
    valueOf(await to.api.transfer.open({ from: "path", path: target }));
    expect(handles.length).toBeGreaterThan(0);
    // The first was closed when the second opened; the second stays open for Bring in, until the library stops.
    expect(handles.filter((h) => h.fd !== -1)).toHaveLength(1);
    to.api.stopBackgroundWork();
    await vi.waitFor(() => expect(handles.every((h) => h.fd === -1)).toBe(true));
    spy.mockRestore();
  });
});
