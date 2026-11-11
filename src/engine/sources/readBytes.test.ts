import { describe, expect, it } from "vitest";

import { readBytes, XhrLike } from "./readBytes";

/** A scripted XMLHttpRequest: each test says what the "server" does. */
class FakeXhr implements XhrLike {
  static script: (xhr: FakeXhr) => void = () => undefined;
  responseType: XMLHttpRequestResponseType = "";
  response: unknown = null;
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null = null;
  url = "";
  aborted = false;
  open(_method: string, url: string) {
    this.url = url;
  }
  send() {
    queueMicrotask(() => FakeXhr.script(this));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const read = (url: string, limit: number) => readBytes(url, limit, () => new FakeXhr());

describe("readBytes", () => {
  it("returns the whole file as bytes (file:// answers with status 0)", async () => {
    FakeXhr.script = (xhr) => {
      xhr.response = new ArrayBuffer(10);
      xhr.onload?.();
    };
    expect((await read("file:///a.wav", 100))?.byteLength).toBe(10);
  });

  it("gives up as soon as the size is known to be over the limit", async () => {
    let seen: FakeXhr | null = null;
    FakeXhr.script = (xhr) => {
      seen = xhr;
      xhr.onprogress?.({ loaded: 10, total: 1000, lengthComputable: true });
    };
    expect(await read("file:///big.wav", 100)).toBeNull();
    expect(seen!.aborted).toBe(true);
  });

  it("gives up once more than the limit has arrived, when the size was not announced", async () => {
    FakeXhr.script = (xhr) => {
      xhr.onprogress?.({ loaded: 150, total: 0, lengthComputable: false });
    };
    expect(await read("file:///big.wav", 100)).toBeNull();
  });

  it("returns null when the finished file turns out bigger than the limit", async () => {
    FakeXhr.script = (xhr) => {
      xhr.response = new ArrayBuffer(150);
      xhr.onload?.();
    };
    expect(await read("file:///big.wav", 100)).toBeNull();
  });

  it("reports a missing file in plain words", async () => {
    FakeXhr.script = (xhr) => xhr.onerror?.();
    await expect(read("file:///gone.wav", 100)).rejects.toThrow("Could not read the audio file");
    FakeXhr.script = (xhr) => {
      xhr.status = 404;
      xhr.onload?.();
    };
    await expect(read("https://example.com/gone.wav", 100)).rejects.toThrow("Could not read the audio file (404)");
  });
});
