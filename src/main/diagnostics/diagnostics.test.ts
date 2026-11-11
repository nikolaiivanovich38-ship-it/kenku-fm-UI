/** FND-9: Save diagnostics: what goes in the zip, what is taken out, and that nothing leaves the computer. */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import https from "https";
import net from "net";
import tls from "tls";
import dns from "dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openZip } from "../transfer/zip";
import { LogBuffer, captureConsole, isBlockedWarning, pageConsoleLine } from "./logBuffer";
import { scrubText, scrubValue } from "./scrub";
import { diagnosticsFileName, saveDiagnostics, type DiagnosticsSources } from "./diagnosticsZip";

// A made-up Discord token, built from parts so secret scanners do not take it for a real one.
const TOKEN = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GhIjKl", "abcdefghijklmnopqrstuvwxyz0123456789AB"].join(".");
const HOME = os.platform() === "win32" ? "C:\\Users\\nik" : "/home/nik";

let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-diag-"));
});
afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("scrubbing", () => {
  it("takes Discord tokens out of any text", () => {
    expect(scrubText(`Logging in with ${TOKEN} now`, { home: HOME })).toBe("Logging in with [token removed] now");
    expect(scrubText(`Bot ${TOKEN}`, { home: HOME })).not.toContain(TOKEN.slice(0, 20));
  });

  it("writes the home folder as ~, with either kind of slash and any case", () => {
    expect(scrubText("C:\\Users\\Nik\\Music\\a.mp3 and C:/Users/nik/Music", { home: "C:\\Users\\nik" })).toBe("~\\Music\\a.mp3 and ~/Music");
    expect(scrubText("/home/nik/Music/a.mp3", { home: "/home/nik" })).toBe("~/Music/a.mp3");
    expect(scrubText("/home/nikolai/x", { home: "/home/nik" })).toBe("/home/nikolai/x");
  });

  it("replaces every value whose name says it is secret, at any depth, and scrubs the rest", () => {
    const value = {
      token: "abc",
      bots: [{ botToken: "x", name: "Bot 1", status: "ready" }],
      remote: { password: "p", apiKey: "k", port: "3333", clientSecret: "s", credentials: { a: 1 }, authorization: "Bearer y" },
      folder: `${HOME}/Music`,
      note: TOKEN,
    };
    expect(scrubValue(value, { home: HOME })).toEqual({
      token: "[removed]",
      bots: [{ botToken: "[removed]", name: "Bot 1", status: "ready" }],
      remote: { password: "[removed]", apiKey: "[removed]", port: "3333", clientSecret: "[removed]", credentials: "[removed]", authorization: "[removed]" },
      folder: "~/Music",
      note: "[token removed]",
    });
  });
});

describe("the log", () => {
  it("keeps the last lines only, each with its time and level", () => {
    const log = new LogBuffer(3);
    for (let i = 1; i <= 5; i++) log.add("info", `line ${i}`, new Date(Date.UTC(2026, 10, 6, 12, 0, i)));
    expect(log.lines()).toEqual(["2026-11-06T12:00:03.000Z info line 3", "2026-11-06T12:00:04.000Z info line 4", "2026-11-06T12:00:05.000Z info line 5"]);
  });

  it("records what the main process writes to its console, and still writes it", () => {
    const log = new LogBuffer(10);
    const blocked = new LogBuffer(10);
    const written: string[] = [];
    const fake = { log: (...a: unknown[]) => written.push(a.join(" ")), info: (): void => undefined, warn: (...a: unknown[]) => written.push(a.join(" ")), error: (): void => undefined };
    captureConsole(fake, log, blocked);
    fake.log("Lyre started", 3);
    fake.warn("Blocked tab navigation: not an https address");
    expect(written).toEqual(["Lyre started 3", "Blocked tab navigation: not an https address"]);
    expect(log.lines().map((l) => l.replace(/^\S+ /, ""))).toEqual(["info Lyre started 3", "warn Blocked tab navigation: not an https address"]);
    expect(blocked.lines().map((l) => l.replace(/^\S+ /, ""))).toEqual(["warn Blocked tab navigation: not an https address"]);
  });

  it("knows a blocked-content warning when it sees one", () => {
    for (const line of [
      "Blocked popup from tab 3: too many popups",
      "Refused to open a file: outside its folder",
      "Ignored a LYRE_API_CALL message: unexpected arguments",
      "Refused to load the script 'https://x' because it violates the following Content Security Policy directive",
      "Denied the camera permission to https://example.com",
    ]) {
      expect(isBlockedWarning(line), line).toBe(true);
    }
    expect(isBlockedWarning("Lyre's library is ready")).toBe(false);
  });

  it("keeps an app page's warnings, but of a website only what was blocked", () => {
    expect(pageConsoleLine({ level: "warning", message: "Slow thing", page: "lyre-view" })).toEqual({ log: "page lyre-view: Slow thing", blocked: false });
    expect(pageConsoleLine({ level: "info", message: "hello", page: "lyre-view" })).toBeNull();
    expect(pageConsoleLine({ level: "error", message: "my bank balance is…", page: null })).toBeNull();
    expect(pageConsoleLine({ level: "error", message: "Refused to frame 'x' because it violates the following Content Security Policy directive", page: null })).toEqual({
      log: "website tab: Refused to frame 'x' because it violates the following Content Security Policy directive",
      blocked: true,
    });
  });
});

function sources(overrides: Partial<DiagnosticsSources> = {}): DiagnosticsSources {
  return {
    about: () => ({ lyre: "0.4.0", electron: "44.0.0", chrome: "142", os: "Windows_NT 10.0.26100", arch: "x64", language: "en-GB" }),
    log: () => [`2026-11-06T12:00:00.000Z info Library opened at ${HOME}\\AppData\\Roaming\\lyre`, `2026-11-06T12:00:01.000Z warn Logging in with ${TOKEN}`],
    blocked: () => ["2026-11-06T12:00:02.000Z warn Blocked tab navigation: not allowed"],
    settings: async () => ({ mainWindow: { remotePort: "3333", token: TOKEN, folder: `${HOME}\\Music` }, lyrePage: { theme: "campaign" } }),
    home: HOME,
    ...overrides,
  };
}

async function entriesOf(file: string): Promise<Record<string, string>> {
  const zip = await openZip(file);
  const out: Record<string, string> = {};
  for (const entry of zip.entries) out[entry.name] = (await zip.read(entry.name, 10_000_000)).toString("utf8");
  await zip.close();
  return out;
}

describe("the diagnostics zip", () => {
  it("is named after the date and time, with nothing Windows refuses in a name", () => {
    expect(diagnosticsFileName(new Date(2026, 10, 6, 14, 32))).toBe("Lyre diagnostics 2026-11-06 14-32.zip");
  });

  it("holds the version and system, the log, the settings, the blocked warnings and a README", async () => {
    const at = new Date(2026, 10, 6, 14, 32);
    const saved = await saveDiagnostics({ folder, sources: sources(), at });
    expect(saved).toBe(path.join(folder, "Lyre diagnostics 2026-11-06 14-32.zip"));
    const files = await entriesOf(saved);
    expect(Object.keys(files).sort()).toEqual(["README.txt", "about.json", "blocked.txt", "log.txt", "settings.json"]);
    expect(JSON.parse(files["about.json"])).toMatchObject({ lyre: "0.4.0", os: "Windows_NT 10.0.26100", arch: "x64" });
    expect(files["log.txt"]).toContain("Library opened at ~\\AppData\\Roaming\\lyre");
    expect(files["blocked.txt"]).toContain("Blocked tab navigation");
    expect(JSON.parse(files["settings.json"]).mainWindow.remotePort).toBe("3333");
    expect(files["README.txt"]).toMatch(/Nothing in this file was sent anywhere/);
  });

  it("never holds a bot token or the path to the user's home folder, in any file", async () => {
    const files = await entriesOf(await saveDiagnostics({ folder, sources: sources(), at: new Date() }));
    for (const [name, text] of Object.entries(files)) {
      expect(text, name).not.toContain(TOKEN);
      expect(text, name).not.toContain(TOKEN.split(".")[0]);
      expect(text.toLowerCase(), name).not.toContain(HOME.toLowerCase());
    }
  });

  it("does not overwrite an earlier file of the same minute", async () => {
    const at = new Date(2026, 10, 6, 14, 32);
    const first = await saveDiagnostics({ folder, sources: sources(), at });
    const second = await saveDiagnostics({ folder, sources: sources(), at });
    expect(path.basename(second)).toBe("Lyre diagnostics 2026-11-06 14-32 (2).zip");
    expect(fs.existsSync(first)).toBe(true);
  });

  it("still saves when the settings cannot be read, and says so in the file", async () => {
    const files = await entriesOf(await saveDiagnostics({ folder, sources: sources({ settings: async () => Promise.reject(new Error(`no window at ${HOME}`)) }), at: new Date() }));
    expect(JSON.parse(files["settings.json"])).toEqual({ unreadable: "no window at ~" });
  });

  it("sends nothing over the network while it saves", async () => {
    const calls: string[] = [];
    const spy = (name: string) => () => {
      calls.push(name);
      throw new Error(`${name} must not be used`);
    };
    vi.spyOn(http, "request").mockImplementation(spy("http.request"));
    vi.spyOn(https, "request").mockImplementation(spy("https.request"));
    vi.spyOn(net, "connect").mockImplementation(spy("net.connect"));
    vi.spyOn(net, "createConnection").mockImplementation(spy("net.createConnection"));
    vi.spyOn(tls, "connect").mockImplementation(spy("tls.connect"));
    vi.spyOn(dns, "lookup").mockImplementation(spy("dns.lookup"));
    const fetchSpy = vi.fn(spy("fetch"));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await saveDiagnostics({ folder, sources: sources(), at: new Date() });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls).toEqual([]);
  });

  it("has no network code at all: no module that could send it imports one", () => {
    const here = __dirname;
    for (const file of fs.readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = fs.readFileSync(path.join(here, file), "utf8");
      expect(text, file).not.toMatch(/from "(node:)?(http|https|net|tls|dns|dgram|http2)"|require\("(http|https|net)"\)|\bfetch\(|\bnet\.request\b|\bXMLHttpRequest\b/);
      expect(text, file).not.toMatch(/import\s*\{[^}]*\bnet\b[^}]*\}\s*from "electron"/);
    }
  });
});
