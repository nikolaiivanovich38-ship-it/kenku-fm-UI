/**
 * Security review 6 (w3-secfix): the Lyre page reads library audio only through lyre-media: addresses that
 * MEDIA_PREPARE granted it. It cannot read a file anywhere else on the disk: file: is outside its
 * Content-Security-Policy, and a lyre-media: address it was not given is refused.
 */
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreTab } from "./fixtures/lyre";
import { wavBytes, writeFile } from "../src/main/media/testing/wavFiles";

function lyreCall<T = unknown>(lyre: Page, area: string, method: string, ...args: unknown[]): Promise<T> {
  return lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([a, m, rest]) => (window as any).lyre.api.call(a, m, rest),
    [area, method, args] as const,
  ) as Promise<T>;
}

/** What a fetch from the Lyre page gets: the status and the first bytes, or the error's name. */
function fetchFromLyre(lyre: Page, url: string) {
  return lyre.evaluate(async (address) => {
    try {
      const answer = await fetch(address);
      const bytes = new Uint8Array(await answer.arrayBuffer());
      return { status: answer.status, start: String.fromCharCode(...bytes.subarray(0, 4)) };
    } catch (error) {
      return { failed: (error as Error).name };
    }
  }, url);
}

/** The same with XMLHttpRequest (how the engine reads small files). */
function xhrFromLyre(lyre: Page, url: string) {
  return lyre.evaluate(
    (address) =>
      new Promise<{ status: number } | { failed: string }>((resolve) => {
        const request = new XMLHttpRequest();
        request.open("GET", address);
        request.responseType = "arraybuffer";
        request.onload = () => resolve({ status: request.status });
        request.onerror = () => resolve({ failed: "error" });
        try {
          request.send();
        } catch (error) {
          resolve({ failed: (error as Error).name });
        }
      }),
    url,
  );
}

test("the Lyre page plays library files through lyre-media: and cannot read any other file", async ({ mainWindow, userDataDir, errors }) => {
  // The page's own refusals of file: are what this test provokes.
  errors.expectedRefusals.push({ page: /lyre_window/, text: /Refused to connect|connect-src/ });
  errors.ignoredConsole.push(/Failed to load resource: the server responded with a status of 403/);
  const secret = path.join(userDataDir, "private", "secret.txt");
  fs.mkdirSync(path.dirname(secret), { recursive: true });
  fs.writeFileSync(secret, "not for the page");
  const file = writeFile(path.join(userDataDir, "sounds"), "Rain.wav", wavBytes({ seconds: 1 }));
  const lyre = await openLyreTab(mainWindow);
  const imported = await lyreCall<{ ok: boolean; value: { added: string[] } }>(lyre, "import", "start", { from: "paths", paths: [file] });
  expect(imported.ok).toBe(true);
  const tracks = await lyreCall<{ id: string; url: string }[]>(lyre, "library", "listTracks");
  const track = tracks.find((t) => t.id === imported.value.added[0]);

  const prepared = await lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (url) => (window as any).lyre.audio.media.prepare(url, { keepLocal: false }) as Promise<{ url?: string; error?: string }>,
    track?.url as string,
  );
  expect(prepared.url).toMatch(/^lyre-media:\/\/[0-9a-f]{32}\/[0-9a-f]{32}\/Rain\.wav$/);
  expect(await fetchFromLyre(lyre, prepared.url as string)).toEqual({ status: 200, start: "RIFF" });
  expect(await xhrFromLyre(lyre, prepared.url as string)).toEqual({ status: 200 });

  // Files outside the library: not by file:, not by a made-up or altered lyre-media: address, not by MEDIA_PREPARE.
  const secretUrl = new URL(`file://${secret}`).href;
  expect(await fetchFromLyre(lyre, secretUrl)).toHaveProperty("failed");
  expect(await xhrFromLyre(lyre, secretUrl)).toHaveProperty("failed");
  const altered = (prepared.url as string).replace(/\/[0-9a-f]{32}\//, `/${"0".repeat(32)}/`);
  expect(await fetchFromLyre(lyre, altered)).toMatchObject({ status: 403 });
  const refused = await lyre.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (url) => (window as any).lyre.audio.media.prepare(url, { keepLocal: false }) as Promise<{ url?: string; error?: string }>,
    secretUrl,
  );
  expect(refused.error).toBe("Lyre only plays files from your library folders.");
});
