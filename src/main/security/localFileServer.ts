/**
 * SEC-15 / WP1 review 1 and 2: how a file from the user's computer is served
 * to its tab.
 *
 * A page loaded from `file:` can read any file on the disk (Electron grants
 * file pages extra rights) and has the origin "file:///", the same as the
 * app's own packaged pages, including the hidden capture window. So a file
 * the user opens is never loaded from `file:`. It is loaded from
 * `cue-local-file://<folder id>/<path in the folder>` instead, served by the
 * main process on the `persist:local-files` session only:
 *
 * - each folder gets its own host (a hash of its path), so its own origin;
 * - a request is answered only for a file inside the approved file's own
 *   folder or its subfolders, checked with the real path on both sides, so a
 *   link (symlink or junction) that leads out of the folder is refused;
 * - every answer carries a strict Content-Security-Policy that keeps the
 *   page to its own folder and off the network.
 *
 * Kept free of Electron imports so the rules can be unit-tested; the
 * protocol handler itself is installed by sessions.ts.
 */
import { createHash } from "crypto";
import fs from "fs";
import nodePath from "path";
import { Readable } from "stream";
import { pathToFileURL } from "url";
import { isInsideFolder } from "./localFiles";

export const LOCAL_FILE_SCHEME = "cue-local-file";
const SCHEME_PREFIX = `${LOCAL_FILE_SCHEME}:`;

/**
 * The policy sent with every local file. `'self'` is the file's own folder
 * (one origin per folder). Inline scripts and styles are allowed so a simple
 * HTML soundboard or handout saved as one file still works; nothing may come
 * from, or go to, the web or any other folder.
 */
export const LOCAL_FILE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

type PathApi = typeof nodePath.posix;

/** The file-system calls the server needs; tests pass their own. */
export interface FileSystemLike {
  /** The real path, with every link resolved. Throws when the path does not exist. */
  realpath(path: string): string;
  isFile(path: string): boolean;
}

export const nodeFileSystem: FileSystemLike = {
  realpath: (path) => fs.realpathSync.native(path),
  isFile: (path) => fs.statSync(path).isFile(),
};

/** Characters a single folder or file name may not contain once decoded. */
const BAD_NAME = /[/\\\0]|^\.{1,2}$/;
/** On Windows, "name:stream" is a hidden stream of a file, and ":" is otherwise not allowed. */
const WINDOWS_BAD_NAME = /[:]/;

export class LocalFileServer {
  private readonly folders = new Map<string, string>();
  private readonly pathApi: PathApi;
  private readonly fileSystem: FileSystemLike;
  private readonly windowsPaths: boolean;

  constructor({
    pathApi,
    fileSystem = nodeFileSystem,
    windowsPaths = process.platform === "win32",
  }: { pathApi?: PathApi; fileSystem?: FileSystemLike; windowsPaths?: boolean } = {}) {
    this.windowsPaths = windowsPaths;
    this.pathApi = pathApi ?? (windowsPaths ? nodePath.win32 : nodePath.posix);
    this.fileSystem = fileSystem;
  }

  /**
   * Serve the folder of `filePath` (a real path the user approved) and
   * return the address to load the file from.
   * @param suffix the `?query#section` of the address the user opened
   */
  addressOf(filePath: string, suffix = ""): string {
    const folder = this.pathApi.dirname(filePath);
    const host = this.hostOf(folder);
    this.folders.set(host, folder);
    const name = encodeURIComponent(this.pathApi.basename(filePath));
    return `${SCHEME_PREFIX}//${host}/${name}${suffix}`;
  }

  /**
   * The file a request for `address` may read, or undefined when it must be
   * refused: not this scheme, an unknown folder, a name that tries to leave
   * the folder, a link leading out of it, a folder, or nothing at all.
   */
  resolve(address: string): string | undefined {
    const located = this.locate(address);
    if (!located) {
      return undefined;
    }
    try {
      const realFolder = this.fileSystem.realpath(located.folder);
      const realFile = this.fileSystem.realpath(located.path);
      if (!isInsideFolder(realFile, realFolder, this.pathApi) || !this.fileSystem.isFile(realFile)) {
        return undefined;
      }
      return realFile;
    } catch {
      return undefined;
    }
  }

  /**
   * The `file:` address of one of this server's addresses, as the address
   * bar and bookmarks show it; undefined for any other address.
   */
  toFileAddress(address: string): string | undefined {
    const located = this.locate(address, { allowFolder: true });
    if (!located) {
      return undefined;
    }
    const url = new URL(address);
    return `${pathToFileURL(located.path, { windows: this.windowsPaths }).href}${url.search}${url.hash}`;
  }

  private locate(
    address: string,
    { allowFolder = false }: { allowFolder?: boolean } = {},
  ): { folder: string; path: string } | undefined {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return undefined;
    }
    const folder = url.protocol === SCHEME_PREFIX ? this.folders.get(url.host) : undefined;
    if (!folder) {
      return undefined;
    }
    const names: string[] = [];
    for (const encoded of url.pathname.split("/").filter((part) => part !== "")) {
      let name: string;
      try {
        name = decodeURIComponent(encoded);
      } catch {
        return undefined;
      }
      if (BAD_NAME.test(name) || (this.windowsPaths && WINDOWS_BAD_NAME.test(name))) {
        return undefined;
      }
      names.push(name);
    }
    if (names.length === 0 && !allowFolder) {
      return undefined;
    }
    return { folder, path: this.pathApi.join(folder, ...names) };
  }

  private hostOf(folder: string): string {
    const key = this.windowsPaths ? folder.toLowerCase() : folder;
    return createHash("sha256").update(key).digest("hex").slice(0, 32);
  }
}

/**
 * Whether a frame in the page at `pageAddress` may show `target`: only
 * another file from the same folder (the same host of this scheme), or an
 * empty frame (about:blank, about:srcdoc), which takes on the page's rules.
 */
export function isSameLocalFolder(pageAddress: string, target: string): boolean {
  try {
    const page = new URL(pageAddress);
    if (page.protocol !== SCHEME_PREFIX) {
      return false;
    }
    if (target === "about:blank" || target === "about:srcdoc") {
      return true;
    }
    const next = new URL(target);
    return next.protocol === SCHEME_PREFIX && next.host === page.host;
  } catch {
    return false;
  }
}

/**
 * Whether a request made from a file's tab may go ahead at all: only this
 * scheme and in-page data (`data:`, `blob:`). Everything else, the web
 * included, is cancelled before it leaves the computer.
 */
export function isAllowedLocalFileRequest(address: string): boolean {
  return /^(cue-local-file|data|blob):/i.test(address);
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".weba": "audio/webm",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

/** The Content-Type for a file, from its extension; unknown files are plain bytes. */
export function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[nodePath.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Read a single `Range: bytes=…` header for a file of `size` bytes.
 * @returns the bytes to send, "unsatisfiable" for a range outside the file,
 *   or undefined to send the whole file (no header, or a form not supported)
 */
export function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) {
    return undefined;
  }
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0 ? "unsatisfiable" : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start >= size || end < start ? "unsatisfiable" : { start, end };
}

function baseHeaders(): Headers {
  return new Headers({
    "Content-Security-Policy": LOCAL_FILE_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  });
}

/**
 * The answer to a request for a local file: the file (or the requested part
 * of it, so audio and video can be seeked), or 403 when `filePath` is
 * undefined (the request was refused by `LocalFileServer.resolve`).
 */
export async function localFileResponse(filePath: string | undefined, requestHeaders: Headers): Promise<Response> {
  const headers = baseHeaders();
  if (!filePath) {
    return new Response("This file may not be opened here.", { status: 403, headers });
  }
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return new Response("This file could not be found.", { status: 404, headers });
  }
  headers.set("Content-Type", contentTypeOf(filePath));
  headers.set("Accept-Ranges", "bytes");
  const range = parseRange(requestHeaders.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  const body =
    size === 0
      ? null
      : (Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream<Uint8Array>);
  return new Response(body, { status: range ? 206 : 200, headers });
}

let shared: LocalFileServer | undefined;

/** The one server of the main process: the protocol handler and the tabs share it. */
export function sharedLocalFileServer(): LocalFileServer {
  shared ??= new LocalFileServer();
  return shared;
}
