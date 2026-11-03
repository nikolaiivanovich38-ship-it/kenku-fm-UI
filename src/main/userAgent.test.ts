import { afterEach, describe, expect, it, vi } from "vitest";

const realChrome = process.versions.chrome;

function setChromeVersion(value: string | undefined) {
  Object.defineProperty(process.versions, "chrome", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

async function loadFresh() {
  vi.resetModules();
  return import("./userAgent");
}

afterEach(() => {
  setChromeVersion(realChrome);
});

describe("getUserAgent", () => {
  it("reports the Chromium version Electron is running, so the user agent never drifts after an upgrade", async () => {
    setChromeVersion("199.0.1234.56");
    const { getUserAgent } = await loadFresh();
    expect(getUserAgent()).toContain("Chrome/199.0.1234.56 ");
  });

  it("falls back to the Chromium version of the bundled Electron outside Electron (unit tests)", async () => {
    setChromeVersion(undefined);
    const { getUserAgent, FALLBACK_CHROME_VERSION } = await loadFresh();
    expect(FALLBACK_CHROME_VERSION).toBe("152.0.7977.167");
    expect(getUserAgent()).toContain(`Chrome/${FALLBACK_CHROME_VERSION} `);
  });

  it("looks like plain Chrome: no Electron or app tokens", async () => {
    const { getUserAgent } = await loadFresh();
    expect(getUserAgent()).toMatch(
      /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/[\d.]+ Safari\/537\.36$/,
    );
  });
});

describe("getMalformedUserAgent", () => {
  it("omits the Chrome token (Google sign-in blocks embedded Chrome)", async () => {
    const { getMalformedUserAgent } = await loadFresh();
    expect(getMalformedUserAgent()).not.toContain("Chrome/");
  });
});
