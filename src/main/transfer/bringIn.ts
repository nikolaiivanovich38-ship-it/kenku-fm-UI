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

import { parseKeyOfPlace, parsePlaceKey, type CueStep, type ProfilePlace, type SoundRef, type UsePlace } from "../../common/domain";
import type { BringInChoices, BringInReport, DuplicateChoice, IncomingItem, LibraryTrack, PadBoard, PlaylistInfo, TagGroup } from "../../common/lyre/api";
import { plural, shownTitle } from "../../common/lyre/text";
import {
  addPad,
  addPlaylistDivider,
  listPlaylistItems,
  setBoardDivider,
  setMovesOn,
  setSteps,
  setTagSynonyms,
  setTrackPlay,
  updateTag,
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
  setRepeatOne,
  setTrackOrder,
  setProfileOverride,
  setSceneAmbience,
  setSceneTrackName,
  tagTracks,
  updateTrack,
  type Store,
  type TrackInput,
} from "../data";
import { setPlaylistNormalise, setTrackNormalise } from "../data/repo/normalise";
import { nextTurn } from "../data/store";
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

/** How names are compared (any letter case, spaces at the ends ignored), and the key of an index by name. */
const nameKey = (name: string) => name.trim().toLowerCase();
const same = (a: string, b: string) => nameKey(a) === nameKey(b);

/**
 * The first of `items` for each name, so each lookup is one step (security review w4, Should 3: a file with
 * thousands of playlists, boards or campaigns took minutes when each was compared with every one of yours).
 */
function byName<T>(items: readonly T[], nameOf: (item: T) => string): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of items) if (!index.has(nameKey(nameOf(item)))) index.set(nameKey(nameOf(item)), item);
  return index;
}
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
  const campaigns = byName(mine.campaigns, (x) => x.name);
  const playlists = byName(mine.playlists, (x) => x.name);
  const boards = byName(mine.boards, (x) => x.name);
  for (const c of file.campaigns) {
    const yours = campaigns.get(nameKey(c.name));
    const scenes = c.sessions.reduce((n, s) => n + s.scenes.length, 0);
    items.push({
      key: `campaign:${c.id}`, kind: "campaign", name: c.name, fileIds: [c.id],
      detail: `${plural(c.sessions.length, "session")}, ${plural(scenes, "scene")}${yours ? " · yours has the same name" : ""}`,
      status: yours ? "duplicate" : "new", yours: yours ? { kind: "campaign", id: yours.id } : null,
    });
  }
  for (const p of file.playlists) {
    const yours = playlists.get(nameKey(p.name));
    const what = p.kind === "dynamic" ? "Dynamic" : plural(p.trackIds.length, "track");
    const theirs = yours && yours.kind === "manual" && p.kind === "manual" && yours.trackIds.length === p.trackIds.length ? ` and ${plural(p.trackIds.length, "track")}` : "";
    items.push({
      key: `playlist:${p.id}`, kind: "playlist", name: p.name, fileIds: [p.id],
      detail: `${what}${yours ? ` · yours has the same name${theirs}` : ""}`,
      status: yours ? "duplicate" : "new", yours: yours ? { kind: "playlist", id: yours.id } : null,
    });
  }
  for (const b of file.boards) {
    const yours = boards.get(nameKey(b.name));
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
    const have = new Set(yours?.values.map(nameKey));
    for (const value of g.values) if (!have.has(nameKey(value))) out.push({ group: g.name, value });
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
  /**
   * Tracks that name an audio part another track was unpacked from (security review w4, Should 2): file track id →
   * the file track that has it. The library keeps one track per file, so each becomes that track.
   */
  sameAudioAs?: Map<string, string>;
  /** Audio parts left out because they were not audio Lyre plays (security review w4, Must 1). */
  notAudio?: number;
  includesAudio: boolean;
}

/**
 * Brings the file in as one undo step ("Bring in <file>"), in batches of tracks with the event loop free between
 * them (one undo step still). Throws the library's own errors (ValidationError) for something it cannot take;
 * the change is then undone as a whole.
 */
export async function bringIn(store: Store, file: LyreFileLibrary, mine: CurrentLibrary, choices: BringInChoices, options: BringInOptions): Promise<BringInReport> {
  const items = describeFile(file, mine);
  const itemOf = new Map(items.map((i) => [i.key, i]));
  const yourPlaylist = new Map(mine.playlists.map((x) => [x.id, x]));
  const yourBoard = new Map(mine.boards.map((x) => [x.id, x]));
  const yourCampaign = new Map(mine.campaigns.map((x) => [x.id, x]));
  const choiceOf = (item: FileItem): DuplicateChoice | "new" => (item.status === "new" ? "new" : (choices.each?.[item.key] ?? choices.all ?? "skip"));
  const from = ` (from ${fromWhom(options.fileName)})`;
  const report: BringInReport = { added: [], merged: [], keptBoth: [], skipped: [], missingFiles: 0, summary: "" };
  const trackItem = items.find((i) => i.kind === "tracks");
  const trackChoice = trackItem ? choiceOf(trackItem) : "new";

  const trackMap = new Map<string, string>();
  const playlistMap = new Map<string, string>();
  const boardMap = new Map<string, string>();
  /** Round 7: the file's pads, by id, to the pads they became; the steps to bring once every place is in. */
  const padMap = new Map<string, { boardId: string; padId: string }>();
  const stepsToBring: { owner: { sceneId: string } | { padId: string }; steps: CueStep[] }[] = [];
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
  let sharedTracks = 0;

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
      // DAT-10: a group made here takes the file's colour; yours keep theirs.
      groupOf.set(g.id, yours ? yours.id : createTagGroup(store, { name: g.name, color: g.color ?? null }).id);
    }
    const madeTags = new Set<string>();
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
      const mineIn = new Map(listTags(store, { groupId: groupOf.get(group) }).map((t) => [nameKey(t.name), t.id]));
      for (const value of values) {
        // A value made here is reused for the same value in another letter case.
        const known = mineIn.get(nameKey(value));
        const id = known ?? createTag(store, { groupId: groupOf.get(group) as string, name: value.trim() }).id;
        if (!known) madeTags.add(id);
        mineIn.set(nameKey(value), id);
        ids.set(`${group}\u0000${value.toLowerCase()}`, id);
      }
    }
    tagIdOf = (group, value) => ids.get(`${group}\u0000${value.toLowerCase()}`);
    // DAT-10: a tag made here sits where it sat in the file, with its other words and colour (yours are not changed).
    for (const g of file.tagGroups)
      for (const t of g.tags ?? []) {
        const tagId = tagIdOf(g.id, t.name);
        if (!tagId || !madeTags.has(tagId)) continue;
        const parentId = t.parent ? tagIdOf(g.id, t.parent) : undefined;
        if (parentId || t.color) updateTag(store, tagId, { ...(parentId ? { parentId } : {}), ...(t.color ? { color: t.color } : {}) });
        if (t.also.length) setTagSynonyms(store, tagId, t.also);
      }
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
    const sharing: FileTrack[] = [];
    for (const t of batch) {
      if (options.sameAudioAs?.has(t.id)) {
        sharing.push(t);
        continue;
      }
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
    const made = making.length ? createTracks(store, making.map((m) => m.input)) : [];
    made.forEach((track, i) => {
      const t = making[i].t;
      trackMap.set(t.id, track.id);
      newTracks.add(track.id);
      if (!options.unpacked.has(t.id)) report.missingFiles++;
      const tags = tagIdsOf(t);
      if (tags.length) void tagTracks(store, [track.id], tags);
      if (t.normalise) setTrackNormalise(store, track.id, t.normalise);
      // PLY-4: how it plays (its Follow with comes with the settings, once playlists are in).
      if (t.fadesOut || t.resume) setTrackPlay(store, track.id, { fadesOut: !!t.fadesOut, resume: !!t.resume });
    });
    // The track that has their audio comes earlier in the file, so it is made by now.
    for (const t of sharing) {
      const theirs = trackMap.get(options.sameAudioAs?.get(t.id) ?? "");
      if (!theirs) continue;
      trackMap.set(t.id, theirs);
      sharedTracks++;
    }
  };

  const tracksOf = (ids: readonly string[]) => [...new Set(ids.map((x) => trackMap.get(x)).filter((x): x is string => !!x))];
  const refOf = (r: SoundRef): SoundRef | null => {
    const mapped = r.kind === "track" ? trackMap.get(r.id) : playlistMap.get(r.id);
    return mapped ? { kind: r.kind, id: mapped } : null;
  };

  const bringPlaylist = (p: PlaylistInfo) => {
    const item = itemOf.get(`playlist:${p.id}`) as FileItem;
    const choice = choiceOf(item);
    const yours = item.yours ? yourPlaylist.get(item.yours.id) : undefined;
    if (yours && (choice === "skip" || choice === "merge")) {
      playlistMap.set(p.id, yours.id);
      if (choice === "merge" && yours.kind === "manual" && p.kind === "manual") {
        const theirs = new Set(yours.trackIds);
        const adding = tracksOf(p.trackIds).filter((x) => !theirs.has(x));
        if (adding.length) addTracksToPlaylist(store, yours.id, adding);
      }
      if (choice === "merge") report.merged.push({ kind: "playlist", id: yours.id, name: yours.name });
      else report.skipped.push({ kind: "playlist", name: p.name });
      return;
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
      // ORG-4: its dividers, above the same tracks (counted among the tracks that came in).
      const kept = p.trackIds.map((id, i) => ({ i, id: trackMap.get(id) })).filter((x) => !!x.id);
      for (const d of p.dividers ?? []) {
        const at = kept.filter((x) => x.i < d.at).length;
        const items = listPlaylistItems(store, made.id).filter((i) => i.kind === "track");
        addPlaylistDivider(store, made.id, d.name, at < items.length ? { before: items[at].id } : "end");
      }
    }
    if (p.order) setPlayOrder(store, made.id, null, p.order);
    if (p.normalise) setPlaylistNormalise(store, made.id, p.normalise);
    playlistMap.set(p.id, made.id);
    newPlaylists.add(made.id);
    (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "playlist", id: made.id, name });
  };

  const bringBoard = (b: PadBoard) => {
    const item = itemOf.get(`board:${b.id}`) as FileItem;
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
    const yours = item.yours ? yourBoard.get(item.yours.id) : undefined;
    if (yours && (choice === "skip" || choice === "merge")) {
      boardMap.set(b.id, yours.id);
      if (choice === "merge") {
        const labels = new Set([...yours.slots, ...yours.spare].filter(Boolean).map((p) => nameKey((p as { label: string }).label)));
        // New pads go among the spare pads, without a key: yours keep their places and keys.
        for (const pad of [...b.slots, ...b.spare]) if (pad && !labels.has(nameKey(pad.label))) addPad(store, yours.id, { ...padInput(pad), hotkey: null, at: "spare" });
        report.merged.push({ kind: "board", id: yours.id, name: yours.name });
      } else report.skipped.push({ kind: "board", name: b.name });
      return;
    }
    const name = choice === "keepBoth" ? `${b.name}${from}` : b.name;
    const made = createBoard(store, { title: name, cols: b.cols, rows: b.rows });
    b.slots.forEach((pad, i) => pad && padMap.set(pad.id, { boardId: made.id, padId: addPad(store, made.id, { ...padInput(pad), at: { row: Math.floor(i / b.cols), col: i % b.cols } }).id }));
    for (const pad of b.spare) {
      const added = addPad(store, made.id, { ...padInput(pad), at: "spare" });
      padMap.set(pad.id, { boardId: made.id, padId: added.id });
      if (!pad.aside) store.run("UPDATE pads SET put_aside = 0 WHERE id = ?", added.id);
    }
    // ORG-4: its dividers; PLY-8: its pads' own steps come with the settings, once every place is in.
    for (const d of b.dividers ?? []) setBoardDivider(store, made.id, d.row, d.name);
    for (const pad of [...b.slots, ...b.spare]) if (pad?.steps) stepsToBring.push({ owner: { padId: padMap.get(pad.id)?.padId as string }, steps: pad.steps });
    boardMap.set(b.id, made.id);
    (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "board", id: made.id, name });
  };

  const playlistsOf = (ids: readonly string[]) => [...new Set(ids.map((x) => playlistMap.get(x)).filter((x): x is string => !!x))];
  const boardsOf = (ids: readonly string[]) => [...new Set(ids.map((x) => boardMap.get(x)).filter((x): x is string => !!x))];

  type FileCampaign = LyreFileLibrary["campaigns"][number];
  /** Where each campaign's sessions go (yours, when merging, as drafts), or nowhere when it is skipped. */
  const sessionsGoTo = new Map<string, { campaignId: string; asDrafts: boolean }>();
  const bringSession = (c: FileCampaign, s: FileCampaign["sessions"][number]) => {
    const to = sessionsGoTo.get(c.id);
    if (!to) return;
    const { campaignId, asDrafts } = to;
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
      // PLY-8: what it does when it starts (its steps once every place is in), and whether it moves on by itself.
      if (sc.steps) stepsToBring.push({ owner: { sceneId: scene.id }, steps: sc.steps });
      if (sc.movesOn && sc.movesOn.when !== "stay") setMovesOn(store, scene.id, sc.movesOn);
      // PLY-17: the scene's Repeat ones come with it.
      for (const trackId of sc.repeatOnes) {
        const mapped = trackMap.get(trackId);
        if (mapped) setRepeatOne(store, scene.id, mapped, true);
      }
    }
  };

  /** A campaign itself; its sessions follow as work of their own (`bringSession`). */
  const bringCampaign = (c: FileCampaign) => {
    const item = itemOf.get(`campaign:${c.id}`) as FileItem;
    const choice = choiceOf(item);
    if (item.yours && choice === "skip") {
      report.skipped.push({ kind: "campaign", name: c.name });
      return;
    }
    if (item.yours && choice === "merge") {
      // Their sessions join yours, as drafts after yours: yours keep their order and which one is next.
      sessionsGoTo.set(c.id, { campaignId: item.yours.id, asDrafts: true });
      report.merged.push({ kind: "campaign", id: item.yours.id, name: yourCampaign.get(item.yours.id)?.name ?? c.name });
      return;
    }
    const name = choice === "keepBoth" ? `${c.name}${from}` : c.name;
    const made = createCampaign(store, { name, system: c.system, theme: c.theme, description: c.description, notes: c.notes, obsidian: c.obsidian, firstSessionNumber: c.sessions[0]?.number ?? 1 });
    campaignMap.set(c.id, made.id);
    addToCampaign(store, made.id, { playlistIds: playlistsOf(c.playlistIds), boardIds: boardsOf(c.boardIds), trackIds: tracksOf(c.trackIds) });
    sessionsGoTo.set(c.id, { campaignId: made.id, asDrafts: false });
    (choice === "keepBoth" ? report.keptBoth : report.added).push({ kind: "campaign", id: made.id, name });
  };

  /** PLY-8: a step of the file with what it names mapped to what came in; null when that did not come. */
  const stepIn = (st: CueStep): CueStep | null => {
    if (st.do === "music" || st.do === "ambience" || st.do === "play") {
      const what = refOf(st.what);
      return what ? { ...st, what } : null;
    }
    if (st.do === "board") {
      const boardId = boardMap.get(st.boardId);
      return boardId ? { ...st, boardId } : null;
    }
    if (st.do === "pad") {
      const pad = padMap.get(st.padId);
      return pad ? { do: "pad", ...pad } : null;
    }
    if (st.do === "scene") {
      const scene = sceneMap.get(`${st.scene.campaignId}:${st.scene.sessionId}:${st.scene.sceneId}`);
      return scene ? { do: "scene", scene } : null;
    }
    return { ...st };
  };

  /** Audio settings and play orders of the places this bring-in made (yours are never changed by a file). */
  const bringSettings = () => {
    // SHW-3: Follow with of the tracks this bring-in made; PLY-8: the own steps of its scenes and pads.
    for (const t of file.tracks) {
      const mine = trackMap.get(t.id);
      const follow = t.follow ? refOf(t.follow) : null;
      if (mine && newTracks.has(mine) && follow && !(follow.kind === "track" && follow.id === mine)) setTrackPlay(store, mine, { follow });
    }
    for (const { owner, steps } of stepsToBring) {
      if ("padId" in owner && !owner.padId) continue;
      setSteps(store, owner, steps.map(stepIn).filter((x): x is CueStep => x !== null));
    }
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
    // ORG-13: a playlist's track order in a place the bring-in made (yours are never changed by a file).
    for (const [key, byPlaylist] of Object.entries(file.trackOrders)) {
      const place = parseKeyOfPlace(key);
      const mapped = place && mapUsePlace(place);
      if (!mapped) continue;
      for (const [playlistId, ids] of Object.entries(byPlaylist)) {
        const p = playlistMap.get(playlistId);
        const tracks = ids.map((id) => trackMap.get(id)).filter((id): id is string => !!id);
        if (p && tracks.length) setTrackOrder(store, p, mapped, tracks);
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

  // Security review w4, Should 3: everything is work in one list, in the order things name each other (tracks, then
  // playlists, boards, campaigns and their sessions, then settings), so batches of about 500 each keep the library's
  // process free between them, however many playlists, boards or campaigns a file holds.
  type Work = { kind: "track"; t: FileTrack } | { kind: "playlist"; p: PlaylistInfo } | { kind: "board"; b: PadBoard } | { kind: "campaign"; c: FileCampaign } | { kind: "session"; c: FileCampaign; s: FileCampaign["sessions"][number] } | { kind: "settings" };
  const work: Work[] = [
    ...file.tracks.map((t): Work => ({ kind: "track", t })),
    ...file.playlists.map((p): Work => ({ kind: "playlist", p })),
    ...file.boards.map((b): Work => ({ kind: "board", b })),
    ...file.campaigns.flatMap((c): Work[] => [{ kind: "campaign", c }, ...c.sessions.map((s): Work => ({ kind: "session", c, s }))]),
    { kind: "settings" },
  ];
  let tagsDone = false;
  // Comparing the file with the library above takes a turn of its own; the first batch runs in the next.
  await nextTurn();
  await store.changeInBatches(`Bring in ${options.fileName}`, work, (batch) => {
    if (!tagsDone) {
      groupOf = bringTags();
      tagsDone = true;
    }
    bringTracks(batch.flatMap((w) => (w.kind === "track" ? [w.t] : [])));
    for (const w of batch) {
      if (w.kind === "playlist") bringPlaylist(w.p);
      else if (w.kind === "board") bringBoard(w.b);
      else if (w.kind === "campaign") bringCampaign(w.c);
      else if (w.kind === "session") bringSession(w.c, w.s);
      else if (w.kind === "settings") bringSettings();
    }
    // A playlist, board or campaign is several writes: half the usual batch keeps each turn well under 200 ms.
  }, { batchSize: 250 });

  if (trackItem) {
    const entry = { kind: "tracks" as const, id: "", name: plural(newTracks.size + mergedTracks, "track") };
    if (trackChoice === "keepBoth") report.keptBoth.push(entry);
    else if (trackChoice === "merge") report.merged.push(entry);
    else if (newTracks.size) report.added.push(entry);
    if (trackChoice === "skip" && skippedTracks) report.skipped.push({ kind: "tracks", name: plural(skippedTracks, "track") });
  }
  const tagItem = items.find((i) => i.kind === "tags");
  if (tagItem) report.added.push({ kind: "tags", id: "", name: tagItem.name });
  report.summary = summaryOf(report, { file, tracksAdded: newTracks.size, copies: copiedTracks, merged: mergedTracks, skipped: skippedTracks, from, includesAudio: options.includesAudio, unpacked: options.unpacked.size, notAudio: options.notAudio ?? 0, shared: sharedTracks, newTagValues: newTagValues(file, mine).length });
  return report;
}

/** "Brought in Curse of Strahd, 3 playlists, a pad board, 3 tag values and 38 tracks (8 as copies). …" */
function summaryOf(
  report: BringInReport,
  facts: { file: LyreFileLibrary; tracksAdded: number; copies: number; merged: number; skipped: number; from: string; includesAudio: boolean; unpacked: number; notAudio: number; shared: number; newTagValues: number },
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
    if (!facts.includesAudio) sentences.push("The audio files were not in the file: Find missing files finds them on this computer.");
    else if (facts.unpacked) sentences.push(`${plural(facts.unpacked, "audio file")} ${facts.unpacked === 1 ? "was" : "were"} unpacked next to your library.`);
  }
  if (facts.shared) {
    sentences.push(`${plural(facts.shared, "track")} in it used the same audio file as another track, so Lyre brought ${facts.shared === 1 ? "it" : "them"} in as that track.`);
  }
  if (facts.notAudio) {
    sentences.push(`${plural(facts.notAudio, "audio file")} in it ${facts.notAudio === 1 ? "was" : "were"} not audio Lyre can play, so Lyre left ${facts.notAudio === 1 ? "it" : "them"} out.`);
  }
  return sentences.join(" ");
}
