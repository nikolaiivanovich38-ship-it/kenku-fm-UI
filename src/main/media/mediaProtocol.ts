/**
 * Security review 6: the Lyre page reads library audio only through `lyre-media:` addresses that MEDIA_PREPARE
 * made for it, never through `file:` (its Content-Security-Policy no longer allows file:).
 *
 * - MEDIA_PREPARE checks the file first (MediaAccess: library folders, real paths), prepares it (MediaCache), and
 *   then grants the page that asked an address for exactly that file:
 *   `lyre-media://<page token>/<file token>/<file name>`. Both tokens are 128 random bits; the page token is the
 *   page's own, so another page (the old player, a website tab) cannot use it, and every grant of a page is dropped
 *   when the page goes. The file name is only for logs and DevTools; it is not used to find the file.
 * - The scheme is handled on the app's default session only, where Lyre's own pages are; website tabs and
 *   local-file tabs have sessions of their own and cannot reach it at all.
 * - Answers are the file (or the part asked for, so audio can seek) with `nosniff`, `no-store`, and
 *   `Access-Control-Allow-Origin: *`: the page's own origin is `file:` (opaque), and Web Audio plays a
 *   cross-origin <audio> element as silence without it. The address itself is what grants access.
 * - Anything else (an address never granted, a revoked page, another method than GET or HEAD) is refused: 403.
 */
import { randomBytes } from "crypto";
import fs from "fs";
import nodePath from "path";
import { Readable } from "stream";

import { contentTypeOf, parseRange } from "../security/localFileServer";

export const MEDIA_SCHEME = "lyre-media";

/** Most files one page holds at once; the oldest grant goes first (a long session plays many tracks). */
const MAX_GRANTS_PER_PAGE = 20_000;

const TOKEN = /^[0-9a-f]{32}$/;

const newToken = () => randomBytes(16).toString("hex");

interface PageGrants {
  token: string;
  /** File token → path, oldest first. */
  files: Map<string, string>;
  /** Path → file token, so a file prepared again gets the same address (the read-ahead keys copies by address). */
  byPath: Map<string, string>;
}

export class MediaGrants {
  private readonly pages = new Map<number, PageGrants>();
  /** Page token → page id. */
  private readonly tokens = new Map<string, number>();
  private readonly maxPerPage: number;

  constructor(options: { maxPerPage?: number } = {}) {
    this.maxPerPage = options.maxPerPage ?? MAX_GRANTS_PER_PAGE;
  }

  /** The address page `pageId` may read `filePath` through (a file MEDIA_PREPARE has checked and prepared). */
  grant(pageId: number, filePath: string): string {
    let page = this.pages.get(pageId);
    if (!page) {
      page = { token: newToken(), files: new Map(), byPath: new Map() };
      this.pages.set(pageId, page);
      this.tokens.set(page.token, pageId);
    }
    let fileToken = page.byPath.get(filePath);
    if (!fileToken) {
      fileToken = newToken();
      page.files.set(fileToken, filePath);
      page.byPath.set(filePath, fileToken);
      while (page.files.size > this.maxPerPage) {
        const [oldest, oldPath] = page.files.entries().next().value as [string, string];
        page.files.delete(oldest);
        page.byPath.delete(oldPath);
      }
    }
    const name = encodeURIComponent(nodePath.basename(filePath.replace(/\\/g, "/")));
    return `${MEDIA_SCHEME}://${page.token}/${fileToken}/${name}`;
  }

  /** The file an address was granted for, or undefined (never granted, revoked, or not a lyre-media: address). */
  resolve(address: string): string | undefined {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return undefined;
    }
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.username || url.password || url.port) return undefined;
    const pageToken = url.hostname;
    const fileToken = url.pathname.split("/")[1] ?? "";
    if (!TOKEN.test(pageToken) || !TOKEN.test(fileToken)) return undefined;
    const pageId = this.tokens.get(pageToken);
    if (pageId === undefined) return undefined;
    return this.pages.get(pageId)?.files.get(fileToken);
  }

  /** Drops every grant of a page (it was closed or reloaded). */
  revokePage(pageId: number): void {
    const page = this.pages.get(pageId);
    if (!page) return;
    this.tokens.delete(page.token);
    this.pages.delete(pageId);
  }

  /** Whether the page holds grants (tests). */
  hasPage(pageId: number): boolean {
    return this.pages.has(pageId);
  }
}

function headers(): Headers {
  return new Headers({
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
}

/** The answer to a lyre-media: request: the granted file, the part asked for (206), or a refusal. */
export async function mediaResponse(grants: MediaGrants, request: { url: string; method?: string; headers: Headers }): Promise<Response> {
  const answer = headers();
  const method = (request.method ?? "GET").toUpperCase();
  const filePath = method === "GET" || method === "HEAD" ? grants.resolve(request.url) : undefined;
  if (!filePath) return new Response("This file may not be played here.", { status: 403, headers: answer });
  let size: number;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    return new Response("This file could not be found.", { status: 404, headers: answer });
  }
  answer.set("Content-Type", contentTypeOf(filePath));
  answer.set("Accept-Ranges", "bytes");
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    answer.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers: answer });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  answer.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (range) answer.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const body =
    size === 0 || method === "HEAD"
      ? null
      : (Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream<Uint8Array>);
  return new Response(body, { status: range ? 206 : 200, headers: answer });
}

let shared: MediaGrants | undefined;

/** The main process's one set of grants: MEDIA_PREPARE (lyreApi/startLibrary.ts) and the scheme's handler share it. */
export function sharedMediaGrants(): MediaGrants {
  shared ??= new MediaGrants();
  return shared;
}
