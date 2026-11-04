import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotTokenStore, canEncrypt, type SafeStorageLike } from "./botTokenStore";

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
    expect(reopened.list()).toEqual([{ id, name: "Bot 1", hasToken: true, tokenRemembered: true }]);
    expect(reopened.token(id)).toBe(TOKEN);
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
