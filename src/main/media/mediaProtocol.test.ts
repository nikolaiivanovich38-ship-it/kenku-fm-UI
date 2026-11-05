/**
 * lyre-media: (security review 6): the Lyre page reads only files MEDIA_PREPARE prepared for it, by addresses that
 * name a page and a file by random tokens; anything else is refused.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { MEDIA_SCHEME, MediaGrants, mediaResponse } from "./mediaProtocol";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function file(name: string, content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-media-"));
  dirs.push(dir);
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}
const get = (grants: MediaGrants, url: string, extra: Record<string, string> = {}, method = "GET") => mediaResponse(grants, { url, method, headers: new Headers(extra) });

describe("MediaGrants", () => {
  it("grants a page an address for one prepared file, the same address when asked again", () => {
    const grants = new MediaGrants();
    const tavern = file("01 Tavern.flac", "x");
    const address = grants.grant(7, tavern);
    expect(address).toMatch(new RegExp(`^${MEDIA_SCHEME}://[0-9a-f]{32}/[0-9a-f]{32}/01%20Tavern\\.flac$`));
    expect(grants.resolve(address)).toBe(tavern);
    expect(grants.grant(7, tavern)).toBe(address);
  });

  it("gives each page its own token, so one page's addresses are not another's", () => {
    const grants = new MediaGrants();
    const a = grants.grant(1, "/m/a.flac");
    const b = grants.grant(2, "/m/a.flac");
    expect(new URL(a).hostname).not.toBe(new URL(b).hostname);
    const [, , aHost, aFile] = a.split("/");
    const [, , bHost] = b.split("/");
    // Page 2's token with page 1's file token names nothing.
    expect(grants.resolve(`${MEDIA_SCHEME}://${bHost}/${aFile.split("/")[0]}/a.flac`)).toBeUndefined();
    expect(grants.resolve(`${MEDIA_SCHEME}://${aHost}/${"0".repeat(32)}/a.flac`)).toBeUndefined();
  });

  it("refuses addresses never granted, other schemes, odd forms, and every grant of a page that went", () => {
    const grants = new MediaGrants();
    const address = grants.grant(3, "/m/a.flac");
    for (const bad of ["file:///m/a.flac", `${MEDIA_SCHEME}://x/y/z`, address.replace(/^lyre-media/, "https"), address.replace("://", "://user@"), "not a url"]) {
      expect(grants.resolve(bad), bad).toBeUndefined();
    }
    grants.revokePage(3);
    expect(grants.resolve(address)).toBeUndefined();
    expect(grants.hasPage(3)).toBe(false);
  });

  it("keeps at most a set number of files per page, dropping the oldest", () => {
    const grants = new MediaGrants({ maxPerPage: 2 });
    const first = grants.grant(1, "/m/1.flac");
    grants.grant(1, "/m/2.flac");
    grants.grant(1, "/m/3.flac");
    expect(grants.resolve(first)).toBeUndefined();
  });
});

describe("mediaResponse", () => {
  it("answers the granted file, whole or in part, readable by the page's audio", async () => {
    const grants = new MediaGrants();
    const address = grants.grant(1, file("a.flac", "0123456789"));
    const whole = await get(grants, address);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe("0123456789");
    expect(whole.headers.get("content-type")).toBe("audio/flac");
    expect(whole.headers.get("access-control-allow-origin")).toBe("*");
    expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
    const part = await get(grants, address, { Range: "bytes=2-4" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("234");
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect((await get(grants, address, { Range: "bytes=50-" })).status).toBe(416);
    const head = await get(grants, address, {}, "HEAD");
    expect(head.status).toBe(200);
  });

  it("refuses anything not granted, and other methods; says when the file has gone", async () => {
    const grants = new MediaGrants();
    const gone = file("gone.flac", "x");
    const address = grants.grant(1, gone);
    expect((await get(grants, `${MEDIA_SCHEME}://${"a".repeat(32)}/${"b".repeat(32)}/x.flac`)).status).toBe(403);
    expect((await get(grants, address, {}, "POST")).status).toBe(403);
    fs.rmSync(gone);
    expect((await get(grants, address)).status).toBe(404);
  });
});
