import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markTokenNoteSeen, moveOldWindowDataOnce, parseOldWindowData, readOldWindowRecord, withoutPlainToken, type OldWindowMoveDeps } from "./oldWindowMove";

/** persist:root as redux-persist wrote it: every part is itself a JSON string. */
function persistRoot(settings: Record<string, unknown>, version = 7, bookmarks?: unknown): string {
  return JSON.stringify({
    settings: JSON.stringify(settings),
    ...(bookmarks === undefined ? {} : { bookmarks: JSON.stringify(bookmarks) }),
    _persist: JSON.stringify({ version, rehydrated: true }),
  });
}

/** Bookmarks as the old window kept them since UX-10 (version 5): folders, and the order to show them in. */
const BOOKMARKS_V5 = {
  bookmarks: {
    byId: {
      b2: { id: "b2", url: "https://tabletopaudio.com/", title: "Tabletop Audio", icon: "x", folderId: "f1" },
      b1: { id: "b1", url: "https://www.youtube.com/", title: "YouTube", icon: "y" },
      b3: { id: "b3", url: "https://example.com/no-title", title: "" },
      b4: { id: "b4", url: 42, title: "Broken" },
    },
    allIds: ["b1", "b2", "b3", "b4"],
  },
  folders: { byId: { f1: { id: "f1", title: "Ambience sites", open: true } }, allIds: ["f1"] },
  collapsed: false,
};

describe("parseOldWindowData (FND-16)", () => {
  it("reads Sound to Discord from the old main window's settings", () => {
    expect(parseOldWindowData(persistRoot({ streamingMode: "lowLatency" })).streamingMode).toBe("lowLatency");
    expect(parseOldWindowData(persistRoot({ streamingMode: "performance" })).streamingMode).toBe("performance");
  });

  it("finds nothing in an empty, missing or damaged value", () => {
    for (const raw of [null, undefined, "", "{not json", JSON.stringify({ settings: "{not json" }), persistRoot({ streamingMode: "fast" })]) {
      expect(parseOldWindowData(raw)).toEqual({ streamingMode: null, token: null, bookmarks: [] });
    }
  });

  it("finds a bot token Kenku FM kept in plain text (the old window's migration 6 had not run)", () => {
    expect(parseOldWindowData(persistRoot({ discordToken: "  MTIz.abc.def  " }, 4)).token).toBe("MTIz.abc.def");
    expect(parseOldWindowData(persistRoot({ discordToken: "   " }, 4)).token).toBeNull();
    expect(parseOldWindowData(persistRoot({ legacyTokenNotice: true }, 7)).token).toBeNull();
  });

  it("takes only a value shaped like a bot token, as the old channel did (CR51-6)", () => {
    expect(parseOldWindowData(persistRoot({ discordToken: "not a token" }, 4)).token).toBeNull();
    expect(parseOldWindowData(persistRoot({ discordToken: `${"a".repeat(5_000_000)}.b.c` }, 4)).token).toBeNull();
    expect(parseOldWindowData(persistRoot({ discordToken: 42 }, 4)).token).toBeNull();
  });

  it("lists the bookmarks in the old window's order, with their folder, leaving out any without an address", () => {
    expect(parseOldWindowData(persistRoot({}, 7, BOOKMARKS_V5)).bookmarks).toEqual([
      { title: "YouTube", url: "https://www.youtube.com/" },
      { title: "Tabletop Audio", url: "https://tabletopaudio.com/", folder: "Ambience sites" },
      { title: "https://example.com/no-title", url: "https://example.com/no-title" },
    ]);
  });

  it("keeps each title to one line", () => {
    const marks = { bookmarks: { byId: { a: { id: "a", url: "https://a.example/", title: "Two\nlines\u0000 here" } }, allIds: ["a"] } };
    expect(parseOldWindowData(persistRoot({}, 7, marks)).bookmarks).toEqual([{ title: "Two lines here", url: "https://a.example/" }]);
  });

  it("reads Kenku FM's bookmarks too (before folders)", () => {
    const kenku = { bookmarks: { byId: { a: { id: "a", url: "https://www.youtube.com/", title: "YouTube" } }, allIds: ["a"] } };
    expect(parseOldWindowData(persistRoot({}, 4, kenku)).bookmarks).toEqual([{ title: "YouTube", url: "https://www.youtube.com/" }]);
  });
});

describe("withoutPlainToken (CR51-1)", () => {
  it("takes the token, and the old Multiple Outputs switch, out of the stored settings and leaves the rest", () => {
    const raw = persistRoot({ discordToken: "MTIz.abc.def", multipleOutputsEnabled: true, streamingMode: "lowLatency" }, 4, BOOKMARKS_V5);
    const next = withoutPlainToken(raw) as string;
    expect(next).not.toContain("MTIz");
    const root = JSON.parse(next);
    expect(JSON.parse(root.settings)).toEqual({ streamingMode: "lowLatency" });
    expect(JSON.parse(root.bookmarks)).toEqual(BOOKMARKS_V5);
    expect(JSON.parse(root._persist)).toEqual({ version: 4, rehydrated: true });
  });

  it("answers null when there is nothing to take out", () => {
    for (const raw of [null, "", "{not json", JSON.stringify({ settings: "{not json" }), persistRoot({ streamingMode: "performance" })]) {
      expect(withoutPlainToken(raw)).toBeNull();
    }
  });
});

describe("moveOldWindowDataOnce (FND-16)", () => {
  let dir: string;
  let deps: OldWindowMoveDeps & {
    setStreamingMode: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    importToken: ReturnType<typeof vi.fn>;
    forgetPlainToken: ReturnType<typeof vi.fn>;
  };
  let hasMode: boolean;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-old-window-"));
    hasMode = false;
    deps = {
      recordFile: path.join(dir, "old-window.json"),
      read: vi.fn(async () => persistRoot({ streamingMode: "lowLatency" })),
      hasStreamingMode: () => hasMode,
      setStreamingMode: vi.fn(async () => true),
      importToken: vi.fn((_token: string) => "saved" as const),
      forgetPlainToken: vi.fn(async (_before: string, _after: string) => true),
      log: () => undefined,
      now: () => 1234,
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("copies the old window's Sound to Discord into this computer's settings, once", async () => {
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).toHaveBeenCalledWith("lowLatency");
    expect(JSON.parse(fs.readFileSync(deps.recordFile, "utf8"))).toMatchObject({ movedAt: 1234 });
    deps.setStreamingMode.mockClear();
    deps.read.mockClear();
    await moveOldWindowDataOnce(deps);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
  });

  it("keeps a Sound to Discord this computer already has", async () => {
    hasMode = true;
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });

  it("records the move when there was no old window (a new install), so it never reads again", async () => {
    deps.read.mockResolvedValue(null);
    await moveOldWindowDataOnce(deps);
    expect(deps.setStreamingMode).not.toHaveBeenCalled();
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });

  it("tries again next start when the page could not be read or the setting not saved", async () => {
    deps.read.mockRejectedValueOnce(new Error("page gone"));
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    deps.setStreamingMode.mockResolvedValueOnce(false);
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    await moveOldWindowDataOnce(deps);
    expect(fs.existsSync(deps.recordFile)).toBe(true);
  });

  it("hands a plain Kenku FM token to the main process to keep encrypted, and records it for the note in Settings", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def", streamingMode: "performance" }, 4, BOOKMARKS_V5));
    const record = await moveOldWindowDataOnce(deps);
    expect(deps.importToken).toHaveBeenCalledWith("MTIz.abc.def");
    expect(record).toMatchObject({ tokenMoved: true, tokenNoteSeen: false });
    expect(record?.bookmarks.map((b) => b.title)).toEqual(["YouTube", "Tabletop Audio", "https://example.com/no-title"]);
    // The record never holds the token itself.
    expect(fs.readFileSync(deps.recordFile, "utf8")).not.toContain("MTIz");
    expect(readOldWindowRecord(deps.recordFile)).toEqual(record);
  });

  it("takes the plain token out of the old storage once it is saved encrypted, keeping the rest (CR51-1)", async () => {
    const raw = persistRoot({ discordToken: "MTIz.abc.def", streamingMode: "performance" }, 4, BOOKMARKS_V5);
    deps.read.mockResolvedValue(raw);
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: true });
    expect(deps.forgetPlainToken).toHaveBeenCalledWith(raw, withoutPlainToken(raw));
    expect(deps.importToken.mock.invocationCallOrder[0]).toBeLessThan(deps.forgetPlainToken.mock.invocationCallOrder[0]);
  });

  it("keeps the plain token, records nothing and tries again when the encrypted copy could not be written (CR51-1)", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def" }, 4));
    deps.importToken.mockReturnValueOnce("not-saved");
    expect(await moveOldWindowDataOnce(deps)).toBeNull();
    expect(deps.forgetPlainToken).not.toHaveBeenCalled();
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    // Next start: saved this time, so the plain copy goes.
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: true });
    expect(deps.forgetPlainToken).toHaveBeenCalledTimes(1);
  });

  it("tries again next start when the plain token could not be taken out (CR51-1)", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def" }, 4));
    deps.forgetPlainToken.mockResolvedValueOnce(false);
    expect(await moveOldWindowDataOnce(deps)).toBeNull();
    expect(fs.existsSync(deps.recordFile)).toBe(false);
    deps.forgetPlainToken.mockRejectedValueOnce(new Error("page gone"));
    expect(await moveOldWindowDataOnce(deps)).toBeNull();
    expect(fs.existsSync(deps.recordFile)).toBe(false);
  });

  it("leaves the plain token where this computer cannot keep tokens encrypted, and records the move (CR51-1)", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def" }, 4));
    deps.importToken.mockReturnValueOnce("session-only");
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: true });
    expect(deps.forgetPlainToken).not.toHaveBeenCalled();
  });

  it("records no moved token when the first bot kept its own, and still takes the plain one out (CR51-6)", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def" }, 4));
    deps.importToken.mockReturnValueOnce("kept-own");
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: false });
    expect(deps.forgetPlainToken).toHaveBeenCalledTimes(1);
  });

  it("hands over nothing that is not shaped like a token, and leaves it where it is (CR51-6)", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "damaged value" }, 4));
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: false });
    expect(deps.importToken).not.toHaveBeenCalled();
    expect(deps.forgetPlainToken).not.toHaveBeenCalled();
  });

  it("remembers that the note about the moved token was read", async () => {
    deps.read.mockResolvedValue(persistRoot({ discordToken: "MTIz.abc.def" }, 4));
    await moveOldWindowDataOnce(deps);
    await markTokenNoteSeen(deps.recordFile);
    expect(readOldWindowRecord(deps.recordFile)).toMatchObject({ tokenMoved: true, tokenNoteSeen: true });
  });

  it("records no token when there was none", async () => {
    expect(await moveOldWindowDataOnce(deps)).toMatchObject({ tokenMoved: false, bookmarks: [] });
    expect(deps.importToken).not.toHaveBeenCalled();
  });
});
