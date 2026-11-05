/**
 * The shape of every LyreApi method's arguments, checked in the library before it acts (security review 5). The
 * IPC guard checks the method's name and the call's size only; without this, a text where a list belongs was
 * walked letter by letter ("/" walked the whole disk), and a number where a list belongs was a fault.
 *
 * Shapes are checked here: kinds (text, whole numbers, lists, plain objects), lengths, full paths, and the
 * choices that pick a branch (`from`, `kind`). What a value means (a name that exists, a colour the board knows)
 * stays with the data layer, which refuses it in its own words. A write with a malformed argument is refused with
 * code "invalid"; a read fails; both in the same plain words, naming the argument at fault in `field`.
 */
import type { LyreApi, WriteResult } from "../../common/lyre/api";
import { LYRE_API_METHODS } from "../../common/lyre/api";
import { isAbsolutePath } from "../data/paths";

/** What the game master sees: the page sent something the library cannot take (a bug, or a page that is not Lyre's). */
export const NOT_UNDERSTOOD = "Lyre could not do that: the screen sent something the library does not understand. Close the Lyre tab, open it again and try once more.";

/** A check: null when `value` fits, else where it does not ("paths[2]"). */
type Check = (value: unknown, at: string) => string | null;

const MAX_ID = 200;
const MAX_TEXT = 20_000;
const MAX_PATH = 4_096;
/** Enough for a change to every track of a very large library. */
const MAX_LIST = 100_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const text =
  (max = MAX_TEXT): Check =>
  (value, at) =>
    typeof value === "string" && value.length <= max ? null : at;
const id: Check = (value, at) => (typeof value === "string" && value.length > 0 && value.length <= MAX_ID ? null : at);
const whole: Check = (value, at) => (Number.isSafeInteger(value) ? null : at);
const number: Check = (value, at) => (typeof value === "number" && Number.isFinite(value) ? null : at);
const bool: Check = (value, at) => (typeof value === "boolean" ? null : at);
/** A full path to a file or folder on this computer (no relative path, which would mean the process's own folder). */
const fullPath: Check = (value, at) => (typeof value === "string" && value.length <= MAX_PATH && !value.includes("\0") && isAbsolutePath(value) ? null : at);
const literal =
  (...values: string[]): Check =>
  (value, at) =>
    typeof value === "string" && values.includes(value) ? null : at;
const nullable =
  (check: Check): Check =>
  (value, at) =>
    value === null ? null : check(value, at);
const list =
  (check: Check, max = MAX_LIST): Check =>
  (value, at) => {
    if (!Array.isArray(value) || value.length > max) return at;
    for (let i = 0; i < value.length; i++) {
      const problem = check(value[i], `${at}[${i}]`);
      if (problem) return problem;
    }
    return null;
  };
/** A plain object; listed fields are checked when present ("name?" may be left out), others are left to the data layer. */
const object =
  (fields: Record<string, Check> = {}): Check =>
  (value, at) => {
    if (!isPlainObject(value)) return at;
    for (const [key, check] of Object.entries(fields)) {
      const optional = key.endsWith("?");
      const name = optional ? key.slice(0, -1) : key;
      if (!Object.prototype.hasOwnProperty.call(value, name)) {
        if (optional) continue;
        return `${at}.${name}`;
      }
      const field = value[name];
      if (optional && field === undefined) continue;
      const problem = check(field, `${at}.${name}`);
      if (problem) return problem;
    }
    return null;
  };
/** One of several object shapes, chosen by the text in `key`. */
const branch =
  (key: string, shapes: Record<string, Check>): Check =>
  (value, at) => {
    if (!isPlainObject(value) || typeof value[key] !== "string" || !Object.prototype.hasOwnProperty.call(shapes, value[key])) return `${at}.${key}`;
    return shapes[value[key] as string](value, at);
  };
const either =
  (...checks: Check[]): Check =>
  (value, at) =>
    checks.some((check) => check(value, at) === null) ? null : at;

/* ---------- shapes the methods share ---------- */

const tagRef = object({ group: text(MAX_ID), value: text(500) });
const soundRef = object({ kind: literal("track", "playlist"), id });
const sceneAddress = object({ campaignId: id, sessionId: id, sceneId: id });
const owner = object({ campaignId: id, "sessionId?": id });
const usePlace = object({ campaignId: id, "sessionId?": id, "sceneId?": id });
const rule = object({ conds: list(object(), 1_000), "energy?": list(number, 2), "leaveOutStings?": bool, "shapes?": list(text(MAX_ID), 20) });
const folderSource = branch("from", { "choose-folder": object(), path: object({ path: fullPath }) });
const profilePlace = branch("kind", {
  playlist: object({ playlistId: id }),
  scene: object({ campaignId: id, sessionId: id, sceneId: id }),
  session: object({ campaignId: id, sessionId: id }),
});
/** PLY-13: a place a play order applies in (a scene, a session list or a campaign list). */
const playPlace = branch("kind", {
  scene: object({ campaignId: id, sessionId: id, sceneId: id }),
  session: object({ campaignId: id, sessionId: id }),
  campaign: object({ campaignId: id }),
});
const playOrder = object({ shuffle: bool, repeat: text(MAX_ID) });
/** DAT-7: what a .lyre file holds. */
const transferScope = branch("kind", {
  library: object(),
  tags: object(),
  campaign: object({ campaignId: id }),
  session: object({ campaignId: id, sessionId: id }),
  scene: object({ campaignId: id, sessionId: id, sceneId: id }),
  playlist: object({ playlistId: id }),
  board: object({ boardId: id }),
});
const duplicateChoice = literal("skip", "merge", "keepBoth");
const padPatch = object({
  "label?": text(500),
  "icon?": text(MAX_ID),
  "color?": text(MAX_ID),
  "key?": text(MAX_ID),
  "mode?": text(MAX_ID),
  "volume?": number,
  "fadeOutMs?": number,
  "sound?": object({ "kind?": text(MAX_ID), "trackIds?": list(id, 10_000), "order?": text(MAX_ID), "tag?": nullable(tagRef) }),
});

interface Shape {
  /** One check per argument, in order; arguments after `required` may be left out. */
  args: Check[];
  required?: number;
  /** A write answers a refusal; a read fails. */
  write: boolean;
}
const read = (...args: Check[]): Shape => ({ args, write: false });
const write = (...args: Check[]): Shape => ({ args, write: true });
const withOptional = (shape: Shape, required: number): Shape => ({ ...shape, required });

export const ARGUMENT_SHAPES: Record<string, Record<string, Shape>> = {
  library: {
    listTracks: read(),
    search: read(object({ text: text(1_000), "lane?": text(MAX_ID), "limit?": whole, "shapes?": list(text(MAX_ID), 20) })),
    updateTrack: write(id, object({ "title?": text(), "notes?": text(), "energy?": nullable(number), "role?": nullable(text(MAX_ID)), "loop?": nullable(text(MAX_ID)), "kind?": text(MAX_ID) })),
    listFolders: read(),
    showInFolder: write(id),
    peaksOf: read(id),
    setShape: write(id, nullable(text(MAX_ID))),
  },
  tags: {
    listGroups: read(),
    tagTracks: write(object({ trackIds: list(id), "add?": list(tagRef, 1_000), "remove?": list(tagRef, 1_000) })),
  },
  playlists: {
    list: read(),
    tracks: read(id),
    containing: read(id),
    create: write(
      branch("kind", {
        manual: object({ name: text(500), lane: text(MAX_ID), "notes?": text(), "trackIds?": list(id) }),
        dynamic: object({ name: text(500), lane: text(MAX_ID), "notes?": text(), "rule?": rule }),
      }),
    ),
    update: write(id, object({ "name?": text(500), "notes?": text(), "rule?": rule })),
    copyAsManual: write(id),
    delete: write(id),
    addTracks: withOptional(write(id, list(id), whole), 2),
    removeTrack: write(id, id),
    moveTrack: write(id, id, whole),
    playOrders: read(),
    setPlayOrder: write(id, nullable(playPlace), playOrder),
    clearPlayOrder: write(id, nullable(playPlace)),
  },
  boards: {
    list: read(),
    create: write(object({ name: text(500), cols: whole, rows: whole })),
    rename: write(id, text(500)),
    resize: write(id, whole, whole),
    duplicate: write(id),
    delete: write(id),
    addPad: write(id, whole),
    updatePad: write(id, id, padPatch),
    duplicatePad: write(id, id),
    movePad: write(id, id, either(literal("spare"), object({ slot: whole }))),
    putAllBack: write(id),
    deletePad: write(id, id),
  },
  campaigns: {
    list: read(),
    get: read(id),
    create: write(object({ name: text(500), "system?": text(500), "theme?": text(MAX_ID), "description?": text(), "obsidian?": object({ "vault?": text(MAX_PATH), "note?": text(MAX_PATH), "sessionsFolder?": text(MAX_PATH) }) })),
    update: write(id, object({ "name?": text(500), "system?": text(500), "theme?": text(MAX_ID), "description?": text(), "notes?": text(), "obsidian?": object({ "vault?": text(MAX_PATH), "note?": text(MAX_PATH), "sessionsFolder?": text(MAX_PATH) }) })),
    setOnHand: write(owner, literal("playlists", "boards", "tracks"), list(id, 10_000)),
    usesOf: read(object({ kind: literal("playlist", "board", "track"), id })),
    setUses: write(object({ kind: literal("playlist", "board", "track"), id }), list(usePlace, 10_000)),
  },
  sessions: {
    create: write(id),
    update: write(id, id, object({ "name?": text(500), "date?": nullable(text(MAX_ID)), "status?": text(MAX_ID), "noteLink?": text(MAX_PATH) })),
    move: write(id, id, whole),
    createScene: withOptional(write(id, id, id), 2),
    updateScene: write(sceneAddress, object({ "name?": text(500), "startsWhen?": text(), "notes?": text(), "noteLink?": text(MAX_PATH) })),
    moveScene: write(sceneAddress, whole),
    duplicateScene: write(sceneAddress),
    deleteScene: write(sceneAddress),
    setSceneMusic: write(sceneAddress, list(soundRef, 10_000)),
    setSceneAmbience: write(sceneAddress, nullable(soundRef)),
    setSceneBoards: write(sceneAddress, list(id, 1_000)),
    setTrackName: write(sceneAddress, id, text(1_000)),
  },
  profiles: {
    overrides: read(),
    set: write(id, nullable(profilePlace), object()),
    clear: write(id, profilePlace),
  },
  import: {
    start: write(branch("from", { "choose-files": object(), "choose-folder": object(), paths: object({ paths: list(fullPath) }) })),
    watchFolder: write(folderSource),
    findMissing: read(),
    planRelink: write(folderSource),
    applyRelink: write(list(object({ trackId: id, to: fullPath }))),
  },
  transfer: {
    estimate: read(transferScope),
    save: write(object({ scope: transferScope, includeAudio: bool, "path?": fullPath })),
    open: write(branch("from", { "choose-file": object(), path: object({ path: fullPath }) })),
    bringIn: write(id, object({ "each?": object(), "all?": duplicateChoice })),
    movedReport: read(),
  },
  history: {
    state: read(),
    undo: write(),
    redo: write(),
  },
};

/** Where `args` do not fit the method's shape ("args[0].paths"), or null when they do. */
export function argumentProblem(area: string, method: string, args: unknown[]): string | null {
  const shape = Object.prototype.hasOwnProperty.call(ARGUMENT_SHAPES, area) ? ARGUMENT_SHAPES[area][method] : undefined;
  if (!shape || !Object.prototype.hasOwnProperty.call(ARGUMENT_SHAPES[area], method)) return "method";
  const required = shape.required ?? shape.args.length;
  if (!Array.isArray(args) || args.length > shape.args.length) return "args";
  // Arguments left out may also arrive as undefined (a call through the page's preload keeps the list's length).
  const given = args.length;
  if (given < required) return `args[${given}]`;
  for (let i = 0; i < shape.args.length; i++) {
    if (i >= required && (i >= given || args[i] === undefined)) continue;
    const problem = shape.args[i](args[i], `args[${i}]`);
    if (problem) return problem;
  }
  return null;
}

/**
 * `api` with every method's arguments checked first (security review 5). A malformed write answers
 * `{ ok: false, refusal: { code: "invalid", message: NOT_UNDERSTOOD, field } }`; a malformed read rejects with
 * NOT_UNDERSTOOD. Everything else on `api` (subscribe, stopBackgroundWork) is passed on as it is.
 */
export function withCheckedArguments<T extends LyreApi>(api: T, log?: (message: string) => void): T {
  const checked: Record<string, unknown> = { ...(api as unknown as Record<string, unknown>) };
  for (const [area, methods] of Object.entries(LYRE_API_METHODS)) {
    const calls = (api as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[area];
    const wrapped: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const method of methods as readonly string[]) {
      const shape = ARGUMENT_SHAPES[area][method];
      wrapped[method] = async (...args: unknown[]) => {
        const problem = argumentProblem(area, method, args);
        if (problem) {
          log?.(`Refused ${area}.${method}: ${problem} does not fit`);
          if (shape.write) return { ok: false, refusal: { code: "invalid", message: NOT_UNDERSTOOD, field: problem } } satisfies WriteResult;
          throw new Error(NOT_UNDERSTOOD);
        }
        return calls[method](...args);
      };
    }
    checked[area] = wrapped;
  }
  return checked as T;
}
