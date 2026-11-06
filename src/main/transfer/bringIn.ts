/**
 * DAT-7 Open a file and Bring in (design/prototype/src/views/transfer.js): what an opened .lyre file holds next to
 * the library (`describeFile`: new, or a duplicate of something yours), and bringing it in as the game master chose
 * (`bringIn`: Skip, Merge or Keep both per duplicate) in one undo step.
 *
 * - Everything gets new ids here; references inside the file (a playlist's tracks, a scene's music, a pad's sounds,
 *   audio settings per place) are mapped to them. A reference to something the file does not hold is dropped.
 * - Skip keeps yours as it is and the file's other things use yours. Merge adds what is new in theirs to yours
 *   (a manual playlist's tracks, a board's pads by label, a campaign's sessions, a track's tags and empty fields).
 *   Keep both adds theirs as a copy named "(from <who>)".
 * - Duplicates: tracks with the same file name and length (within a second); playlists, boards and campaigns with
 *   the same name (any letter case).
 * - Files: a track's audio from the file is unpacked into the brought-in folder; a track without it points there too
 *   (Find missing files relinks it), unless its old place is under one of this library's folders. So a file never
 *   names a place on this computer Lyre would not otherwise read (docs/security.md, "w4-transfer").
 */
import path from "path";

import { parseKeyOfPlace, parsePlaceKey, type ProfilePlace, type SoundRef, type UsePlace } from "../../common/domain";
import type { BringInChoices, BringInReport, DuplicateChoice, IncomingItem, LibraryTrack, PlaylistInfo, TagGroup } from "../../common/lyre/api";
import { plural, shownTitle } from "../../common/lyre/text";
import {
  addPad,
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
  findTrackByLocation,
  listRoots,
  listTagGroups,
  listTags,
  setPlayOrder,
  setProfileOverride,
  setSceneAmbience,
  setSceneTrackName,
  tagTracks,
  updateTrack,
  type Store,
  type TrackInput,
} from "../data";
import { setPlaylistNormalise, setTrackNormalise } from "../data/repo/normalise";
import { findRoot, isAbsolutePath, normalizePath } from "../data/paths";
import type { FileTrack, LyreFileLibrary } from "./lyreFile";

/** The library as it is now, in the API's shapes (what the duplicates are found against). */
export interface CurrentLibrary {
  tracks: readonly LibraryTrack[];
  playlists: readonly PlaylistInfo[];
  boards: readonly { id: string; name: string; slots: readonly ({ label: string } | null)[]; spare: readonly { label: string }[] }[];
  campaigns: readonly { id: string; name: string }[];
  tagGroups: readonly TagGroup[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Same file name and length, within a second (another computer may round the length differently). */
const sameTrack = (a: { fileName: string; durationMs: number }, b: { fileName: string; durationMs: number }) =>
  same(a.fileName, b.fileName) && Math.abs(a.durationMs - b.durationMs) < 1000;

/** Your track for a file's track, found by file name through an index (a large library has tens of thousands). */
const yourTracks = new WeakMap<readonly LibraryTrack[], Map<string, LibraryTrack[]>>();
function yoursFor(mine: CurrentLibrary, t: { fileName: string; durationMs: number }): LibraryTrack | undefined {
  let index = yourTracks.get(mine.tracks);
  if (!index) {
    index = new Map();
    for (const m of mine.tracks) {
      const key = m.fileName.trim().toLowerCase();
      const list = index.get(key);
      if (list) list.push(m);
      else index.set(key, [m]);
    }
    yourTracks.set(mine.tracks, index);
  }
  return index.get(t.fileName.trim().toLowerCase())?.find((m) => sameTrack(m, t));
}

/** Who a file came from, for "(from Sam)": "Curse of Strahd from Sam.lyre" gives Sam; otherwise the file's name. */
export function fromWhom(fileName: string): string {
  const stem = fileName.replace(/\.lyre$/i, "").trim();
  const match = stem.match(/\bfrom\s+(.+)$/i);
  return (match ? match[1] : stem).trim() || "the file";
}

export interface FileItem extends IncomingItem {
  /** The file's ids this item covers (playlist, board, campaign), or every track id for "tracks". */
  fileIds: string[];
}

/** The items the Open a file box lists, in the prototype's order: campaigns, playlists, boards, tracks, tags. */
export function describeFile(file: LyreFileLibrary, mine: CurrentLibrary): FileItem[] {
  const items: FileItem[] = [];
  for (const c of file.campaigns) {
    const yours = mine.campaigns.find((x) => same(x.name, c.name));
    const scenes = c.sessions.reduce((n, s) => n + s.scenes.length, 0);
    items.push({
      key: `campaign:${c.id}`, kind: "campaign", name: c.name, fileIds: [c.id],
      detail: `${plural(c.sessions.length, "session")}, ${plural(scenes, "scene")}${yours ? " · yours has the same name" : ""}`,
      status: yours ? "duplicate" : "new", yours: yours ? { kind: "campaign", id: yours.id } : null,
    });
  }
  for (const p of file.playlists) {
    const yours = mine.playlists.find((x) => same(x.name, p.name));
    const what = p.kind === "dynamic" ? "Dynamic" : plural(p.trackIds.length, "track");
    const theirs = yours && yours.kind === "manual" && p.kind === "manual" && yours.trackIds.length === p.trackIds.length ? ` and ${plural(p.trackIds.length, "track")}` : "";
    items.push({
      key: `playlist:${p.id}`, kind: "playlist", name: p.name, fileIds: [p.id],
      detail: `${what}${yours ? ` · yours has the same name${theirs}` : ""}`,
      status: yours ? "duplicate" : "new", yours: yours ? { kind: "playlist", id: yours.id } : null,
    });
  }
  for (const b of file.boards) {
    const yours = mine.boards.find((x) => same(x.name, b.name));
    const pads = [...b.slots, ...b.spare].filter(Boolean).length;
    items.push({
      key: `board:${b.id}`, kind: "board", name: b.name, fileIds: [b.id],
      detail: `${plural(pads, "pad")}${yours ? " · yours has the same name" : ""}`,
      status: yours ? "duplicate" : "new", yours: yours ? { kind: "board", id: yours.id } : null,
    });
  }
  if (file.tracks.length) {
    const dupes = file.tracks.filter((t) => yoursFor(mine, t)).length;
    items.push({
      key: "tracks", kind: "tracks", name: plural(file.tracks.length, "track"), fileIds: file.tracks.map((t) => t.id),
      detail: dupes ? `${dupes} ${dupes === 1 ? "is" : "are"} already in your library (same file name and length)` : "All new to your library",
      status: dupes ? "duplicate" : "new", yours: null,
    });
  }
  const fresh = newTagValues(file, mine);
  if (file.tagGroups.length && (fresh.length || !items.length)) {
    items.push({
      key: "tags", kind: "tags", name: fresh.length ? plural(fresh.length, "new tag value") : "Tags", fileIds: [],
      detail: fresh.length ? groupWords(fresh) : "You have every tag in it already",
      status: "new", yours: null,
    });
  }
  return items;
}

/** "Mood: Gothic · Leitmotif: Strahd, Ireena". */
function groupWords(values: { group: string; value: string }[]): string {
  const byGroup = new Map<string, string[]>();
  for (const v of values) byGroup.set(v.group, [...(byGroup.get(v.group) ?? []), v.value]);
  return [...byGroup].map(([g, vs]) => `${g}: ${vs.join(", ")}`).join(" · ");
}

function newTagValues(file: LyreFileLibrary, mine: CurrentLibrary): { group: string; value: string }[] {
  const out: { group: string; value: string }[] = [];
  for (const g of file.tagGroups) {
    const yours = mine.tagGroups.find((x) => x.id === g.id) ?? mine.tagGroups.find((x) => same(x.name, g.name));
    for (const value of g.values) if (!yours?.values.some((v) => same(v, value))) out.push({ group: g.name, value });
  }
  return out;
}

/** The file's tracks that bringing in with these choices adds as tracks of their own (not mapped to yours). */
export function tracksToAdd(file: LyreFileLibrary, mine: CurrentLibrary, choices: BringInChoices): FileTrack[] {
  const item = describeFile(file, mine).find((i) => i.kind === "tracks");
  const choice = item?.status === "duplicate" ? (choices.each?.[item.key] ?? choices.all ?? "skip") : "new";
  return file.tracks.filter((t) => choice === "keepBoth" || !yoursFor(mine, t));
}

export interface BringInOptions {
  fileName: string;
  /** Where this file's tracks live: "<brought-in folder>\<file name>"; their audio is unpacked here. */
  folder: string;
  /** Tracks whose audio the file holds: the file name it is unpacked to (already unpacked by the caller). */
  unpacked: Map<string, string>;
  includesAudio: boolean;
}

/**
 * Brings the file in as one undo step ("Bring in <file>"), in batches of tracks with the event loop free between
 * them (one undo step still). Throws the library's own errors (ValidationError) for something it cannot take;
 * the change is then undone as a whole.
 */
export async function bringIn(store: Store, file: LyreFileLibrary, mine: CurrentLibrary, choices: BringInChoices, options: BringInOptions): Promise<BringInReport> {
  const items = describeFile(file, mine);
  const choiceOf = (item: FileItem): DuplicateChoice | "new" => (item.status === "new" ? "new" : (choices.each?.[item.key] ?? choices.all ?? "skip"));
  const from = ` (from ${fromWhom(options.fileName)})`;
  const report: BringInReport = { added: [], merged: [], keptBoth: [], skipped: [], missingFiles: 0, summary: "" };
  const trackItem = items.find((i) => i.kind === "tracks");
  const trackChoice = trackItem ? choiceOf(trackItem) : "new";

  const trackMap = new Map<string, string>();
  const playlistMap = new Map<string, string>();
  const boardMap = new Map<string, string>();
  /** Places this bring-in made (their audio settings and play orders come with them), file key → new place. */
  const sceneMap = new Map<string, { campaignId: string; sessionId: string; sceneId: string }>();
  const sessionMap = new Map<string, { campaignId: string; sessionId: string }>();
  const campaignMap = new Map<string, string>();
  const newPlaylists = new Set<string>();
  const newTracks = new Set<string>();
  let tagIdOf: (group: string, value: string) => string | undefined = () => undefined;
  let copiedTracks = 0;
  let mergedTracks = 0;
  let skippedTracks = 0;

  const roots = listRoots(store);
  const planned = new Set<string>();
  /** A free path for a track in the brought-in folder (another file of the same name gets " (2)"). */
  const placeFor = (track: FileTrack) => {
    const unpacked = options.unpacked.get(track.id);
    if (unpacked) return unpacked;
    const old = track.folder && isAbsolutePath(track.folder) ? normalizePath(`${track.folder}${track.folder.includes("\\") ? "\\" : "/"}${track.fileName}`) : null;
    if (old && findRoot(roots, old) && !findTrackByLocation(store, { file: old }, roots) && !planned.has(old.toLowerCase())) {
      planned.add(old.toLowerCase());
      return old;
    }
    const ext = path.extname(track.fileName);
    const stem = track.fileName.slice(0, track.fileName.length - ext.length) || "track";
    for (let n = 1; ; n++) {
      const candidate = path.join(options.folder, `${stem}${n === 1 ? "" : ` (${n})`}${ext}`);
      if (!planned.has(candidate.toLowerCase()) && !findTrackByLocation(store, { file: candidate }, roots)) {
        planned.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };

  /** Tag groups and values first (tracks, dynamic rules and pads name them): yours by id, else by name, else new. */
  const bringTags = () => {
    const groups = listTagGroups(store);
    const groupOf = new Map<string, string>();
    for (const g of file.tagGroups) {
      const yours = groups.find((x) => x.id === g.id) ?? groups.find((x) => same(x.name, g.name));
      groupOf.set(g.id, yours ? yours.id : createTagGroup(store, { name: g.name }).id);
    }
    // Values the file's tracks, rules and pads name, even ones its tag list leaves out.
    const wanted = new Map<string, Set<string>>();
    const want = (group: string, value: string) => {
      if (!groupOf.has(group) || !value.trim()) return;
      wanted.set(group, (wanted.get(group) ?? new Set()).add(value));
    };
    file.tagGroups.forEach((g) => g.values.forEach((v) => want(g.id, v)));
    file.tracks.forEach((t) => Object.entries(t.tags).forEach(([g, vs]) => vs.forEach((v) => want(g, v))));
    file.playlists.forEach((p) => p.kind === "dynamic" && p.rule.conds.forEach((c) => c.values.forEach((v) => want(c.group, v))));
    file.boards.forEach((b) => [...b.slots, ...b.spare].forEach((pad) => pad?.sound.tag && want(pad.sound.tag.group, pad.sound.tag.value)));
    const ids = new Map<string, string>();
    for (const [group, values] of wanted) {
      const mineIn = listTags(store, { groupId: groupOf.get(group) });
      for (const value of values) {
        const yours = mineIn.find((t) => same(t.name, value));
        ids.set(`${group}\u0000${value.toLowerCase()}`, yours ? yours.id : createTag(store, { groupId: groupOf.get(group) as string, name: value.trim() }).id);
      }
    }
    tagIdOf = (group, value) => ids.get(`${group}\u0000${value.toLowerCase()}`);
    return groupOf;
  };
  let groupOf = new Map<string, string>();

  const trackInput = (t: FileTrack, title: string): TrackInput => ({
    kind: t.kind,
    title,
    metaTitle: t.metaTitle,
    file: { path: placeFor(t), size: t.sizeBytes },
    durationMs: t.durationMs,
    role: t.role,
    loopable: t.loop,
    energy: t.energy,
    profile: t.profile ?? null,
    shape: t.shape ?? null,
    notes: t.notes,
    sourceComposer: t.artist || null,
    sourceAlbum: t.album || null,
    isNew: false,
  });
  const tagIdsOf = (t: FileTrack) => Object.entries(t.tags).flatMap(([g, vs]) => vs.map((v) => tagIdOf(g, v))).filter((x): x is string => !!x);

  const bringTracks = (batch: FileTrack[]) => {
    const making: { t: FileTrack; input: TrackInput }[] = [];
    for (const t of batch) {
      const yours = yoursFor(mine, t);
      if (yours && trackChoice !== "keepBoth") {
        trackMap.set(t.id, yours.id);
        if (trackChoice === "merge") {
          mergedTracks++;
          const changes: Record<string, unknown> = {};
          if (!yours.title && t.title) changes.title = t.title;
          if (!yours.notes && t.notes) changes.notes = t.notes;
          if (yours.energy === null && t.energy !== null) changes.energy = t.energy;
          if (yours.role === null && t.role !== null) changes.role = t.role;
          if (!yours.shape && t.shape) changes.shape = t.shape;
          if (Object.keys(changes).length) updateTrack(store, yours.id, changes);
          const tags = tagIdsOf(t);
          if (tags.length) void tagTracks(store, [yours.id], tags);
        } else skippedTracks++;
        continue;
      }
      if (yours) copiedTracks++;
      making.push({ t, input: trackInput(t, yours ? `${shownTitle(t)}${from}` : t.title) });
    }
    if (!making.length) return;
    const made = createTracks(store, making.map((m) => m.input));
    made.forEach((track, i) => {
      const t = making[i].t;
      trackMap.set(t.id, track.id);
      newTracks.add(track.id);
      if (!options.unpacked.has(t.id)) report.missingFiles++;
      const tags = tagIdsOf(t);
      if (tags.length) void tagTracks(store, [track.id], tags);
      if (t.normalise) setTrackNormalise(store, track.id, t.normalise);
    });
  };

  const tracksOf = (ids: readonly string[]) => [...new Set(ids.map((x) => trackMap.get(x)).filter((x): x is string => !!x))];
  const refOf = (r: SoundRef): SoundRef | null => {
    const mapped = r.kind === "track" ? trackMap.get(r.id) : playlistMap.get(r.id);
    return mapped ? { kind: r.kind, id: mapped } : null;
  };

  const bringPlaylists = () => {
    for (const p of file.playlists) {
      const item = items.find((i) => i.key === `playlist:${p.id}`) as FileItem;
      const choice = choiceOf(item);
      const yours = item.yours ? mine.playlists.find((x) => x.id === item.yours?.id) : undefined;
      if (yours && (choice === "skip" || choice === "merge")) {
        playlistMap.set(p.id, yours.id);
        if (choice === "merge" && yours.kind === "manual" && p.kind === "manual") {
          const adding = tracksOf(p.trackIds).filter((x) => !yours.trackIds.includes(x));
          if (adding.length) addTracksToPlaylist(store, yours.id, adding);
        }
        if (choice === "merge") report.merged.push({ kind: "playlist", id: yours.id, name: yours.name });
        else report.skipped.push({ kind: "playlist", name: p.name });
        continue;
      }
      const name = choice === "keepBoth" ? `${p.name}${from}` : p.name;
      const made =
        p.kind === "manual"
          ? createPlaylist(store, { title: name, kind: "manual", lane: p.lane, notes: p.notes })
          : createPlaylist(store, {
              title: name,
              kind: "dynamic",
              lane: p.lane,
              notes: p.notes,
              rule: { ...p.rule, conds: p.rule.conds.filter((c) => groupOf.has(c.group)).map((c) => ({ ...c, group: groupOf.get(c.group) as string })) },
            });
      if (p.kind === "manual") {
        const ids = tracksOf(p.trackIds);
        if (ids.length) addTracksToPlaylist(store, made.id, ids);
      }
      if (p.order) setPlayOrder(store, made.id, null, p.order);
      if (p.normalise) setPlaylistNormalise(store, made.id, p.normalise);
      playlistMap.set(p.id, made.id);
      newPlaylists.add(made.id);
      (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "playlist", id: made.id, name });
    }
  };

  const bringBoards = () => {
    for (const b of file.boards) {
      const item = items.find((i) => i.key === `board:${b.id}`) as FileItem;
      const choice = choiceOf(item);
      const padInput = (pad: NonNullable<(typeof b.slots)[number]>) => ({
        label: pad.label,
        icon: pad.icon,
        color: pad.color,
        hotkey: pad.key ? pad.key.toLowerCase() : null,
        mode: pad.mode,
        volume: pad.volume,
        fadeMs: pad.fadeOutMs,
        sound: { kind: pad.sound.kind, trackIds: tracksOf(pad.sound.trackIds), order: pad.sound.order, tagId: pad.sound.tag ? (tagIdOf(pad.sound.tag.group, pad.sound.tag.value) ?? null) : null },
      });
      const yours = item.yours ? mine.boards.find((x) => x.id === item.yours?.id) : undefined;
      if (yours && (choice === "skip" || choice === "merge")) {
        boardMap.set(b.id, yours.id);
        if (choice === "merge") {
          const labels = [...yours.slots, ...yours.spare].filter(Boolean).map((p) => (p as { label: string }).label);
          // New pads go among the spare pads, without a key: yours keep their places and keys.
          for (const pad of [...b.slots, ...b.spare]) if (pad && !labels.some((l) => same(l, pad.label))) addPad(store, yours.id, { ...padInput(pad), hotkey: null, at: "spare" });
          report.merged.push({ kind: "board", id: yours.id, name: yours.name });
        } else report.skipped.push({ kind: "board", name: b.name });
        continue;
      }
      const name = choice === "keepBoth" ? `${b.name}${from}` : b.name;
      const made = createBoard(store, { title: name, cols: b.cols, rows: b.rows });
      b.slots.forEach((pad, i) => pad && addPad(store, made.id, { ...padInput(pad), at: { row: Math.floor(i / b.cols), col: i % b.cols } }));
      for (const pad of b.spare) {
        const added = addPad(store, made.id, { ...padInput(pad), at: "spare" });
        if (!pad.aside) store.run("UPDATE pads SET put_aside = 0 WHERE id = ?", added.id);
      }
      boardMap.set(b.id, made.id);
      (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "board", id: made.id, name });
    }
  };

  const playlistsOf = (ids: readonly string[]) => [...new Set(ids.map((x) => playlistMap.get(x)).filter((x): x is string => !!x))];
  const boardsOf = (ids: readonly string[]) => [...new Set(ids.map((x) => boardMap.get(x)).filter((x): x is string => !!x))];

  const bringSessions = (c: LyreFileLibrary["campaigns"][number], campaignId: string, asDrafts: boolean) => {
    for (const s of c.sessions) {
      const session = createSession(store, { campaignId, name: s.name, date: s.date, status: asDrafts ? "draft" : s.status, noteLink: s.noteLink });
      sessionMap.set(`${c.id}:${s.id}`, { campaignId, sessionId: session.id });
      addToSession(store, session.id, { playlistIds: playlistsOf(s.playlistIds), boardIds: boardsOf(s.boardIds), trackIds: tracksOf(s.trackIds) });
      for (const sc of s.scenes) {
        const scene = createScene(store, { sessionId: session.id, name: sc.name, startsWhen: sc.startsWhen, notes: sc.notes, noteLink: sc.noteLink });
        sceneMap.set(`${c.id}:${s.id}:${sc.id}`, { campaignId, sessionId: session.id, sceneId: scene.id });
        const music = sc.music.map(refOf).filter((r): r is SoundRef => !!r);
        if (music.length) addSceneMusic(store, scene.id, music);
        const ambience = sc.ambience ? refOf(sc.ambience) : null;
        if (ambience) setSceneAmbience(store, scene.id, ambience);
        const boards = boardsOf(sc.boardIds);
        if (boards.length) addSceneBoards(store, scene.id, boards);
        for (const [trackId, name] of Object.entries(sc.trackNames)) {
          const mapped = trackMap.get(trackId);
          if (mapped && name.trim()) setSceneTrackName(store, scene.id, mapped, name);
        }
      }
    }
  };

  const bringCampaigns = () => {
    for (const c of file.campaigns) {
      const item = items.find((i) => i.key === `campaign:${c.id}`) as FileItem;
      const choice = choiceOf(item);
      if (item.yours && choice === "skip") {
        report.skipped.push({ kind: "campaign", name: c.name });
        continue;
      }
      if (item.yours && choice === "merge") {
        // Their sessions join yours, as drafts after yours: yours keep their order and which one is next.
        bringSessions(c, item.yours.id, true);
        report.merged.push({ kind: "campaign", id: item.yours.id, name: mine.campaigns.find((x) => x.id === item.yours?.id)?.name ?? c.name });
        continue;
      }
      const name = choice === "keepBoth" ? `${c.name}${from}` : c.name;
      const made = createCampaign(store, { name, system: c.system, theme: c.theme, description: c.description, notes: c.notes, obsidian: c.obsidian, firstSessionNumber: c.sessions[0]?.number ?? 1 });
      campaignMap.set(c.id, made.id);
      addToCampaign(store, made.id, { playlistIds: playlistsOf(c.playlistIds), boardIds: boardsOf(c.boardIds), trackIds: tracksOf(c.trackIds) });
      bringSessions(c, made.id, false);
      (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "campaign", id: made.id, name });
    }
  };

  /** Audio settings and play orders of the places this bring-in made (yours are never changed by a file). */
  const bringSettings = () => {
    for (const [key, byTrack] of Object.entries(file.overrides)) {
      const place = parsePlaceKey(key);
      const mapped = place && mapProfilePlace(place);
      if (!mapped) continue;
      for (const [trackId, profile] of Object.entries(byTrack)) {
        const t = trackMap.get(trackId);
        if (t) setProfileOverride(store, mapped, t, profile);
      }
    }
    for (const [key, byPlaylist] of Object.entries(file.playOrders)) {
      const place = parseKeyOfPlace(key);
      const mapped = place && mapUsePlace(place);
      if (!mapped) continue;
      for (const [playlistId, order] of Object.entries(byPlaylist)) {
        const p = playlistMap.get(playlistId);
        if (p) setPlayOrder(store, p, mapped, order);
      }
    }
  };
  const mapProfilePlace = (p: ProfilePlace): ProfilePlace | null => {
    if (p.kind === "playlist") {
      const id = playlistMap.get(p.playlistId);
      return id && newPlaylists.has(id) ? { kind: "playlist", playlistId: id } : null;
    }
    if (p.kind === "session") {
      const s = sessionMap.get(`${p.campaignId}:${p.sessionId}`);
      return s ? { kind: "session", ...s } : null;
    }
    const sc = sceneMap.get(`${p.campaignId}:${p.sessionId}:${p.sceneId}`);
    return sc ? { kind: "scene", ...sc } : null;
  };
  const mapUsePlace = (p: UsePlace): UsePlace | null => {
    if (p.kind === "campaign") {
      const id = campaignMap.get(p.campaignId);
      return id ? { kind: "campaign", campaignId: id } : null;
    }
    if (p.kind === "session") {
      const s = sessionMap.get(`${p.campaignId}:${p.sessionId}`);
      return s ? { kind: "session", ...s } : null;
    }
    const sc = sceneMap.get(`${p.campaignId}:${p.sessionId}:${p.sceneId}`);
    return sc ? { kind: "scene", ...sc } : null;
  };

  let tagsDone = false;
  await store.changeInBatches(`Bring in ${options.fileName}`, file.tracks, (batch, last) => {
    if (!tagsDone) {
      groupOf = bringTags();
      tagsDone = true;
    }
    bringTracks(batch);
    if (!last) return;
    bringPlaylists();
    bringBoards();
    bringCampaigns();
    bringSettings();
  });

  if (trackItem) {
    const entry = { kind: "tracks" as const, id: "", name: plural(newTracks.size + mergedTracks, "track") };
    if (trackChoice === "keepBoth") report.keptBoth.push(entry);
    else if (trackChoice === "merge") report.merged.push(entry);
    else if (newTracks.size) report.added.push(entry);
    if (trackChoice === "skip" && skippedTracks) report.skipped.push({ kind: "tracks", name: plural(skippedTracks, "track") });
  }
  const tagItem = items.find((i) => i.kind === "tags");
  if (tagItem) report.added.push({ kind: "tags", id: "", name: tagItem.name });
  report.summary = summaryOf(report, { file, tracksAdded: newTracks.size, copies: copiedTracks, merged: mergedTracks, skipped: skippedTracks, from, includesAudio: options.includesAudio, unpacked: options.unpacked.size, newTagValues: newTagValues(file, mine).length });
  return report;
}

/** "Brought in Curse of Strahd, 3 playlists, a pad board, 3 tag values and 38 tracks (8 as copies). …" */
function summaryOf(
  report: BringInReport,
  facts: { file: LyreFileLibrary; tracksAdded: number; copies: number; merged: number; skipped: number; from: string; includesAudio: boolean; unpacked: number; newTagValues: number },
): string {
  const done = [...report.added, ...report.keptBoth, ...report.merged];
  const count = (kind: string, one: string, many: string) => {
    const n = done.filter((x) => x.kind === kind).length;
    return n === 0 ? [] : [n === 1 ? one : `${n} ${many}`];
  };
  const parts = [...done.filter((x) => x.kind === "campaign").map((x) => x.name), ...count("playlist", "a playlist", "playlists"), ...count("board", "a pad board", "pad boards")];
  if (facts.newTagValues) parts.push(plural(facts.newTagValues, "tag value"));
  if (facts.tracksAdded || facts.merged) {
    const notes = [facts.copies ? `${facts.copies} as copies` : "", facts.merged ? `${facts.merged} merged with yours` : "", facts.skipped ? `${facts.skipped} you had already were kept as they are` : ""].filter(Boolean);
    parts.push(`${plural(facts.tracksAdded + facts.merged, "track")}${notes.length ? ` (${notes.join(", ")})` : ""}`);
  }
  const all = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const sentences = [all ? `Brought in ${all}.` : "Nothing new was brought in: you have everything in it already."];
  if (report.skipped.length) sentences.push(`${plural(report.skipped.length, "duplicate")} skipped.`);
  if (report.keptBoth.length) sentences.push(`${plural(report.keptBoth.length, "copy", "copies")} named "${facts.from.trim()}".`);
  if (facts.tracksAdded) {
    sentences.push(
      facts.includesAudio
        ? `${plural(facts.unpacked, "audio file")} ${facts.unpacked === 1 ? "was" : "were"} unpacked next to your library.`
        : "The audio files were not in the file: Find missing files finds them on this computer.",
    );
  }
  return sentences.join(" ");
}
