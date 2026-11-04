/**
 * A tiny web site on 127.0.0.1 standing in for YouTube or Tabletop Audio,
 * because tests cannot reach the internet.
 */
import http from "http";
import type { AddressInfo } from "net";

export type LocalSite = {
  /** Address of `pathname` on the site, e.g. url("/one"). */
  url(pathname: string): string;
  /** How many times each path has been requested. */
  hits: Map<string, number>;
  close(): Promise<void>;
};

/** Pages by path: title and body HTML. */
export type SitePages = Record<string, { title: string; body: string }>;

/** A 1x1 PNG, served as the site's icon so the tab bar can show one. */
const FAVICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function startLocalSite(pages: SitePages): Promise<LocalSite> {
  const hits = new Map<string, number>();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
    if (pathname === "/favicon.ico") {
      response.setHeader("content-type", "image/png");
      response.end(FAVICON);
      return;
    }
    const page = pages[pathname];
    if (!page) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><title>${page.title}</title>${page.body}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (pathname) => `http://127.0.0.1:${port}${pathname}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
