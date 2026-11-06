/**
 * Every LyreApi method checks the shape of its arguments in the library (security review 5): a malformed call is
 * refused ("invalid", plain words) for a write, and fails in plain words for a read, before the library acts on it.
 * The calls below are the review's probes; the contract tests (libraryApi.test.ts) show well-formed calls pass.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { LYRE_API_METHODS } from "../../common/lyre/api";
import { prototypeSeed } from "../../common/lyre/seed";
import { openLibrary } from "../data";
import { ARGUMENT_SHAPES, NOT_UNDERSTOOD, argumentProblem } from "./argChecks";
import { createLibraryApi } from "./libraryApi";
import { seedLibrary } from "./seedLibrary";

const host = { chooseFiles: async (): Promise<null> => null, chooseFolder: async (): Promise<null> => null, showItemInFolder: (): void => undefined, chooseSaveFile: async (): Promise<null> => null, chooseLyreFile: async (): Promise<null> => null };
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

async function api() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-args-"));
  const library = openLibrary({ folder: path.join(dir, "library") });
  await seedLibrary(library, prototypeSeed());
  const lyre = createLibraryApi(library, host);
  cleanups.push(() => {
    lyre.stopBackgroundWork();
    library.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { lyre, library, dir };
}

/** Answers within a second, or "still waiting" (the review's string-as-paths import walked the disk). */
const within = <T>(promise: Promise<T>) =>
  Promise.race([promise.catch((error: Error) => ({ fault: error.message })), new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1000))]);

describe("LyreApi argument shapes (security review 5)", () => {
  it("has a shape for every method", () => {
    for (const [area, methods] of Object.entries(LYRE_API_METHODS)) {
      for (const method of methods) expect(ARGUMENT_SHAPES[area]?.[method], `${area}.${method}`).toBeDefined();
    }
  });

  it("refuses the review's malformed writes in plain words, without acting on them", async () => {
    const { lyre } = await api();
    const refusedInvalid = { ok: false, refusal: { code: "invalid", message: NOT_UNDERSTOOD } };
    const calls: [string, () => Promise<unknown>][] = [
      ["paths as one text", () => lyre.import.start({ from: "paths", paths: "/x" } as never)],
      ["a relative path", () => lyre.import.start({ from: "paths", paths: ["relative-dir"] })],
      ["tag a number", () => lyre.tags.tagTracks({ trackIds: 5 } as never)],
      ["watch a number", () => lyre.import.watchFolder({ from: "path", path: 7 } as never)],
      ["a Map for a patch", () => lyre.library.updateTrack("t1", new Map([["title", "x"]]) as never)],
      ["one argument too many", () => (lyre.boards.rename as (...a: unknown[]) => Promise<unknown>)("combat", "Fight", "extra")],
      ["an unknown source", () => lyre.import.start({ from: "the-internet" } as never)],
    ];
    for (const [name, call] of calls) expect(await within(call()), name).toMatchObject(refusedInvalid);
  });

  it("fails malformed reads in plain words", async () => {
    const { lyre } = await api();
    expect(await within(lyre.library.search(null as never))).toEqual({ fault: NOT_UNDERSTOOD });
    expect(await within(lyre.library.peaksOf({} as never))).toEqual({ fault: NOT_UNDERSTOOD });
  });

  it("refuses to watch a drive, the whole disk, a system or profile folder, or a network share", async () => {
    const { lyre } = await api();
    for (const folder of ["/", os.homedir(), "/etc", "//server/share/Music"]) {
      const answer = await lyre.import.watchFolder({ from: "path", path: folder });
      expect(answer, folder).toMatchObject({ ok: false, refusal: { code: "invalid" } });
    }
    expect((await lyre.library.listFolders()).map((f) => f.path)).not.toContain("/");
  });

  it("names the argument at fault", () => {
    expect(argumentProblem("import", "start", [{ from: "paths", paths: ["ok/relative"] }])).toMatch(/paths/);
    expect(argumentProblem("library", "listTracks", [])).toBeNull();
    expect(argumentProblem("library", "search", [{ text: "x", limit: 5 }])).toBeNull();
    expect(argumentProblem("library", "search", [{ text: "x", limit: 1.5 }])).toMatch(/limit/);
    expect(argumentProblem("boards", "movePad", ["b", "p", "spare"])).toBeNull();
    expect(argumentProblem("boards", "movePad", ["b", "p", { slot: 2 }])).toBeNull();
    expect(argumentProblem("boards", "movePad", ["b", "p", { slot: "2" }])).toBe("args[2]");
  });

  it("checks the shapes of the round 5 calls (w4-contracts)", () => {
    const scene = { kind: "scene", campaignId: "c", sessionId: "s", sceneId: "x" };
    expect(argumentProblem("playlists", "setPlayOrder", ["p", scene, { shuffle: true, repeat: "all" }])).toBeNull();
    expect(argumentProblem("playlists", "setPlayOrder", ["p", null, { shuffle: true, repeat: "all" }])).toBeNull();
    expect(argumentProblem("playlists", "setPlayOrder", ["p", { kind: "room" }, { shuffle: true, repeat: "all" }])).toBe("args[1].kind");
    expect(argumentProblem("playlists", "setPlayOrder", ["p", null, { shuffle: "yes", repeat: "all" }])).toBe("args[2].shuffle");
    expect(argumentProblem("playlists", "clearPlayOrder", ["p", { kind: "campaign" }])).toBe("args[1].campaignId");
    expect(argumentProblem("library", "setShape", ["t", null])).toBeNull();
    expect(argumentProblem("library", "setShape", ["t", 3])).toBe("args[1]");
    expect(argumentProblem("library", "search", [{ text: "", shapes: "builds" }])).toBe("args[0].shapes");
    expect(argumentProblem("sessions", "setTrackName", [{ campaignId: "c", sessionId: "s", sceneId: "x" }, "t", ["x"]])).toBe("args[2]");
    expect(argumentProblem("campaigns", "setOnHand", [{ campaignId: "c" }, "tracks", ["t"]])).toBeNull();
    expect(argumentProblem("campaigns", "setUses", [{ kind: "track", id: "t" }, []])).toBeNull();
    expect(argumentProblem("profiles", "set", ["t", { kind: "session", campaignId: "c", sessionId: "s" }, {}])).toBeNull();
    expect(argumentProblem("transfer", "estimate", [{ kind: "campaign" }])).toBe("args[0].campaignId");
    expect(argumentProblem("transfer", "save", [{ scope: { kind: "library" }, includeAudio: false, path: "relative.lyre" }])).toBe("args[0].path");
    expect(argumentProblem("transfer", "open", [{ from: "the-internet" }])).toBe("args[0].from");
    expect(argumentProblem("transfer", "bringIn", ["f", { all: "everything" }])).toBe("args[1].all");
  });
});
