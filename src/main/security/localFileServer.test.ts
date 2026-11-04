import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_FILE_CSP,
  LOCAL_FILE_SCHEME,
  LocalFileServer,
  contentTypeOf,
  isSameLocalFolder,
  localFileResponse,
  parseRange,
  type FileSystemLike,
} from "./localFileServer";

let base: string;
let folder: string;
let server: LocalFileServer;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "local-file-server-")));
  folder = path.join(base, "maps");
  fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
  fs.writeFileSync(path.join(base, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(folder, "map.html"), "<title>Map</title>");
  fs.writeFileSync(path.join(folder, "sound file.mp3"), "0123456789");
  fs.writeFileSync(path.join(folder, "sub", "deep.txt"), "deep");
  fs.symlinkSync(path.join(base, "secret.txt"), path.join(folder, "escape.txt"));
  fs.symlinkSync(base, path.join(folder, "parent-link"));
  server = new LocalFileServer();
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("LocalFileServer: addresses (WP1 review 1)", () => {
  it("gives a file an address of its own scheme, one host per folder", () => {
    const address = server.addressOf(path.join(folder, "map.html"));
    expect(address).toMatch(new RegExp(`^${LOCAL_FILE_SCHEME}://[0-9a-f]{32}/map\\.html$`));
    const other = server.addressOf(path.join(folder, "sub", "deep.txt"));
    expect(new URL(other).host).not.toBe(new URL(address).host);
    // The same folder always gets the same host, so a page's own storage survives a restart.
    expect(new LocalFileServer().addressOf(path.join(folder, "map.html"))).toBe(address);
  });

  it("keeps a #section and ?query of the address the user opened", () => {
    expect(server.addressOf(path.join(folder, "map.html"), "?room=3#legend")).toMatch(/\/map\.html\?room=3#legend$/);
  });

  it("turns its own address back into the file's address for the address bar", () => {
    const address = server.addressOf(path.join(folder, "sound file.mp3"));
    expect(server.toFileAddress(`${address}#t=3`)).toBe(`${pathToFileURL(path.join(folder, "sound file.mp3")).href}#t=3`);
    expect(server.toFileAddress("https://example.com/")).toBeUndefined();
    expect(server.toFileAddress(`${LOCAL_FILE_SCHEME}://0123456789abcdef0123456789abcdef/map.html`)).toBeUndefined();
  });

  it("shows Windows paths as Windows file addresses", () => {
    const windowsFs: FileSystemLike = { realpath: (p) => p, isFile: () => true };
    const windows = new LocalFileServer({ pathApi: path.win32, fileSystem: windowsFs, windowsPaths: true });
    const address = windows.addressOf("C:\\Maps\\Dungeon level 1.html");
    expect(windows.toFileAddress(address)).toBe("file:///C:/Maps/Dungeon%20level%201.html");
    expect(windows.resolve(address)).toBe("C:\\Maps\\Dungeon level 1.html");
    // An alternate data stream ("file.txt:hidden") is a different file on Windows.
    expect(windows.resolve(address.replace(/[^/]+$/, "notes.txt%3Ahidden"))).toBeUndefined();
  });
});

describe("LocalFileServer: what a page may read (WP1 review 1)", () => {
  let root: string;
  beforeEach(() => {
    root = server.addressOf(path.join(folder, "map.html")).replace(/map\.html$/, "");
  });

  it("serves files in the approved file's folder and its subfolders", () => {
    expect(server.resolve(`${root}map.html`)).toBe(path.join(folder, "map.html"));
    expect(server.resolve(`${root}sub/deep.txt`)).toBe(path.join(folder, "sub", "deep.txt"));
    expect(server.resolve(`${root}sound%20file.mp3?x=1#y`)).toBe(path.join(folder, "sound file.mp3"));
  });

  it.each([
    ["the parent folder", "../secret.txt"],
    ["an encoded parent folder", "%2e%2e/secret.txt"],
    ["an encoded slash", "sub%2F..%2F..%2Fsecret.txt"],
    ["an encoded backslash", "..%5Csecret.txt"],
    ["a link leading outside", "escape.txt"],
    ["a file through a folder link leading outside", "parent-link/secret.txt"],
    ["a folder", "sub"],
    ["the folder itself", ""],
    ["a file that does not exist", "missing.html"],
    ["a null character", "map.html%00.txt"],
  ])("refuses %s", (_name, relative) => {
    expect(server.resolve(`${root}${relative}`)).toBeUndefined();
  });

  it("refuses unknown folders, other schemes and nonsense", () => {
    expect(server.resolve(`${LOCAL_FILE_SCHEME}://0123456789abcdef0123456789abcdef/map.html`)).toBeUndefined();
    expect(server.resolve(pathToFileURL(path.join(folder, "map.html")).href)).toBeUndefined();
    expect(server.resolve("not an address")).toBeUndefined();
  });

  it("checks links again on every request, not only when the file was opened", () => {
    fs.rmSync(path.join(folder, "sub"), { recursive: true });
    fs.symlinkSync(base, path.join(folder, "sub"));
    expect(server.resolve(`${root}sub/secret.txt`)).toBeUndefined();
  });
});

describe("isSameLocalFolder", () => {
  const page = `${LOCAL_FILE_SCHEME}://0123456789abcdef0123456789abcdef/map.html`;
  it.each([
    [`${LOCAL_FILE_SCHEME}://0123456789abcdef0123456789abcdef/sub/a.html`, true],
    ["about:blank", true],
    ["about:srcdoc", true],
    [`${LOCAL_FILE_SCHEME}://fedcba9876543210fedcba9876543210/a.html`, false],
    ["file:///etc/hostname", false],
    ["https://example.com/", false],
    ["data:text/html,hi", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s -> %s", (target, expected) => {
    expect(isSameLocalFolder(page, target)).toBe(expected);
  });

  it("is never true for a page that is not a local file", () => {
    expect(isSameLocalFolder("https://example.com/", "https://example.com/a")).toBe(false);
  });
});

describe("localFileResponse", () => {
  it("serves a file with its type and a strict Content-Security-Policy", async () => {
    const response = await localFileResponse(path.join(folder, "map.html"), new Headers());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(LOCAL_FILE_CSP);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("<title>Map</title>");
  });

  it("refuses with 403 when the file may not be read", async () => {
    const response = await localFileResponse(undefined, new Headers());
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toBe(LOCAL_FILE_CSP);
  });

  it("answers a byte range, so audio and video can be seeked", async () => {
    const response = await localFileResponse(path.join(folder, "sound file.mp3"), new Headers({ range: "bytes=2-5" }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  it("refuses a range outside the file", async () => {
    const response = await localFileResponse(path.join(folder, "sound file.mp3"), new Headers({ range: "bytes=20-" }));
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });
});

describe("parseRange", () => {
  it.each([
    ["bytes=0-", 10, { start: 0, end: 9 }],
    ["bytes=2-5", 10, { start: 2, end: 5 }],
    ["bytes=5-100", 10, { start: 5, end: 9 }],
    ["bytes=-3", 10, { start: 7, end: 9 }],
    ["bytes=10-", 10, "unsatisfiable"],
    ["bytes=5-2", 10, "unsatisfiable"],
    ["bytes=0-1,4-5", 10, undefined],
    ["items=0-1", 10, undefined],
    [null, 10, undefined],
  ] as const)("%j of %d bytes -> %j", (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });
});

describe("contentTypeOf", () => {
  it.each([
    ["a.HTML", "text/html; charset=utf-8"],
    ["a.css", "text/css; charset=utf-8"],
    ["a.js", "text/javascript; charset=utf-8"],
    ["a.svg", "image/svg+xml"],
    ["a.mp3", "audio/mpeg"],
    ["a.ogg", "audio/ogg"],
    ["a.webm", "video/webm"],
    ["a.unknown", "application/octet-stream"],
    ["noextension", "application/octet-stream"],
  ])("%s -> %s", (name, type) => {
    expect(contentTypeOf(name)).toBe(type);
  });
});

describe("LOCAL_FILE_CSP", () => {
  const directives = Object.fromEntries(
    LOCAL_FILE_CSP.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );

  it("keeps a page to its own folder, with inline scripts and styles for simple pages", () => {
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives["connect-src"]).toEqual(["'self'"]);
    expect(directives["frame-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["form-action"]).toEqual(["'none'"]);
  });

  it("names no web address, no file: and no wildcard anywhere", () => {
    expect(LOCAL_FILE_CSP).not.toMatch(/https?:|file:|\*|'unsafe-eval'/);
  });
});
