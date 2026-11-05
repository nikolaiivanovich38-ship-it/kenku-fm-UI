/**
 * Writes LyreApi seed data (src/common/lyre/seed.ts: the prototype's sample library) into a real library, keeping
 * every id, so the contract tests and the e2e specs see the same library the fake has. Test builds and tests only:
 * the app never seeds a game master's library (index.ts gates it on __CUE_DESK_TEST_BUILD__).
 * Written without undo history: the seeded library starts with nothing to undo.
 */
import { parseKeyOfPlace, parsePlaceKey } from "../../common/domain";
import type { SeedData } from "../../common/lyre/seed";
import { SAMPLE_FILE_BYTES } from "./sampleComputer";
import {
  addPad,
  addRoot,
  addSceneBoards,
  addSceneMusic,
  addToCampaign,
  addToSession,
  addTracksToPlaylist,
  createBoard,
  createCampaign,
  createPlaylist,
  createScene,
  createSession,
  createTag,
  createTagGroup,
  createTracks,
  setPlayOrder,
  setProfileOverride,
  setSceneAmbience,
  setSceneTrackName,
  updateTrack,
  type Library,
} from "../data";

export interface SeedOptions {
  /**
   * Test builds of the sample library: the tracks get the sample computer's file sizes (sampleComputer.ts), and the
   * library remembers the move from Kenku FM the prototype shows (data.js `moved`), with its three missing files.
   */
  sample?: boolean;
}

export async function seedLibrary(library: Library, seed: SeedData, options: SeedOptions = {}): Promise<void> {
  const { store } = library;
  if (store.get("SELECT 1 AS found FROM tracks LIMIT 1")) throw new Error("Only a new, empty library can be seeded.");
  // A new library starts with Lyre's own tag groups (Mood, Leitmotif, Scene type); the seed brings the prototype's.
  store.changeWithoutHistory(() => store.run("DELETE FROM tag_groups"));
  // The library folders first, so the tracks are stored relative to them.
  for (const folder of seed.folders) {
    await addRoot(store, { name: folder.path.split(/[\\/]/).pop() || folder.path, path: folder.path, watched: folder.watched });
  }
  const tagIds = new Map<string, string>();
  store.changeWithoutHistory(() => {
    for (const group of seed.tagGroups) {
      createTagGroup(store, { id: group.id, name: group.name });
      for (const value of group.values) tagIds.set(`${group.id}\u0000${value}`, createTag(store, { groupId: group.id, name: value }).id);
    }
    createTracks(
      store,
      seed.tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        metaTitle: t.metaTitle,
        file: { path: `${t.folder}\\${t.fileName}`, size: options.sample ? SAMPLE_FILE_BYTES : null },
        durationMs: t.durationMs,
        role: t.role,
        loopable: t.loop,
        energy: t.energy,
        profile: t.profile ?? null,
        notes: t.notes,
        sourceComposer: t.artist || null,
        sourceAlbum: t.album || null,
        isNew: t.isNew,
      })),
    );
    for (const t of seed.tracks) {
      store.run("UPDATE tracks SET created_at = ? WHERE id = ?", t.addedAt, t.id);
      if (t.shape) updateTrack(store, t.id, { shape: t.shape });
      for (const [group, values] of Object.entries(t.tags)) {
        for (const value of values) store.run("INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)", t.id, tagIds.get(`${group}\u0000${value}`));
      }
    }
    for (const p of seed.playlists) {
      createPlaylist(store, p.kind === "manual" ? { id: p.id, title: p.name, kind: "manual", lane: p.lane, notes: p.notes } : { id: p.id, title: p.name, kind: "dynamic", lane: p.lane, rule: p.rule, notes: p.notes });
      if (p.kind === "manual" && p.trackIds.length) addTracksToPlaylist(store, p.id, p.trackIds);
      if (p.order) setPlayOrder(store, p.id, null, p.order);
    }
    for (const b of seed.boards) {
      createBoard(store, { id: b.id, title: b.name, cols: b.cols, rows: b.rows });
      const pads = [
        ...b.slots.map((pad, i) => pad && { pad, at: { row: Math.floor(i / b.cols), col: i % b.cols } as { row: number; col: number } | "spare" }),
        ...b.spare.map((pad) => ({ pad, at: "spare" as const })),
      ].filter(Boolean);
      for (const { pad, at } of pads) {
        addPad(store, b.id, {
          id: pad.id,
          label: pad.label,
          icon: pad.icon,
          color: pad.color,
          hotkey: pad.key || null,
          mode: pad.mode,
          volume: pad.volume,
          fadeMs: pad.fadeOutMs,
          sound: { kind: pad.sound.kind, trackIds: pad.sound.trackIds, order: pad.sound.order, tagId: pad.sound.tag ? tagIds.get(`${pad.sound.tag.group}\u0000${pad.sound.tag.value}`) : null },
          at,
        });
        // addPad puts a pad added among the spare pads aside; a seed may say it was not put there by hand.
        if (at === "spare" && !pad.aside) store.run("UPDATE pads SET put_aside = 0 WHERE id = ?", pad.id);
      }
    }
    for (const c of seed.campaigns) {
      createCampaign(store, {
        id: c.id,
        name: c.name,
        system: c.system,
        theme: c.theme,
        description: c.description,
        notes: c.notes,
        obsidian: c.obsidian,
        firstSessionNumber: c.sessions[0]?.number ?? 1,
      });
      addToCampaign(store, c.id, { playlistIds: c.playlistIds, boardIds: c.boardIds, trackIds: c.trackIds });
      for (const s of c.sessions) {
        createSession(store, { id: s.id, campaignId: c.id, name: s.name, date: s.date, status: s.status, noteLink: s.noteLink });
        addToSession(store, s.id, { playlistIds: s.playlistIds, boardIds: s.boardIds, trackIds: s.trackIds });
        for (const sc of s.scenes) {
          createScene(store, { id: sc.id, sessionId: s.id, name: sc.name, startsWhen: sc.startsWhen, notes: sc.notes, noteLink: sc.noteLink });
          if (sc.music.length) addSceneMusic(store, sc.id, sc.music);
          if (sc.ambience) setSceneAmbience(store, sc.id, sc.ambience);
          if (sc.boardIds.length) addSceneBoards(store, sc.id, sc.boardIds);
          for (const [trackId, name] of Object.entries(sc.trackNames)) setSceneTrackName(store, sc.id, trackId, name);
        }
      }
    }
    for (const [key, byTrack] of Object.entries(seed.overrides)) {
      const place = parsePlaceKey(key);
      if (!place) throw new Error(`The seed has an audio profile for an unknown place: ${key}`);
      for (const [trackId, profile] of Object.entries(byTrack)) setProfileOverride(store, place, trackId, profile);
    }
    for (const [key, byPlaylist] of Object.entries(seed.playOrders)) {
      const place = parseKeyOfPlace(key);
      if (!place) throw new Error(`The seed has a play order for an unknown place: ${key}`);
      for (const [playlistId, order] of Object.entries(byPlaylist)) setPlayOrder(store, playlistId, place, order);
    }
    if (options.sample) {
      // What the first start's move from the old player records (import/legacy.ts, the "legacy-player" job), as
      // the prototype's move report shows it: Kenku FM 1.5.5, its counts, bookmarks and the files it could not find.
      const counts = Object.fromEntries(seed.moved.copied.map((row) => [row.what.toLowerCase(), row.count]));
      const report = { status: "moved", from: seed.moved.from, counts: { playlists: counts.playlists, tracks: counts.tracks, boards: counts.soundboards, pads: counts.sounds }, bookmarks: counts.bookmarks, missingTrackIds: [...seed.missing] };
      store.run("INSERT INTO library_jobs (name, state, detail, started_at, finished_at) VALUES ('legacy-player', 'done', ?, ?, ?)", JSON.stringify({ backupPath: null, report }), seed.moved.at, seed.moved.at);
    }
  });
  store.clearHistory();
}
