import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotTokenStore, canEncrypt, wantsFakeKeyring, type SafeStorageLike } from "./botTokenStore";
import { fakeKeyring } from "./testing/fakeKeyring";

const TOKEN = "fake-token-ABCDEF.0123456789";

/** Reversible stand-in for safeStorage: not plain text, and marked. */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text).toString("hex")}`),
    decryptString: (data) => Buffer.from(data.toString().slice(4), "hex").toString(),
    ...overrides,
  };
}

let folder: string;
let file: string;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "bot-store-"));
  file = BotTokenStore.fileIn(folder);
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Everything written in the folder, as text. */
function allWritten(): string {
  return fs
    .readdirSync(folder)
    .map((name) => fs.readFileSync(path.join(folder, name), "utf8"))
    .join("\n");
}

describe("BotTokenStore (SEC-5)", () => {
  it("saves a token encrypted and reads it back after a restart", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    expect(store.setToken(id, TOKEN)).toBe(true);
    expect(allWritten()).not.toContain(TOKEN);

    const reopened = new BotTokenStore(file, fakeSafeStorage());
    expect(reopened.list()).toEqual([{ id, name: "Bot 1", hasToken: true, tokenRemembered: true, tokenEnd: "6789", applicationId: null }]);
    expect(reopened.token(id)).toBe(TOKEN);
  });

  it("answers false when the encrypted token could not be written to disk (CR51-1)", () => {
    // The data folder's place is taken by a file, so nothing can be saved there.
    const blocked = path.join(folder, "not-a-folder");
    fs.writeFileSync(blocked, "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new BotTokenStore(BotTokenStore.fileIn(blocked), fakeSafeStorage());
    const id = store.addBot();
    expect(store.setToken(id, TOKEN)).toBe(false);
    // It still works until Lyre closes.
    expect(store.token(id)).toBe(TOKEN);
  });

  it("keeps one token per bot", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const first = store.addBot();
    const second = store.addBot();
    store.setToken(first, "fake-one");
    store.setToken(second, "fake-two");
    expect(store.token(first)).toBe("fake-one");
    expect(store.token(second)).toBe("fake-two");
    expect(store.list().map((bot) => bot.name)).toEqual(["Bot 1", "Bot 2"]);
  });

  it("replaces and removes a token", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    store.setToken(id, "fake-old");
    store.setToken(id, "fake-new");
    expect(store.token(id)).toBe("fake-new");
    store.removeToken(id);
    expect(store.token(id)).toBeUndefined();
    expect(store.list()[0].hasToken).toBe(false);
    expect(allWritten()).not.toContain("enc:");
  });

  it("never lists a token, only whether there is one", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    store.setToken(id, TOKEN);
    expect(JSON.stringify(store.list())).not.toContain(TOKEN);
  });

  it("keeps the token in memory only when encryption is unavailable, and writes no token", () => {
    const store = new BotTokenStore(file, fakeSafeStorage({ isEncryptionAvailable: () => false }));
    const id = store.addBot();
    expect(store.setToken(id, TOKEN)).toBe(false);
    expect(store.token(id)).toBe(TOKEN);
    expect(store.list()[0]).toMatchObject({ hasToken: true, tokenRemembered: false });
    expect(allWritten()).not.toContain(TOKEN);

    const reopened = new BotTokenStore(file, fakeSafeStorage({ isEncryptionAvailable: () => false }));
    expect(reopened.list()[0]).toMatchObject({ hasToken: false });
  });

  it("treats Linux's basic_text fallback as no encryption (its key is public)", () => {
    expect(canEncrypt(fakeSafeStorage({ getSelectedStorageBackend: () => "basic_text" }))).toBe(false);
    expect(canEncrypt(fakeSafeStorage({ getSelectedStorageBackend: () => "gnome_libsecret" }))).toBe(true);
    expect(canEncrypt(fakeSafeStorage())).toBe(true);
  });

  it("removes a bot with its token", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    store.setToken(id, TOKEN);
    store.removeBot(id);
    expect(store.list()).toEqual([]);
    expect(store.token(id)).toBeUndefined();
  });

  it("names a new bot after the lowest free number", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const first = store.addBot();
    store.addBot();
    store.removeBot(first);
    store.addBot();
    expect(store.list().map((bot) => bot.name)).toEqual(["Bot 2", "Bot 1"]);
  });

  it("survives a damaged or foreign file", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fs.writeFileSync(file, "{ not json");
    expect(new BotTokenStore(file, fakeSafeStorage()).list()).toEqual([]);
    fs.writeFileSync(file, JSON.stringify({ bots: [{ id: "../../evil", name: "x" }, null] }));
    expect(new BotTokenStore(file, fakeSafeStorage()).list()).toEqual([]);
  });

  it("gives up on a token that cannot be decrypted here", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    store.setToken(id, TOKEN);
    const elsewhere = new BotTokenStore(
      file,
      fakeSafeStorage({
        decryptString: () => {
          throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
        },
      }),
    );
    expect(elsewhere.token(id)).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")(
    "saves through a new private file even when an old temporary file was left behind (WP1 review 11)",
    () => {
      const store = new BotTokenStore(file, fakeSafeStorage());
      const id = store.addBot();
      // A temporary file from an interrupted save, readable by everyone.
      fs.writeFileSync(`${file}.tmp`, "old", { mode: 0o644 });
      fs.chmodSync(`${file}.tmp`, 0o644);
      store.setToken(id, TOKEN);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    },
  );
});

describe("BotTokenStore: Settings in Lyre (OUT-8)", () => {
  it("keeps a bot's name and Application ID across restarts, and the last four characters of its token", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const id = store.addBot();
    store.setToken(id, TOKEN);
    expect(store.rename(id, "  Lyre Table  ")).toBe(true);
    store.setApplicationId(id, "123456789012345678");
    const again = new BotTokenStore(file, fakeSafeStorage());
    expect(again.list()).toEqual([{ id, name: "Lyre Table", hasToken: true, tokenRemembered: true, tokenEnd: "6789", applicationId: "123456789012345678" }]);
    expect(allWritten()).not.toContain(TOKEN);
    expect(allWritten()).not.toContain("6789\"");
    store.setApplicationId(id, null);
    expect(new BotTokenStore(file, fakeSafeStorage()).list()[0].applicationId).toBeNull();
    expect(store.rename(id, "   ")).toBe(false);
    expect(store.rename("bot-nope", "X")).toBe(false);
  });

  it("takes a bot out with its encrypted token and puts it back where it was (Remove's Undo)", () => {
    const store = new BotTokenStore(file, fakeSafeStorage());
    const a = store.addBot();
    const b = store.addBot();
    store.setToken(b, TOKEN);
    store.setApplicationId(b, "123456789012345678");
    const removed = store.takeOut(b)!;
    expect(store.list().map((x) => x.id)).toEqual([a]);
    expect(JSON.stringify(removed)).not.toContain(TOKEN);
    store.putBack(removed);
    expect(store.list().map((x) => x.id)).toEqual([a, b]);
    expect(store.token(b)).toBe(TOKEN);
    expect(new BotTokenStore(file, fakeSafeStorage()).list()[1]).toMatchObject({ id: b, hasToken: true, applicationId: "123456789012345678" });
    expect(store.takeOut("bot-nope")).toBeNull();
  });

  it("keeps a token for this session only where nothing can encrypt it, and still knows its last four characters", () => {
    const store = new BotTokenStore(file, fakeSafeStorage({ isEncryptionAvailable: () => false }));
    const id = store.addBot();
    store.setToken(id, TOKEN);
    expect(store.list()[0]).toMatchObject({ hasToken: true, tokenRemembered: false, tokenEnd: "6789" });
    const removed = store.takeOut(id)!;
    store.putBack(removed);
    expect(store.token(id)).toBe(TOKEN);
  });
});

describe("the test builds' fake keyring (CUE_DESK_FAKE_KEYRING)", () => {
  it("is used only in a test build that asks for it", () => {
    expect(wantsFakeKeyring({ CUE_DESK_FAKE_KEYRING: "1" }, true)).toBe(true);
    expect(wantsFakeKeyring({ CUE_DESK_FAKE_KEYRING: "1" }, false)).toBe(false);
    expect(wantsFakeKeyring({}, true)).toBe(false);
  });

  it("saves a token that comes back after a restart, never in plain text", () => {
    const store = new BotTokenStore(file, fakeKeyring);
    const id = store.addBot();
    expect(store.setToken(id, TOKEN)).toBe(true);
    expect(allWritten()).not.toContain(TOKEN);
    expect(new BotTokenStore(file, fakeKeyring).token(id)).toBe(TOKEN);
  });
});
