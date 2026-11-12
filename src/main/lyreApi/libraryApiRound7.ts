/**
 * Design round 7's LyreApi methods over the real library (libraryApi.ts hands them its helpers through `Round7Context`):
 * tag groups and tags (DAT-10), folders and dividers (ORG-4), put (ORG-5), steps (PLY-8), the round 7 settings
 * (UX-12, PLY-8, UX-11, PRV-2) and Find and play's pads and scenes (UX-12). The same contract tests pass here as on the
 * fake (fakeRound7.ts). Each write is one undo step in plain words, made by the repository functions (repo/round7.ts and
 * the older modules) inside one `store.change` or their own batches.
 */
import fs from "fs";
import path from "path";

import {
  checkDevices,
  checkDisplay,
  checkStreamingMode,
  isFx,
  stepsToKeep,
  usualPadSteps,
  usualSceneSteps,
  type SoundRef,
} from "../../common/domain";
import { DEVICE_KEYS, DISPLAY_KEYS, readComputerSettings } from "./computerSettings";
import type {
  CampaignInfo,
  FindRequest,
  FindResult,
  FolderInfo,
  FolderKind,
  FoundPad,
  FoundScene,
  LibraryTrack,
  LyreApi,
  LyreArea,
  LyreSettings,
  PadBoard,
  PadColor,
  PlaylistDivider,
  PlaylistInfo,
  RefusalCode,
  SceneAddress,
  SceneInfo,
  SessionInfo,
  TagGroup,
  TagInfo,
  TagRef,
  WriteResult,
} from "../../common/lyre/api";
import { FOLDER_KINDS } from "../../common/lyre/api";
import { plural, quoted, shownTitle, trimmed } from "../../common/lyre/text";
import {
  addPad,
  addPlaylistDivider,
  addSceneBoards,
  addSceneMusic,
  addTracksToPlaylist,
  createFolder,
  createTag,
  createTagGroup,
  deleteFolder,
  deleteTag,
  deleteTagGroup,
  getFolder,
  getPlaySettings,
  getShortcuts,
  listFolders,
  listPlaylistItems,
  listTagGroups,
  listTags,
  mergeTags,
  moveBoard,
  movePlaylist,
  movePlaylistItems,
  moveTag,
  moveTagGroup,
  removePlaylistItems,
  renamePlaylistDivider,
  resetShortcuts,
  search,
  setBoardDivider,
  setCrossfade,
  setMovesOn,
  setNextSceneGuard,
  setShortcut,
  setSteps,
  setTagSynonyms,
  updateFolder,
  updateTag,
  updateTagGroup,
  type Store,
} from "../data";

/** What the round 7 methods need from libraryApi.ts. */
export interface Round7Context {
  store: Store;
  write<T>(areas: LyreArea[], body: () => T | Promise<T>): Promise<WriteResult<T>>;
  writeOutside<T>(areas: LyreArea[], body: () => T | Promise<T>): Promise<WriteResult<T>>;
  refuse(code: RefusalCode, message: string, field?: string): never;
  libraryTracks(): LibraryTrack[];
  requireTrack(id: string): LibraryTrack;
  playlistInfos(): PlaylistInfo[];
  requireManual(id: string): Extract<PlaylistInfo, { kind: "manual" }>;
  requireBoard(id: string): PadBoard;
  padBoard(id: string): PadBoard;
  requirePad(boardId: string, padId: string): { where: "slot" | "spare" };
  requireScene(address: SceneAddress): { session: SessionInfo; scene: SceneInfo; index: number };
  allCampaignInfos(): CampaignInfo[];
  tagGroups(): TagGroup[];
  checkMusic(ref: SoundRef): void;
  /** Round 6's find (tracks and playlists). */
  round6Find(request: FindRequest): Promise<Pick<FindResult, "tracks" | "playlists">>;
  /** Where this computer's settings are kept (beside the library, never in a backup); null keeps them in memory. */
  computerFile: string | null;
  log?: (message: string, error?: unknown) => void;
}

type Methods = {
  library: Pick<LyreApi["library"], "find" | "put">;
  tags: Omit<LyreApi["tags"], "listGroups" | "tagTracks">;
  folders: LyreApi["folders"];
  playlists: Pick<LyreApi["playlists"], "addDivider" | "renameDivider" | "removeDivider" | "moveItem">;
  boards: Pick<LyreApi["boards"], "setDivider" | "setPadSteps">;
  sessions: Pick<LyreApi["sessions"], "setSceneSteps">;
  settings: LyreApi["settings"];
};

/** Copy the listed keys that `from` has into `into`, and nothing else. */
function copyKnown<T extends object>(into: T, from: Partial<T> | undefined, keys: readonly (keyof T)[]): void {
  if (!from) return;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(from, key) && from[key] !== undefined) into[key] = from[key] as T[keyof T];
}

export { readComputerSettings };

export function libraryApiRound7(cx: Round7Context): Methods {
  const { store, write, refuse } = cx;
  const computer = readComputerSettings(cx.computerFile);

  /* ---------- tags ---------- */
  const groupOf = (id: string) => listTagGroups(store).find((g) => g.id === id) ?? refuse("not-found", "That tag group no longer exists.");
  function tagOf(ref: TagRef) {
    const g = groupOf(ref?.group);
    const name = String(ref?.value ?? "").toLowerCase();
    const tag = listTags(store, { groupId: g.id }).find((t) => t.name.toLowerCase() === name) ?? refuse("not-found", `There is no tag called ${quoted(String(ref?.value ?? ""))} in ${g.name}.`);
    return { group: g, tag };
  }
  const tracksWith = (tagId: string) => (store.get<{ n: number }>("SELECT count(*) AS n FROM track_tags WHERE tag_id = ?", tagId) as { n: number }).n;
  const apiGroup = (id: string) => cx.tagGroups().find((g) => g.id === id) as TagGroup;
  const apiTag = (ref: TagRef) => apiGroup(ref.group).tags.find((t) => t.name.toLowerCase() === ref.value.toLowerCase()) as TagInfo;
  /** The neighbour a Move up or Move down passes (null: it is first or last already). */
  function neighbour<T extends { id: string }>(list: T[], id: string, by: -1 | 1) {
    if (by !== -1 && by !== 1) refuse("invalid", "Move up or down one place.", "by");
    const i = list.findIndex((x) => x.id === id);
    const other = list[i + by];
    return other ? (by < 0 ? { before: other.id } : { after: other.id }) : null;
  }
  const changes = ["tags", "tracks", "playlists", "boards"] as LyreArea[];

  const tags: Methods["tags"] = {
    async createGroup(name, color) {
      return write(["tags", "tracks"], () => {
        const g = createTagGroup(store, { name, color: color ?? null });
        return apiGroup(g.id);
      });
    },
    async updateGroup(groupId, patch) {
      return write(["tags"], () => {
        const g = groupOf(groupId);
        const p = patch ?? {};
        updateTagGroup(store, g.id, { ...(p.name !== undefined ? { name: p.name } : {}), ...(p.color !== undefined ? { color: p.color } : {}) });
        return apiGroup(g.id);
      });
    },
    async moveGroup(groupId, by) {
      return write(["tags"], () => {
        const g = groupOf(groupId);
        const to = neighbour(listTagGroups(store), g.id, by);
        if (to) moveTagGroup(store, g.id, to);
      });
    },
    async deleteGroup(groupId) {
      return write(changes, async () => {
        const g = groupOf(groupId);
        const n = (store.get<{ n: number }>("SELECT count(DISTINCT tt.track_id) AS n FROM track_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.group_id = ?", g.id) as { n: number }).n;
        await deleteTagGroup(store, g.id);
        return { tracks: n };
      });
    },
    async createTag(groupId, name, parent = null) {
      return write(["tags"], () => {
        const g = groupOf(groupId);
        const parentId = parent === null || parent === undefined ? null : tagOf({ group: g.id, value: parent }).tag.id;
        const tag = createTag(store, { groupId: g.id, name, parentId });
        return { group: g.id, value: tag.name };
      });
    },
    async renameTag(ref, name) {
      return write(changes, () => {
        const { tag } = tagOf(ref);
        const n = trimmed(name);
        if (n === tag.name) return { tracks: 0 };
        const count = tracksWith(tag.id);
        store.change(`Rename ${quoted(tag.name)} to ${quoted(n)} on ${plural(count, "track")}`, () => updateTag(store, tag.id, { name }));
        return { tracks: count };
      });
    },
    async mergeTag(ref, into) {
      return write(changes, async () => {
        const { group, tag } = tagOf(ref);
        const target = tagOf({ group: group.id, value: into }).tag;
        const count = tracksWith(tag.id);
        await mergeTags(store, [tag.id], target.id);
        return { tracks: count };
      });
    },
    async deleteTag(ref) {
      return write(changes, async () => {
        const { tag } = tagOf(ref);
        const count = tracksWith(tag.id);
        await deleteTag(store, tag.id);
        return { tracks: count };
      });
    },
    async updateTag(ref, patch) {
      return write(["tags"], () => {
        const { group, tag } = tagOf(ref);
        const p = patch ?? {};
        const parentId = p.parent === undefined ? undefined : p.parent === null ? null : tagOf({ group: group.id, value: p.parent }).tag.id;
        store.change(`Change tag ${quoted(tag.name)}`, () => {
          if (parentId !== undefined || p.color !== undefined) updateTag(store, tag.id, { ...(parentId !== undefined ? { parentId } : {}), ...(p.color !== undefined ? { color: p.color } : {}) });
          // Other words are found in any letter case; they are kept as the prototype shows them, in lower case.
          if (p.also !== undefined) setTagSynonyms(store, tag.id, Array.isArray(p.also) ? [...new Set(p.also.map((w) => String(w).trim().toLowerCase()).filter(Boolean))] : (p.also as never));
        });
        return apiTag({ group: group.id, value: tag.name });
      });
    },
    async moveTag(ref, by) {
      return write(["tags"], () => {
        const { group, tag } = tagOf(ref);
        const siblings = listTags(store, { groupId: group.id }).filter((t) => t.parentId === tag.parentId);
        const to = neighbour(siblings, tag.id, by);
        if (to) moveTag(store, tag.id, to);
      });
    },
  };

  /* ---------- folders ---------- */
  const kindOf = (kind: FolderKind) => ((FOLDER_KINDS as readonly string[]).includes(kind) ? kind : refuse("invalid", "Folders hold playlists or pad boards.", "kind"));
  const areaOf = (kind: FolderKind): LyreArea => (kind === "playlists" ? "playlists" : "boards");
  const apiFolder = (id: string): FolderInfo => {
    const f = getFolder(store, id) ?? refuse("not-found", "That folder no longer exists.");
    return { id: f.id, kind: f.scope as FolderKind, name: f.name, parentId: f.parentId, color: f.color as PadColor | null };
  };
  const folderKindOf = (id: string): FolderKind => {
    const f = getFolder(store, id);
    return f && (f.scope === "playlists" || f.scope === "boards") ? f.scope : "playlists";
  };
  function moveItemInto(kind: FolderKind, itemId: string, folderId: string | null) {
    if (kind === "playlists") movePlaylist(store, itemId, { folderId, placement: "end" });
    else moveBoard(store, itemId, { folderId, placement: "end" });
  }
  const folders: Methods["folders"] = {
    async list(kind) {
      return listFolders(store, kindOf(kind)).map((f) => ({ id: f.id, kind, name: f.name, parentId: f.parentId, color: f.color as PadColor | null }));
    },
    async create(kind, input) {
      return write([areaOf(kind)], () => {
        kindOf(kind);
        let id = "";
        store.change(`Add folder ${quoted(trimmed(input?.name))}`, () => {
          id = createFolder(store, { scope: kind, name: input?.name, parentId: input?.parentId ?? null }).id;
          if (input?.moveIn) moveItemInto(kind, input.moveIn, id);
        });
        return apiFolder(id);
      });
    },
    async update(folderId, patch) {
      return write([areaOf(folderKindOf(folderId))], () => {
        apiFolder(folderId);
        const p = patch ?? {};
        updateFolder(store, folderId, { ...(p.name !== undefined ? { name: p.name } : {}), ...(p.color !== undefined ? { color: p.color } : {}) });
        return apiFolder(folderId);
      });
    },
    async delete(folderId) {
      return write([areaOf(folderKindOf(folderId))], () => {
        apiFolder(folderId);
        deleteFolder(store, folderId);
      });
    },
    async moveInto(kind, itemId, folderId) {
      return write([areaOf(kind)], () => {
        kindOf(kind);
        if (kind === "playlists" && !cx.playlistInfos().some((p) => p.id === itemId)) refuse("not-found", "That playlist no longer exists.");
        if (kind === "boards") cx.requireBoard(itemId);
        store.change("Move to folder", () => moveItemInto(kind, itemId, folderId));
      });
    },
  };

  /* ---------- ORG-4 playlist dividers ---------- */
  const dividerItem = (playlistId: string, dividerId: string) =>
    listPlaylistItems(store, playlistId).find((i) => i.id === dividerId && i.kind === "divider") ?? refuse("not-found", "That divider is no longer there.");
  const apiDivider = (playlistId: string, id: string): PlaylistDivider => cx.requireManual(playlistId).dividers.find((d) => d.id === id) as PlaylistDivider;
  const playlists: Methods["playlists"] = {
    async addDivider(playlistId, name, at) {
      return write(["playlists"], () => {
        const pl = cx.requireManual(playlistId);
        if (!trimmed(name)) refuse("invalid", "Give the divider a name.", "name");
        if (!Number.isInteger(at) || at < 0 || at > pl.trackIds.length) refuse("invalid", "That place is not in the playlist.", "at");
        const tracks = listPlaylistItems(store, playlistId).filter((i) => i.kind === "track");
        let id = "";
        store.change(`Add the divider ${quoted(trimmed(name))}`, () => (id = addPlaylistDivider(store, playlistId, name, at < tracks.length ? { before: tracks[at].id } : "end").id));
        return apiDivider(playlistId, id);
      });
    },
    async renameDivider(playlistId, dividerId, name) {
      return write(["playlists"], () => {
        cx.requireManual(playlistId);
        dividerItem(playlistId, dividerId);
        if (!trimmed(name)) refuse("invalid", "Give the divider a name.", "name");
        store.change(`Rename the divider ${quoted(trimmed(name))}`, () => renamePlaylistDivider(store, dividerId, name));
        return apiDivider(playlistId, dividerId);
      });
    },
    async removeDivider(playlistId, dividerId) {
      return write(["playlists"], () => {
        cx.requireManual(playlistId);
        dividerItem(playlistId, dividerId);
        store.change("Remove the divider", () => removePlaylistItems(store, [dividerId]));
      });
    },
    async moveItem(playlistId, item, toIndex) {
      return write(["playlists"], () => {
        cx.requireManual(playlistId);
        const items = listPlaylistItems(store, playlistId);
        const moving = items.find((i) => (item && "trackId" in item ? i.kind === "track" && i.trackId === item.trackId : i.kind === "divider" && i.id === (item as { dividerId: string })?.dividerId));
        if (!moving) refuse("not-found", "That is no longer in this playlist.");
        if (!Number.isInteger(toIndex)) refuse("invalid", "That place is not in the playlist.", "toIndex");
        const rest = items.filter((i) => i.id !== moving.id);
        const before = rest[Math.max(0, Math.min(rest.length, toIndex))];
        if (items.indexOf(moving) === Math.max(0, Math.min(rest.length, toIndex))) return;
        store.change("Move in the playlist", () => movePlaylistItems(store, [moving.id], before ? { before: before.id } : "end"));
      });
    },
  };

  /* ---------- ORG-4 board dividers, PLY-8 steps ---------- */
  const boards: Methods["boards"] = {
    async setDivider(boardId, row, name) {
      return write(["boards"], () => {
        cx.requireBoard(boardId);
        setBoardDivider(store, boardId, row, name);
        return cx.padBoard(boardId);
      });
    },
    async setPadSteps(boardId, padId, steps) {
      return write(["boards"], () => {
        cx.requirePad(boardId, padId);
        setSteps(store, { padId }, steps === null || !Array.isArray(steps) ? (steps as null) : stepsToKeep(steps, usualPadSteps()));
        const b = cx.padBoard(boardId);
        return [...b.slots, ...b.spare].find((p) => p?.id === padId) as PadBoard["spare"][number];
      });
    },
  };
  const sessions: Methods["sessions"] = {
    async setSceneSteps(address, steps, movesOn) {
      return write(["campaigns"], () => {
        const { scene } = cx.requireScene(address);
        const keep = steps === null || !Array.isArray(steps) ? (steps as null) : stepsToKeep(steps, usualSceneSteps(scene));
        store.change(`What ${scene.name || "the scene"} does when it starts`, () => {
          setMovesOn(store, scene.id, movesOn);
          setSteps(store, { sceneId: scene.id }, keep);
        });
        return cx.requireScene(address).scene;
      });
    },
  };

  /* ---------- UX-12 Find and play, ORG-5 put ---------- */
  const library: Methods["library"] = {
    async find(request) {
      const { text, lane, limit = 50, in: where } = request;
      const max = Math.max(0, limit);
      const { tracks, playlists: found } = await cx.round6Find(request);
      const words = trimmed(text);
      const hits = (kind: "pad" | "scene") => (words ? search(store, text, { kinds: [kind], limit: 1000 }).map((h) => h.id) : []);
      const pads: FoundPad[] = [];
      if (!lane || lane === "fx") {
        const ids = hits("pad");
        if (ids.length) {
          const rows = new Map(
            store
              .all<{ id: string; label: string; board_id: string; title: string }>(
                "SELECT p.id, p.label, b.id AS board_id, b.title FROM pads p JOIN boards b ON b.id = p.board_id WHERE p.id IN (SELECT value FROM json_each(?))",
                JSON.stringify(ids),
              )
              .map((r) => [r.id, r]),
          );
          for (const id of ids.slice(0, max)) {
            const r = rows.get(id);
            if (r) pads.push({ boardId: r.board_id, padId: r.id, label: r.label, boardName: r.title });
          }
        }
      }
      const scenes: FoundScene[] = [];
      if (!lane) {
        const ids = hits("scene");
        if (ids.length) {
          const where7 = new Map<string, FoundScene>();
          for (const c of cx.allCampaignInfos())
            for (const s of c.sessions) for (const sc of s.scenes) where7.set(sc.id, { campaignId: c.id, sessionId: s.id, sceneId: sc.id, name: sc.name, sessionNumber: s.number });
          const all = ids.map((id) => where7.get(id)).filter((x): x is FoundScene => !!x);
          // The session Live runs comes first; otherwise the search's order.
          const here = (x: FoundScene) => !!where && x.campaignId === where.campaignId && x.sessionId === where.sessionId;
          scenes.push(...[...all.filter(here), ...all.filter((x) => !here(x))].slice(0, max));
        }
      }
      return { tracks, playlists: found, pads, scenes };
    },
    async put(request) {
      const kind = request?.place?.kind;
      const areas: LyreArea[] = kind === "board" ? ["boards"] : kind === "scene" ? ["campaigns"] : ["playlists"];
      return write(areas, () => {
        const { place, what, from, move } = request ?? ({} as never);
        if (!what || !Array.isArray(what.ids) || !["tracks", "playlists", "boards"].includes(what.kind)) refuse("invalid", "Drag tracks, playlists or pad boards.", "what");
        const ids = [...new Set(what.ids)];
        if (place?.kind === "playlist") {
          const pl = cx.requireManual(place.playlistId);
          if (what.kind !== "tracks") refuse("wrong-kind", "Only tracks go into a playlist.");
          ids.forEach(cx.requireTrack);
          const added = ids.filter((id) => !pl.trackIds.includes(id));
          const alreadyIn = ids.filter((id) => pl.trackIds.includes(id));
          const src = move && from && from !== pl.id ? cx.requireManual(from) : null;
          if (added.length || src) {
            const label = src ? `Move ${ids.length === 1 ? quoted(shownTitle(cx.requireTrack(ids[0]))) : plural(ids.length, "track")} to ${quoted(pl.name)}` : `Add ${added.length === 1 ? quoted(shownTitle(cx.requireTrack(added[0]))) : plural(added.length, "track")} to ${quoted(pl.name)}`;
            store.change(label, () => {
              if (added.length) addTracksToPlaylist(store, pl.id, added, "end");
              if (src) {
                const leaving = listPlaylistItems(store, src.id).filter((i) => i.kind === "track" && ids.includes(i.trackId as string)).map((i) => i.id);
                if (leaving.length) removePlaylistItems(store, leaving);
              }
            });
          }
          return { added, alreadyIn, moved: !!src, placeName: pl.name };
        }
        if (place?.kind === "board") {
          const b = cx.requireBoard(place.boardId);
          if (what.kind !== "tracks") refuse("wrong-kind", "Only effects and stings become pads.");
          const tracks = ids.map(cx.requireTrack);
          if (tracks.some((t) => !isFx(t))) refuse("wrong-kind", "Only effects and stings become pads: music goes in a playlist.");
          const added: string[] = [];
          store.change(`Add ${tracks.length === 1 ? `the pad ${quoted(shownTitle(tracks[0]))}` : plural(tracks.length, "pad")} to ${quoted(b.name)}`, () => {
            const free = b.slots.map((p, i) => (p ? -1 : i)).filter((i) => i > -1);
            for (const t of tracks) {
              const slot = free.shift();
              const at = slot === undefined ? ("spare" as const) : { row: Math.floor(slot / b.cols), col: slot % b.cols };
              const label = shownTitle(t).split(/[,(-]/)[0].trim().slice(0, 24) || "New pad";
              added.push(addPad(store, b.id, { label, icon: "note", color: "bone", mode: "oneshot", sound: { kind: "single", trackIds: [t.id], order: "random", tagId: null }, at }).id);
            }
          });
          return { added, alreadyIn: [], moved: false, placeName: b.name };
        }
        if (place?.kind === "scene") {
          const { scene } = cx.requireScene(place);
          if (what.kind === "boards") {
            ids.forEach(cx.requireBoard);
            const added = ids.filter((id) => !scene.boardIds.includes(id));
            if (added.length) store.change(`Add to the pad boards of ${quoted(scene.name)}`, () => addSceneBoards(store, scene.id, added));
            return { added, alreadyIn: ids.filter((id) => !added.includes(id)), moved: false, placeName: `${scene.name} pad boards` };
          }
          const refs: SoundRef[] = ids.map((id) => ({ kind: what.kind === "tracks" ? "track" : "playlist", id }));
          refs.forEach(cx.checkMusic);
          const has = (r: SoundRef) => scene.music.some((m) => m.kind === r.kind && m.id === r.id);
          const added = refs.filter((r) => !has(r));
          if (added.length) store.change(`Add to the music of ${quoted(scene.name)}`, () => addSceneMusic(store, scene.id, added));
          return { added: added.map((r) => r.id), alreadyIn: refs.filter(has).map((r) => r.id), moved: false, placeName: `${scene.name} music` };
        }
        return refuse("invalid", "Drop it on a playlist, a pad board or a scene. Up next is in the room's Now playing.", "place");
      });
    },
  };

  /* ---------- settings ---------- */
  const settingsNow = (): LyreSettings => {
    const play = getPlaySettings(store);
    return {
      crossfade: play.crossfade,
      shortcuts: getShortcuts(store),
      nextSceneGuard: play.nextSceneGuard,
      display: { ...computer.display },
      devices: { ...computer.devices },
      globalKeys: computer.globalKeys,
      streamingMode: computer.streamingMode,
    };
  };
  async function saveComputer() {
    if (!cx.computerFile) return;
    // Written beside and moved into place, so a crash never leaves half a file.
    const part = `${cx.computerFile}.part`;
    await fs.promises.mkdir(path.dirname(cx.computerFile), { recursive: true });
    await fs.promises.writeFile(part, JSON.stringify(computer, null, 2), "utf8");
    await fs.promises.rename(part, cx.computerFile);
  }
  const settings: Methods["settings"] = {
    async get() {
      return settingsNow();
    },
    async setCrossfade(crossfade) {
      return write(["settings"], () => (setCrossfade(store, crossfade), settingsNow()));
    },
    async setShortcut(action, key) {
      return write(["settings"], () => (setShortcut(store, action, key), settingsNow()));
    },
    async resetShortcuts() {
      return write(["settings"], () => (resetShortcuts(store), settingsNow()));
    },
    async setNextSceneGuard(on) {
      return write(["settings"], () => (setNextSceneGuard(store, on), settingsNow()));
    },
    async setComputer(patch) {
      return cx.writeOutside(["settings"], async () => {
        if (!patch || typeof patch !== "object") refuse("invalid", "Choose a setting.");
        const problem =
          checkDisplay(patch.display ?? {}) ??
          checkDevices(patch.devices ?? {}) ??
          (patch.globalKeys !== undefined && typeof patch.globalKeys !== "boolean" ? "Choose on or off." : null) ??
          (patch.streamingMode !== undefined ? checkStreamingMode(patch.streamingMode) : null);
        if (problem) refuse("invalid", problem);
        // Review 0.5.0 CR-9: only the known settings are copied (argChecks.ts also refuses any other).
        copyKnown(computer.display, patch.display, DISPLAY_KEYS);
        copyKnown(computer.devices, patch.devices, DEVICE_KEYS);
        if (patch.globalKeys !== undefined) computer.globalKeys = patch.globalKeys;
        if (patch.streamingMode !== undefined) computer.streamingMode = patch.streamingMode;
        await saveComputer().catch((error: unknown) => {
          cx.log?.("Could not save this computer's settings", error);
          refuse("not-saved", "Lyre could not write it to your computer. Try again; if it fails again, check that the drive has space.");
        });
        return settingsNow();
      });
    },
  };

  return { library, tags, folders, playlists, boards, sessions, settings };
}
