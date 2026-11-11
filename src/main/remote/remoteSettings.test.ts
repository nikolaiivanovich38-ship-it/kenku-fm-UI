import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REMOTE_CODE_PATTERN } from "./remoteCode";
import { DEFAULT_REMOTE_SETTINGS, RemoteSettingsStore, checkRemoteAddress, checkRemotePort } from "./remoteSettings";

/** safeStorage stand-in: "encrypts" by reversing and marking, so the file never holds the code as typed. */
function fakeSafeStorage(available = true, backend = "gnome_libsecret") {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text: string) => Buffer.from(`enc:${[...text].reverse().join("")}`),
    decryptString: (data: Buffer) => {
      const text = data.toString();
      if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
      return [...text.slice(4)].reverse().join("");
    },
  };
}

let folder: string;
let file: string;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-remote-"));
  file = RemoteSettingsStore.fileIn(folder);
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("remote-control settings (SEC-4)", () => {
  it("starts off, on this computer only (127.0.0.1), port 3333", () => {
    const store = new RemoteSettingsStore(file, fakeSafeStorage());
    expect(store.settings()).toEqual({ enabled: false, address: "127.0.0.1", port: 3333 });
    expect(DEFAULT_REMOTE_SETTINGS.address).toBe("127.0.0.1");
  });

  it("creates a secret code on first run and keeps it, encrypted, across restarts", () => {
    const first = new RemoteSettingsStore(file, fakeSafeStorage());
    const code = first.code();
    expect(code).toMatch(REMOTE_CODE_PATTERN);
    expect(first.codeRemembered).toBe(true);
    expect(fs.readFileSync(file, "utf8")).not.toContain(code);
    expect(fs.readFileSync(file, "utf8")).not.toContain(code.replace(/-/g, ""));
    expect(new RemoteSettingsStore(file, fakeSafeStorage()).code()).toBe(code);
  });

  it("keeps the code for this session only, never on disk, where it cannot be encrypted", () => {
    for (const safeStorage of [fakeSafeStorage(false), fakeSafeStorage(true, "basic_text")]) {
      const store = new RemoteSettingsStore(file, safeStorage);
      const code = store.code();
      store.update({ enabled: true });
      expect(store.codeRemembered).toBe(false);
      expect(fs.readFileSync(file, "utf8")).not.toContain(code.slice(0, 4) + "-");
      expect(new RemoteSettingsStore(file, safeStorage).code()).not.toBe(code);
    }
  });

  it("makes a new code when asked, and the old one stops working", () => {
    const store = new RemoteSettingsStore(file, fakeSafeStorage());
    const old = store.code();
    const fresh = store.newCode();
    expect(fresh).not.toBe(old);
    expect(store.code()).toBe(fresh);
    expect(new RemoteSettingsStore(file, fakeSafeStorage()).code()).toBe(fresh);
  });

  it("makes a new code when the saved one cannot be read (another computer or user account)", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: true, address: "127.0.0.1", port: 3333, encryptedCode: "bm9wZQ==" }));
    const store = new RemoteSettingsStore(file, fakeSafeStorage());
    expect(store.code()).toMatch(REMOTE_CODE_PATTERN);
    expect(store.settings().enabled).toBe(true);
  });

  it("replaces a code saved in the older 20-symbol form with a new 8-character one (lead decision, 7 Nov)", () => {
    const encrypted = fakeSafeStorage().encryptString("AB01-CD23-EF45-GH67-JK89").toString("base64");
    fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: false, address: "127.0.0.1", port: 3333, encryptedCode: encrypted }));
    const store = new RemoteSettingsStore(file, fakeSafeStorage());
    expect(store.code()).toMatch(REMOTE_CODE_PATTERN);
    expect(new RemoteSettingsStore(file, fakeSafeStorage()).code()).toBe(store.code());
  });

  it("saves on, off, address and port, and keeps them after a restart", () => {
    const store = new RemoteSettingsStore(file, fakeSafeStorage(), { ownAddresses: () => ["192.168.1.20"] });
    expect(store.update({ enabled: true, address: "192.168.1.20", port: 4000 })).toEqual({
      enabled: true,
      address: "192.168.1.20",
      port: 4000,
    });
    expect(new RemoteSettingsStore(file, fakeSafeStorage(), { ownAddresses: () => ["192.168.1.20"] }).settings()).toEqual({
      enabled: true,
      address: "192.168.1.20",
      port: 4000,
    });
  });

  it("CR-2: refuses every address (0.0.0.0, ::), an internet address and one this computer does not have, whoever asks", () => {
    const store = new RemoteSettingsStore(file, fakeSafeStorage(), { ownAddresses: () => ["192.168.1.20", "81.82.83.84"] });
    for (const address of ["0.0.0.0", "::", "8.8.8.8", "81.82.83.84", "192.168.1.99", "localhost"]) {
      expect(store.update({ enabled: true, address }), address).toEqual({ error: expect.any(String) });
    }
    expect(store.update({ address: "0.0.0.0" })).toEqual({ error: expect.stringMatching(/every address/) });
    expect(store.update({ address: "8.8.8.8" })).toEqual({ error: expect.stringMatching(/internet/) });
    expect(store.update({ address: "192.168.1.99" })).toEqual({ error: expect.stringMatching(/does not have the address 192\.168\.1\.99/) });
    expect(store.settings()).toEqual(DEFAULT_REMOTE_SETTINGS);
  });

  it("CR-2: a saved address that is not allowed is put back to 127.0.0.1; on and the port are kept", () => {
    for (const address of ["0.0.0.0", "::", "8.8.8.8", "localhost"]) {
      fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: true, address, port: 4000 }));
      expect(new RemoteSettingsStore(file, fakeSafeStorage()).settings(), address).toEqual({ enabled: true, address: "127.0.0.1", port: 4000 });
    }
  });

  it("CR-2: a saved home-network address is kept while the computer is off that network (the server checks it before listening)", () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: true, address: "192.168.1.20", port: 4000 }));
    expect(new RemoteSettingsStore(file, fakeSafeStorage(), { ownAddresses: () => [] }).settings().address).toBe("192.168.1.20");
  });

  it("refuses an address or port that cannot work, in plain words, and changes nothing", () => {
    const store = new RemoteSettingsStore(file, fakeSafeStorage());
    expect(store.update({ enabled: true, address: "my-computer" })).toEqual({ error: expect.stringMatching(/address in numbers/) });
    expect(store.update({ port: 80 })).toEqual({ error: expect.stringMatching(/1024 to 65535/) });
    expect(store.settings()).toEqual(DEFAULT_REMOTE_SETTINGS);
  });

  it("falls back to the defaults for a damaged or tampered file", () => {
    fs.writeFileSync(file, "{not json");
    expect(new RemoteSettingsStore(file, fakeSafeStorage()).settings()).toEqual(DEFAULT_REMOTE_SETTINGS);
    fs.writeFileSync(file, JSON.stringify({ version: 1, enabled: "yes", address: "evil.example", port: 1 }));
    expect(new RemoteSettingsStore(file, fakeSafeStorage()).settings()).toEqual(DEFAULT_REMOTE_SETTINGS);
  });

  it("writes the file readable by this user only", () => {
    new RemoteSettingsStore(file, fakeSafeStorage()).update({ enabled: true });
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o077).toBe(0);
    }
  });
});

describe("remote address and port checks (SEC-4)", () => {
  const own = ["192.168.1.20", "10.0.0.7", "172.16.0.1", "169.254.10.1", "fd00::5", "fe80::1", "81.82.83.84", "2001:db8::1"];

  it.each(["127.0.0.1", " 127.0.0.1 ", "192.168.1.20", "10.0.0.7", "172.16.0.1", "169.254.10.1", "fd00::5", "FE80::1"])(
    "accepts %s (this computer only, or this computer's own private address)",
    (address) => {
      expect(checkRemoteAddress(address, own)).toEqual({ address: address.trim().toLowerCase() });
    },
  );

  it.each(["0.0.0.0", "::", "0:0:0:0:0:0:0:0", "8.8.8.8", "81.82.83.84", "2001:db8::1", "::ffff:192.168.1.20", "192.168.1.99", "fd00::6", "localhost", "::1"])(
    "CR-2: refuses %s",
    (address) => {
      expect(checkRemoteAddress(address, own)).toHaveProperty("error");
    },
  );

  it.each(["", "my-computer", "attacker.example", "127.0.0.1:3333", "http://127.0.0.1", "999.1.1.1", "x".repeat(100)])(
    "refuses %s",
    (address) => {
      expect(checkRemoteAddress(address, own)).toHaveProperty("error");
    },
  );

  it("refuses a private address when it is not told this computer's addresses", () => {
    expect(checkRemoteAddress("192.168.1.20")).toHaveProperty("error");
  });

  it("accepts ports 1024 to 65535 as numbers or digits", () => {
    expect(checkRemotePort(3333)).toEqual({ port: 3333 });
    expect(checkRemotePort("4000")).toEqual({ port: 4000 });
    for (const bad of [0, 80, 1023, 65536, 3333.5, "33a", "", Number.NaN]) {
      expect(checkRemotePort(bad), String(bad)).toHaveProperty("error");
    }
  });
});
