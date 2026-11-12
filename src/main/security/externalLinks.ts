import { checkExternalUrl, isRefused } from "../../common/security/urlPolicy";
import { createRateLimiter } from "./popupRateLimiter";

/**
 * SEC-10: open a link in the user's default browser only when it is a plain
 * https web address. Anything else (file:, smb:, custom protocol handlers)
 * could make the operating system run a program, so it is dropped.
 * @param openExternal usually Electron's `shell.openExternal`
 * @returns whether the link was handed to the operating system
 */
export function openExternalIfAllowed(
  url: string,
  openExternal: (url: string) => Promise<void>,
): boolean {
  const check = checkExternalUrl(url);
  if (isRefused(check)) {
    console.warn(`Refused to open external link: ${check.reason}`);
    return false;
  }
  openExternal(check.url).catch((error) => {
    console.error("Unable to open external link", error);
  });
  return true;
}

/** CR51-9: links the Lyre page may hand to the system browser: 5 every 10 seconds. */
export const EXTERNAL_LINK_LIMIT = { max: 5, windowMs: 10_000 } as const;

/**
 * CR51-9: `openExternalIfAllowed` with a limit, so a page gone wrong cannot open hundreds of browser tabs mid-session.
 * Refused addresses do not count; links past the limit are dropped (and logged).
 * @param now clock in ms, replaceable in tests
 */
export function rateLimitedExternalOpener(openExternal: (url: string) => Promise<void>, now: () => number = Date.now): (url: string) => void {
  const limiter = createRateLimiter<"links">({ ...EXTERNAL_LINK_LIMIT, now });
  return (url) => {
    if (isRefused(checkExternalUrl(url))) {
      openExternalIfAllowed(url, openExternal);
      return;
    }
    if (!limiter.tryAcquire("links")) {
      console.warn("Refused to open external link: too many links at once");
      return;
    }
    openExternalIfAllowed(url, openExternal);
  };
}
