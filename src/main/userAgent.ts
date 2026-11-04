import os from "os";

const platformMap: Record<string, string> = {
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
  win32: "Windows NT 10.0; Win64; x64",
  linux: "X11; Linux x86_64",
};

/**
 * SEC-1: Chromium version of the bundled Electron (44.9.2). Used only when
 * not running inside Electron (unit tests); update it with Electron.
 */
export const FALLBACK_CHROME_VERSION = "152.0.7977.167";

/**
 * SEC-1: the Chromium version Electron is really running, so sites see a
 * current Chrome and the user agent cannot fall behind after an upgrade.
 */
const chromeVersion = process.versions.chrome || FALLBACK_CHROME_VERSION;

/** Approximate the user agent for this platform */
export function getUserAgent() {
  const platform = platformMap[os.platform()] || platformMap.win32;
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

export function getMalformedUserAgent() {
  const platform = platformMap[os.platform()] || platformMap.win32;
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36`;
}
