/**
 * Design round 7 in the in-memory LyreApi (fake.ts): tag groups and tags (DAT-10), folders and dividers (ORG-4),
 * put (ORG-5), steps (PLY-8), the round 7 settings (UX-12, PLY-8, UX-11, PRV-2) and Find and play's pads and scenes
 * (UX-12). Kept apart from fake.ts so that file stays readable; it works on the fake's state through `FakeContext`.
 * The rules are the shared ones (src/common/domain/round7.ts) and the refusals the contract suite expects.
 */
import {
  checkCrossfade,
  checkDevices,
  checkDisplay,
  checkSteps,
  CUE_STEP_KINDS,
  DEFAULT_DEVICES,
  DEFAULT_DISPLAY,
  isFx,
  normaliseKey,
  SHORTCUT_ACTIONS,
  SHORTCUT_IDS,
  shortcutUsing,
  STEP_HOWS,
  STEP_STOPS,
  STEP_UP_NEXTS,
  stepsToKeep,
  tagsInside,
  usualPadSteps,
  usualSceneSteps,
  type Crossfade,
  type CueStep,
  type MovesOn,
  type ShortcutMap,
  type SoundRef,
} from "../domain";
import type {
  CampaignInfo,
  ComputerSettingsPatch,
  FindRequest,
  FolderInfo,
  FolderKind,
  FoundPad,
  FoundScene,
  LibraryTrack,
  LyreApi,
  LyreSettings,
  Pad,
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
  LyreArea,
} from "./api";
import { FOLDER_KINDS, PAD_COLORS } from "./api";
import { plural, quoted, shownTitle, trimmed } from "./text";

/** The parts of the fake's state round 7 adds (kept in the undo slices of their areas). */
export interface Round7State {
  /** ORG-4: folders of playlists ("playlists" area) and of pad boards ("boards" area). */
  playlistFolders: FolderInfo[];
  boardFolders: FolderInfo[];
  /** The settings kept with the library ("settings" area). */
  settings: { crossfade: Crossfade; shortcuts: ShortcutMap; nextSceneGuard: boolean };
}

/** What fakeRound7 needs from the fake's closure. */
export interface FakeContext {
  state(): {
    tracks: LibraryTrack[];
    tagGroups: TagGroup[];
    playlists: PlaylistInfo[];
    boards: PadBoard[];
    campaigns: CampaignInfo[];
  } & Round7State;
  write<T>(label: string | ((value: T) => string), areas: LyreArea[], fn: () => T): WriteResult<T>;
  refuse(code: RefusalCode, message: string, field?: string): never;
  track(id: string): LibraryTrack;
  playlist(id: string): PlaylistInfo;
  board(id: string): PadBoard;
  scene(a: SceneAddress): { session: SessionInfo; scene: SceneInfo; index: number };
  padAt(b: PadBoard, padId: string): { where: "slot" | "spare"; index: number; pad: Pad };
  newId(prefix: string): string;
  copy<T>(value: T): T;
  words(text: string): string[];
  checkMusic(ref: SoundRef): void;
  /** The library's search of tracks (library.search), for find. */
  searchTracks: LyreApi["library"]["search"];
  /** What Undo would undo now, and a "changed" event for a write the history does not keep. */
  undoLabel(): string | null;
  changedOutsideHistory(areas: LyreArea[]): void;
  /** Round 6's find of playlists, for find. */
  findPlaylists(request: FindRequest): Promise<Awaited<ReturnType<LyreApi["library"]["find"]>>["playlists"]>;
}

export const defaultRound7State = (): Round7State => ({
  playlistFolders: [],
  boardFolders: [],
  settings: { crossfade: { ms: 3000, curve: "even" }, shortcuts: {}, nextSceneGuard: true },
});

type Methods = {
  library: Pick<LyreApi["library"], "find" | "put">;
  tags: Omit<LyreApi["tags"], "listGroups" | "tagTracks">;
  folders: LyreApi["folders"];
  playlists: Pick<LyreApi["playlists"], "addDivider" | "renameDivider" | "removeDivider" | "moveItem">;
  boards: Pick<LyreApi["boards"], "setDivider" | "setPadSteps">;
  sessions: Pick<LyreApi["sessions"], "setSceneSteps">;
  settings: LyreApi["settings"];
};

/** ORG-4: a manual playlist's list with its dividers, and back (dividers keep their place among the tracks). */
type Item = { trackId: string } | { divider: { id: string; name: string } };
export function itemsOf(pl: Extract<PlaylistInfo, { kind: "manual" }>): Item[] {
  const out: Item[] = [];
  const dividers = [...pl.dividers].sort((a, b) => a.at - b.at);
  let d = 0;
  pl.trackIds.forEach((trackId, i) => {
    for (; d < dividers.length && dividers[d].at <= i; d++) out.push({ divider: { id: dividers[d].id, name: dividers[d].name } });
    out.push({ trackId });
  });
  for (; d < dividers.length; d++) out.push({ divider: { id: dividers[d].id, name: dividers[d].name } });
  return out;
}
export function setItems(pl: Extract<PlaylistInfo, { kind: "manual" }>, items: Item[]): void {
  pl.trackIds = [];
  pl.dividers = [];
  for (const item of items) {
    if ("trackId" in item) pl.trackIds.push(item.trackId);
    else pl.dividers.push({ ...item.divider, at: pl.trackIds.length });
  }
}

/** PLY-8, SHW-3: what goes when a track, playlist, board, pad or scene is deleted (the database's ON DELETE CASCADE). */
export function dropReferences(state: ReturnType<FakeContext["state"]>, gone: { trackId?: string; playlistId?: string; boardId?: string; padIds?: string[]; sceneId?: string }): void {
  const names = (ref: SoundRef) => (ref.kind === "track" ? ref.id === gone.trackId : ref.id === gone.playlistId);
  const keep = (st: CueStep) => {
    if ((st.do === "music" || st.do === "ambience" || st.do === "play") && names(st.what)) return false;
    if (st.do === "board" && st.boardId === gone.boardId) return false;
    if (st.do === "pad" && (st.boardId === gone.boardId || gone.padIds?.includes(st.padId))) return false;
    if (st.do === "scene" && st.scene.sceneId === gone.sceneId) return false;
    return true;
  };
  for (const c of state.campaigns) for (const s of c.sessions) for (const sc of s.scenes) if (sc.steps) sc.steps = sc.steps.filter(keep);
  for (const b of state.boards) for (const p of [...b.slots, ...b.spare]) if (p?.steps) p.steps = p.steps.filter(keep);
  for (const t of state.tracks) if (t.follow && names(t.follow)) t.follow = null;
}

export function fakeRound7(cx: FakeContext, computer: { display: LyreSettings["display"]; devices: LyreSettings["devices"]; globalKeys: boolean }): Methods {
  const { write, refuse } = cx;
  const st = () => cx.state();

  /* ---------- tags ---------- */
  const group = (id: string): TagGroup => st().tagGroups.find((g) => g.id === id) ?? refuse("not-found", "That tag group no longer exists.");
  const tagIn = (g: TagGroup, value: string): TagInfo => g.tags.find((t) => t.name === value) ?? refuse("not-found", `There is no tag called ${quoted(value)} in ${g.name}.`);
  const color = (c: unknown, field = "color"): PadColor | null => {
    if (c === null || c === undefined) return null;
    if (!(PAD_COLORS as readonly unknown[]).includes(c)) refuse("invalid", `Choose one of the colours: ${PAD_COLORS.join(", ")}.`, field);
    return c as PadColor;
  };
  /** Every track, rule and pad naming `from` names `to` instead (or nothing); returns the tracks that had it. */
  function retag(g: TagGroup, from: string, to: string | null): number {
    let n = 0;
    for (const t of st().tracks) {
      const have = t.tags[g.id] ?? [];
      const i = have.indexOf(from);
      if (i < 0) continue;
      n++;
      have.splice(i, 1);
      if (to && !have.includes(to)) have.splice(i, 0, to);
    }
    for (const p of st().playlists) {
      if (p.kind !== "dynamic") continue;
      for (const c of p.rule.conds) {
        if (c.group !== g.id) continue;
        const i = c.values.indexOf(from);
        if (i < 0) continue;
        c.values.splice(i, 1);
        if (to && !c.values.includes(to)) c.values.splice(i, 0, to);
      }
    }
    for (const b of st().boards) for (const p of [...b.slots, ...b.spare]) if (p?.sound.tag?.group === g.id && p.sound.tag.value === from) p.sound.tag = to ? { group: g.id, value: to } : null;
    return n;
  }
  function moveAmong<T>(list: T[], item: T, by: -1 | 1, same: (x: T) => boolean): void {
    if (by !== -1 && by !== 1) refuse("invalid", "Move up or down one place.", "by");
    const peers = list.filter(same);
    const k = peers.indexOf(item);
    const other = peers[k + by];
    if (!other) return;
    list.splice(list.indexOf(item), 1);
    list.splice(list.indexOf(other) + (by > 0 ? 1 : 0), 0, item);
  }
  const sortValues = (g: TagGroup) => (g.values = g.tags.map((t) => t.name));

  const tags: Methods["tags"] = {
    async createGroup(name, c) {
      return write((g: TagGroup) => `Add tag group ${quoted(g.name)}`, ["tags", "tracks"], () => {
        const n = trimmed(name);
        if (!n) refuse("invalid", "Give the group a name.", "name");
        if (st().tagGroups.some((g) => g.name.toLowerCase() === n.toLowerCase())) refuse("invalid", `A tag group called ${quoted(n)} already exists.`, "name");
        const g: TagGroup = { id: cx.newId("group"), name: n, values: [], color: color(c), tags: [] };
        st().tagGroups.push(g);
        for (const t of st().tracks) t.tags[g.id] = [];
        return g;
      });
    },
    async updateGroup(groupId, patch) {
      return write((g: TagGroup) => `Change tag group ${quoted(g.name)}`, ["tags"], () => {
        const g = group(groupId);
        if (patch.name !== undefined) {
          const n = trimmed(patch.name);
          if (!n) refuse("invalid", "Give the group a name.", "name");
          if (st().tagGroups.some((x) => x !== g && x.name.toLowerCase() === n.toLowerCase())) refuse("invalid", `A tag group called ${quoted(n)} already exists.`, "name");
          g.name = n;
        }
        if (patch.color !== undefined) g.color = color(patch.color);
        return g;
      });
    },
    async moveGroup(groupId, by) {
      return write("Move tag group", ["tags"], () => {
        const g = group(groupId);
        moveAmong(st().tagGroups, g, by, () => true);
      });
    },
    async deleteGroup(groupId) {
      let name = "";
      return write(() => `Delete tag group ${quoted(name)}`, ["tags", "tracks", "playlists", "boards"], () => {
        const g = group(groupId);
        name = g.name;
        let n = 0;
        for (const t of st().tracks) {
          if ((t.tags[g.id] ?? []).length) n++;
          delete t.tags[g.id];
        }
        for (const p of st().playlists) if (p.kind === "dynamic") p.rule.conds = p.rule.conds.filter((c) => c.group !== g.id);
        for (const b of st().boards) for (const p of [...b.slots, ...b.spare]) if (p?.sound.tag?.group === g.id) p.sound.tag = null;
        st().tagGroups.splice(st().tagGroups.indexOf(g), 1);
        return { tracks: n };
      });
    },
    async createTag(groupId, name, parent = null) {
      return write((r: TagRef) => `Add tag ${quoted(r.value)}`, ["tags"], () => {
        const g = group(groupId);
        const n = trimmed(name);
        if (!n) refuse("invalid", "Give the tag a name.", "name");
        if (g.values.some((v) => v.toLowerCase() === n.toLowerCase())) refuse("invalid", `A tag called ${quoted(n)} in this group already exists.`, "name");
        if (parent !== null) tagIn(g, parent);
        g.tags.push({ name: n, parent, also: [], color: null });
        sortValues(g);
        return { group: g.id, value: n };
      });
    },
    async renameTag(ref, name) {
      let label = "";
      return write(() => label, ["tags", "tracks", "playlists", "boards"], () => {
        const g = group(ref.group);
        const info = tagIn(g, ref.value);
        const n = trimmed(name);
        if (!n) refuse("invalid", "Give the tag a name.", "name");
        if (n === info.name) return { tracks: 0 };
        if (g.values.some((v) => v !== info.name && v.toLowerCase() === n.toLowerCase())) refuse("invalid", `${n} is already a tag here: use Merge into… instead.`, "name");
        const count = retag(g, info.name, n);
        for (const t of g.tags) if (t.parent === info.name) t.parent = n;
        label = `Rename ${quoted(info.name)} to ${quoted(n)} on ${plural(count, "track")}`;
        info.name = n;
        sortValues(g);
        return { tracks: count };
      });
    },
    async mergeTag(ref, into) {
      let label = "";
      return write(() => label, ["tags", "tracks", "playlists", "boards"], () => {
        const g = group(ref.group);
        const info = tagIn(g, ref.value);
        const target = tagIn(g, into);
        if (target === info || tagsInside(treeOf(g), g.id, info.name).includes(target.name)) refuse("invalid", "Merge it into another tag, not into itself or a tag inside it.", "into");
        const count = retag(g, info.name, target.name);
        for (const t of g.tags) if (t.parent === info.name) t.parent = target.name;
        target.also = [...new Set([...target.also, info.name.toLowerCase(), ...info.also])];
        g.tags.splice(g.tags.indexOf(info), 1);
        sortValues(g);
        label = `Merge ${quoted(info.name)} into ${quoted(target.name)} on ${plural(count, "track")}`;
        return { tracks: count };
      });
    },
    async deleteTag(ref) {
      let label = "";
      return write(() => label, ["tags", "tracks", "playlists", "boards"], () => {
        const g = group(ref.group);
        const info = tagIn(g, ref.value);
        // The tags inside it move up a level, to where it was (r7tags.js tgdelok).
        for (const t of g.tags) if (t.parent === info.name) t.parent = info.parent;
        const count = retag(g, info.name, null);
        g.tags.splice(g.tags.indexOf(info), 1);
        sortValues(g);
        label = `Delete tag ${quoted(info.name)} from ${plural(count, "track")}`;
        return { tracks: count };
      });
    },
    async updateTag(ref, patch) {
      return write((t: TagInfo) => `Change tag ${quoted(t.name)}`, ["tags"], () => {
        const g = group(ref.group);
        const info = tagIn(g, ref.value);
        if (patch.parent !== undefined) {
          if (patch.parent !== null) {
            const parent = tagIn(g, patch.parent);
            if (parent === info || tagsInside(treeOf(g), g.id, info.name).includes(parent.name)) refuse("invalid", "A tag cannot go inside itself.", "parent");
          }
          info.parent = patch.parent;
        }
        if (patch.also !== undefined) {
          if (!Array.isArray(patch.also) || patch.also.some((w) => typeof w !== "string")) refuse("invalid", "Other words are a list of words.", "also");
          info.also = [...new Set(patch.also.map((w) => w.trim().toLowerCase()).filter(Boolean))];
        }
        if (patch.color !== undefined) info.color = color(patch.color);
        return info;
      });
    },
    async moveTag(ref, by) {
      return write("Move tag", ["tags"], () => {
        const g = group(ref.group);
        const info = tagIn(g, ref.value);
        moveAmong(g.tags, info, by, (t) => t.parent === info.parent);
        sortValues(g);
      });
    },
  };
  const treeOf = (g: TagGroup) => ({ [g.id]: Object.fromEntries(g.tags.filter((t) => t.parent).map((t) => [t.name, t.parent as string])) });

  /* ---------- folders ---------- */
  const foldersOf = (kind: FolderKind) => {
    if (!(FOLDER_KINDS as readonly string[]).includes(kind)) refuse("invalid", "Folders hold playlists or pad boards.", "kind");
    return kind === "playlists" ? st().playlistFolders : st().boardFolders;
  };
  const areaOf = (kind: FolderKind): LyreArea => (kind === "playlists" ? "playlists" : "boards");
  const folderById = (id: string): FolderInfo =>
    [...st().playlistFolders, ...st().boardFolders].find((f) => f.id === id) ?? refuse("not-found", "That folder no longer exists.");
  const itemOf = (kind: FolderKind, id: string): { folderId: string | null } => (kind === "playlists" ? cx.playlist(id) : cx.board(id));
  function putInto(kind: FolderKind, itemId: string, folderId: string | null) {
    const item = itemOf(kind, itemId);
    if (folderId !== null) {
      const f = folderById(folderId);
      if (f.kind !== kind) refuse("invalid", `That folder holds ${f.kind === "playlists" ? "playlists" : "pad boards"}.`, "folderId");
    }
    item.folderId = folderId;
  }
  const folders: Methods["folders"] = {
    async list(kind) {
      const list = foldersOf(kind);
      const out: FolderInfo[] = [];
      const visit = (parent: string | null) => list.filter((f) => f.parentId === parent).forEach((f) => (out.push(f), visit(f.id)));
      visit(null);
      return cx.copy(out);
    },
    async create(kind, input) {
      const areas: LyreArea[] = [areaOf(kind)];
      return write((f: FolderInfo) => `Add folder ${quoted(f.name)}`, areas, () => {
        const list = foldersOf(kind);
        const name = trimmed(input?.name);
        if (!name) refuse("invalid", "Give the folder a name.", "name");
        const parentId = input.parentId ?? null;
        if (parentId !== null && folderById(parentId).kind !== kind) refuse("invalid", "A folder goes inside a folder of the same kind.", "parentId");
        const f: FolderInfo = { id: cx.newId("folder"), kind, name, parentId, color: null };
        list.push(f);
        if (input.moveIn) putInto(kind, input.moveIn, f.id);
        return f;
      });
    },
    async update(folderId, patch) {
      const area = areaOf(folderById(folderId)?.kind ?? "playlists");
      return write((f: FolderInfo) => `Change folder ${quoted(f.name)}`, [area], () => {
        const f = folderById(folderId);
        if (patch.name !== undefined) {
          const name = trimmed(patch.name);
          if (!name) refuse("invalid", "Give the folder a name.", "name");
          f.name = name;
        }
        if (patch.color !== undefined) f.color = color(patch.color);
        return f;
      });
    },
    async delete(folderId) {
      let found: FolderInfo | null = null;
      try {
        found = folderById(folderId);
      } catch {
        found = null;
      }
      return write(() => `Delete folder ${quoted(found?.name ?? "")}`, [areaOf(found?.kind ?? "playlists")], () => {
        const f = folderById(folderId);
        const list = foldersOf(f.kind);
        for (const sub of list) if (sub.parentId === f.id) sub.parentId = f.parentId;
        const items: { folderId: string | null }[] = f.kind === "playlists" ? st().playlists : st().boards;
        for (const item of items) if (item.folderId === f.id) item.folderId = f.parentId;
        list.splice(list.indexOf(f), 1);
      });
    },
    async moveInto(kind, itemId, folderId) {
      return write("Move to folder", [areaOf(kind)], () => putInto(kind, itemId, folderId));
    },
  };

  /* ---------- ORG-4 dividers ---------- */
  type Manual = Extract<PlaylistInfo, { kind: "manual" }>;
  const manualOf = (id: string, why = "it has no dividers"): Manual => {
    const pl = cx.playlist(id);
    return pl.kind === "manual" ? pl : refuse("wrong-kind", `"${pl.name}" is a dynamic playlist: ${why}.`);
  };
  const dividerOf = (pl: Manual, id: string): PlaylistDivider => pl.dividers.find((d) => d.id === id) ?? refuse("not-found", "That divider is no longer there.");
  const playlists: Methods["playlists"] = {
    async addDivider(playlistId, name, at) {
      return write((d: PlaylistDivider) => `Add the divider ${quoted(d.name)}`, ["playlists"], () => {
        const pl = manualOf(playlistId);
        const n = trimmed(name);
        if (!n) refuse("invalid", "Give the divider a name.", "name");
        if (!Number.isInteger(at) || at < 0 || at > pl.trackIds.length) refuse("invalid", "That place is not in the playlist.", "at");
        const d = { id: cx.newId("divider"), name: n, at };
        pl.dividers.push(d);
        setItems(pl, itemsOf(pl));
        return pl.dividers.find((x) => x.id === d.id) ?? d;
      });
    },
    async renameDivider(playlistId, dividerId, name) {
      return write((d: PlaylistDivider) => `Rename the divider ${quoted(d.name)}`, ["playlists"], () => {
        const d = dividerOf(manualOf(playlistId), dividerId);
        const n = trimmed(name);
        if (!n) refuse("invalid", "Give the divider a name.", "name");
        d.name = n;
        return d;
      });
    },
    async removeDivider(playlistId, dividerId) {
      return write("Remove the divider", ["playlists"], () => {
        const pl = manualOf(playlistId);
        pl.dividers.splice(pl.dividers.indexOf(dividerOf(pl, dividerId)), 1);
      });
    },
    async moveItem(playlistId, item, toIndex) {
      return write("Move in the playlist", ["playlists"], () => {
        const pl = manualOf(playlistId);
        const items = itemsOf(pl);
        const from = items.findIndex((x) => ("trackId" in item ? "trackId" in x && x.trackId === item.trackId : "divider" in x && x.divider.id === item.dividerId));
        if (from < 0) refuse("not-found", "That is no longer in this playlist.");
        if (!Number.isInteger(toIndex)) refuse("invalid", "That place is not in the playlist.", "toIndex");
        const [moved] = items.splice(from, 1);
        items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, moved);
        setItems(pl, items);
      });
    },
  };

  /* ---------- PLY-8 steps, ORG-4 board dividers ---------- */
  function checkStepRefs(steps: unknown, owner: "scene" | "pad"): CueStep[] {
    if (!Array.isArray(steps)) refuse("invalid", "Steps are a list.", "steps");
    for (const s of steps as CueStep[]) {
      if (!s || !(CUE_STEP_KINDS as readonly string[]).includes(s.do)) refuse("invalid", "Lyre does not know that step.", "steps");
      if (s.do === "music" || s.do === "play" || s.do === "ambience") {
        if (s.what?.kind === "track") cx.track(s.what.id);
        else if (s.what?.kind === "playlist") cx.playlist(s.what.id);
        else refuse("invalid", "A step plays a track or a playlist.", "steps");
      }
      if ((s.do === "music" || s.do === "play") && (!(STEP_HOWS as readonly string[]).includes(s.how) || !(STEP_UP_NEXTS as readonly string[]).includes(s.upNext))) refuse("invalid", "Choose how it comes in and what happens to Up next.", "steps");
      if (s.do === "stop" && !(STEP_STOPS as readonly string[]).includes(s.what)) refuse("invalid", "Stop the music, the ambience or everything.", "steps");
      if (s.do === "board") cx.board(s.boardId);
      if (s.do === "pad") cx.padAt(cx.board(s.boardId), s.padId);
      if (s.do === "scene") cx.scene(s.scene);
    }
    const problem = checkSteps(steps as CueStep[], owner);
    if (problem) refuse("invalid", problem, "steps");
    return cx.copy(steps as CueStep[]);
  }
  function checkMovesOn(m: MovesOn): MovesOn {
    if (!m || !["stay", "musicEnds", "after"].includes(m.when)) refuse("invalid", "Choose when the scene moves on.", "movesOn");
    if (m.when === "after") {
      if (!Number.isInteger(m.ms) || m.ms < 1000 || m.ms > 21_600_000) refuse("invalid", "A scene moves on after a second to six hours.", "movesOn");
      return { when: "after", ms: m.ms };
    }
    return { when: m.when };
  }
  const boards: Methods["boards"] = {
    async setDivider(boardId, row, name) {
      return write(name === null ? "Remove a divider" : `Add the divider ${quoted(trimmed(name))}`, ["boards"], () => {
        const b = cx.board(boardId);
        if (!Number.isInteger(row) || row < 0 || row > 7) refuse("invalid", "A divider goes above one of the rows.", "row");
        b.dividers = b.dividers.filter((d) => d.row !== row);
        if (name !== null) {
          const n = trimmed(name);
          if (!n) refuse("invalid", "Give the divider a name.", "name");
          b.dividers.push({ row, name: n });
          b.dividers.sort((x, y) => x.row - y.row);
        }
        return b;
      });
    },
    async setPadSteps(boardId, padId, steps) {
      return write((p: Pad) => `What ${p.label} does`, ["boards"], () => {
        const { pad } = cx.padAt(cx.board(boardId), padId);
        pad.steps = steps === null ? null : stepsToKeep(checkStepRefs(steps, "pad"), usualPadSteps());
        return pad;
      });
    },
  };
  const sessions: Methods["sessions"] = {
    async setSceneSteps(address, steps, movesOn) {
      return write((sc: SceneInfo) => `What ${sc.name || "the scene"} does when it starts`, ["campaigns"], () => {
        const { scene: sc } = cx.scene(address);
        sc.movesOn = checkMovesOn(movesOn);
        sc.steps = steps === null ? null : stepsToKeep(checkStepRefs(steps, "scene"), usualSceneSteps(sc));
        return sc;
      });
    },
  };

  /* ---------- ORG-5 put ---------- */
  const library: Methods["library"] = {
    async find(request) {
      const { text, lane, limit = 50, in: where } = request;
      const [tracks, found] = await Promise.all([cx.searchTracks({ text, lane, limit }), cx.findPlaylists(request)]);
      const want = cx.words(text ?? "");
      const matches = (name: string) => want.length > 0 && want.every((w) => cx.words(name).some((x) => x.startsWith(w)));
      const pads: FoundPad[] = [];
      if (!lane || lane === "fx")
        for (const b of st().boards) for (const p of [...b.slots, ...b.spare]) if (p && matches(p.label)) pads.push({ boardId: b.id, padId: p.id, label: p.label, boardName: b.name });
      const scenes: (FoundScene & { here: boolean })[] = [];
      if (!lane)
        for (const c of st().campaigns)
          for (const s of c.sessions)
            for (const sc of s.scenes) if (matches(sc.name)) scenes.push({ campaignId: c.id, sessionId: s.id, sceneId: sc.id, name: sc.name, sessionNumber: s.number, here: !!where && where.campaignId === c.id && where.sessionId === s.id });
      scenes.sort((a, b) => Number(b.here) - Number(a.here));
      return { tracks, playlists: found, pads: pads.slice(0, Math.max(0, limit)), scenes: scenes.slice(0, Math.max(0, limit)).map(({ here: _here, ...x }) => x) };
    },
    async put(request) {
      let placeName = "";
      const areas: LyreArea[] = request?.place?.kind === "board" ? ["boards"] : request?.place?.kind === "scene" ? ["campaigns"] : ["playlists"];
      return write(() => `Add to ${placeName}`, areas, () => {
        const { place, what, from, move } = request ?? ({} as never);
        if (!what || !Array.isArray(what.ids) || !["tracks", "playlists", "boards"].includes(what.kind)) refuse("invalid", "Drag tracks, playlists or pad boards.", "what");
        const ids = [...new Set(what.ids)];
        if (place?.kind === "playlist") {
          const pl = manualOf(place.playlistId, "it picks up tracks by their tags");
          if (what.kind !== "tracks") refuse("wrong-kind", "Only tracks go into a playlist.");
          ids.forEach(cx.track);
          placeName = pl.name;
          const added = ids.filter((id) => !pl.trackIds.includes(id));
          const alreadyIn = ids.filter((id) => pl.trackIds.includes(id));
          pl.trackIds.push(...added);
          let moved = false;
          if (move && from && from !== pl.id) {
            const src = manualOf(from);
            setItems(src, itemsOf(src).filter((x) => !("trackId" in x && ids.includes(x.trackId))));
            moved = true;
          }
          return { added, alreadyIn, moved, placeName };
        }
        if (place?.kind === "board") {
          const b = cx.board(place.boardId);
          if (what.kind !== "tracks") refuse("wrong-kind", "Only effects and stings become pads.");
          const tracks = ids.map(cx.track);
          if (tracks.some((t) => !isFx(t))) refuse("wrong-kind", "Only effects and stings become pads: music goes in a playlist.");
          placeName = b.name;
          const added: string[] = [];
          for (const t of tracks) {
            const pad: Pad = { id: cx.newId("pad"), label: shownTitle(t).split(/[,(-]/)[0].trim().slice(0, 24) || "New pad", icon: "note", color: "bone", key: "", mode: "oneshot", sound: { kind: "single", trackIds: [t.id], order: "random", tag: null }, volume: 0.8, fadeOutMs: 1500, aside: false, steps: null };
            const empty = b.slots.indexOf(null);
            if (empty > -1) b.slots[empty] = pad;
            else b.spare.push(pad);
            added.push(pad.id);
          }
          return { added, alreadyIn: [], moved: false, placeName };
        }
        if (place?.kind === "scene") {
          const { scene: sc } = cx.scene(place);
          if (what.kind === "boards") {
            ids.forEach(cx.board);
            placeName = `${sc.name} pad boards`;
            const added = ids.filter((id) => !sc.boardIds.includes(id));
            sc.boardIds.push(...added);
            return { added, alreadyIn: ids.filter((id) => !added.includes(id)), moved: false, placeName };
          }
          const refs: SoundRef[] = ids.map((id) => ({ kind: what.kind === "tracks" ? "track" : "playlist", id }));
          refs.forEach(cx.checkMusic);
          placeName = `${sc.name} music`;
          const has = (r: SoundRef) => sc.music.some((m) => m.kind === r.kind && m.id === r.id);
          const added = refs.filter((r) => !has(r));
          const alreadyIn = refs.filter(has).map((r) => r.id);
          sc.music.push(...added);
          return { added: added.map((r) => r.id), alreadyIn, moved: false, placeName };
        }
        return refuse("invalid", "Drop it on a playlist, a pad board or a scene. Up next is in the room's Now playing.", "place");
      });
    },
  };

  /* ---------- settings ---------- */
  const settingsNow = (): LyreSettings => cx.copy({ ...st().settings, ...computer });
  const settings: Methods["settings"] = {
    async get() {
      return settingsNow();
    },
    async setCrossfade(crossfade) {
      return write(() => (crossfade.ms === 0 ? "Cut between tracks" : `Crossfade between tracks ${crossfade.ms / 1000} s`), ["settings"], () => {
        const problem = crossfade ? checkCrossfade(crossfade) : "Choose a crossfade.";
        if (problem) refuse("invalid", problem, "crossfade");
        st().settings.crossfade = { ms: crossfade.ms, curve: crossfade.curve };
        return settingsNow();
      });
    },
    async setShortcut(action, key) {
      const name = SHORTCUT_ACTIONS.find((a) => a.id === action)?.name ?? "";
      return write(`The key for ${name}`, ["settings"], () => {
        if (!(SHORTCUT_IDS as readonly string[]).includes(action)) refuse("invalid", "Lyre has no such action.", "action");
        const own = SHORTCUT_ACTIONS.find((a) => a.id === action)?.key as string;
        const named = key === null ? own : normaliseKey(key);
        if (!named) refuse("invalid", "Lyre cannot listen to that key. Press a letter, a number, F1 to F12 or a named key, with Ctrl, Alt or Shift if you like.", "key");
        const map = st().settings.shortcuts;
        const taken = shortcutUsing(map, named, action);
        if (taken) refuse("invalid", `${named} is already ${SHORTCUT_ACTIONS.find((a) => a.id === taken)?.name}. Give that one another key first.`, "key");
        if (named === own) delete map[action];
        else map[action] = named;
        return settingsNow();
      });
    },
    async resetShortcuts() {
      return write("Put back Lyre's keys", ["settings"], () => {
        st().settings.shortcuts = {};
        return settingsNow();
      });
    },
    async setNextSceneGuard(on) {
      return write(on ? "Ignore a second Next scene" : "Count every Next scene", ["settings"], () => {
        if (typeof on !== "boolean") refuse("invalid", "The guard is on or off.", "on");
        st().settings.nextSceneGuard = on;
        return settingsNow();
      });
    },
    async setComputer(patch: ComputerSettingsPatch) {
      const problem = !patch || typeof patch !== "object" ? "Choose a setting." : checkDisplay(patch.display ?? {}) ?? checkDevices(patch.devices ?? {}) ?? (patch.globalKeys !== undefined && typeof patch.globalKeys !== "boolean" ? "Choose on or off." : null);
      if (problem) return { ok: false, refusal: { code: "invalid", message: problem } };
      Object.assign(computer.display, { ...DEFAULT_DISPLAY, ...computer.display, ...(patch.display ?? {}) });
      Object.assign(computer.devices, { ...DEFAULT_DEVICES, ...computer.devices, ...(patch.devices ?? {}) });
      if (patch.globalKeys !== undefined) computer.globalKeys = patch.globalKeys;
      cx.changedOutsideHistory(["settings"]);
      return { ok: true, value: settingsNow(), changed: ["settings"], undoLabel: cx.undoLabel() };
    },
  };

  return { library, tags, folders, playlists, boards, sessions, settings };
}
