/**
 * SEC-6 / SEC-10: which web addresses Kenku FM is willing to open.
 *
 * Pure module (no Electron import) so the same rules run in the main process,
 * which enforces them, and in the renderer, which uses them to explain a
 * refusal to the user before anything is sent to the main process.
 */

/** Why an address was refused, for code that needs to branch on it. */
export type UrlRefusalCode =
  | "empty"
  | "invalid"
  | "scheme"
  | "credentials"
  | "too-long";

export type UrlRefusal = { ok: false; code: UrlRefusalCode; reason: string };

export type TabUrlCheck =
  | { ok: true; url: string; insecure: boolean }
  | UrlRefusal;

export type ExternalUrlCheck = { ok: true; url: string } | UrlRefusal;

/** Chromium refuses URLs longer than 2 MiB; refuse them here first. */
const MAX_URL_LENGTH = 2 * 1024 * 1024;

const TAB_PROTOCOLS = new Set(["https:", "http:"]);
const EXTERNAL_PROTOCOLS = new Set(["https:"]);

const REASONS: Record<UrlRefusalCode, string> = {
  empty: "Type a web address, for example youtube.com.",
  invalid:
    "That doesn't look like a web address. Check the spelling, for example youtube.com.",
  scheme:
    "Cue Desk only opens web pages whose address starts with https:// or http://.",
  credentials:
    "Addresses containing a user name or password are not allowed. Remove the part before the @ sign and log in on the page instead.",
  "too-long": "That web address is too long to open.",
};

/**
 * True when a check refused the address. Use this rather than `!check.ok`:
 * the project's TypeScript settings do not narrow on boolean literals.
 */
export function isRefused(
  check: TabUrlCheck | ExternalUrlCheck | ParsedUrl,
): check is UrlRefusal {
  return check.ok === false;
}

type ParsedUrl = { ok: true; url: URL } | UrlRefusal;

function refuse(code: UrlRefusalCode): UrlRefusal {
  return { ok: false, code, reason: REASONS[code] };
}

/**
 * Parse and check an address against an allowed set of protocols.
 * The WHATWG URL parser lower-cases the scheme, strips leading/trailing
 * whitespace and embedded tabs/newlines, and converts IDN hosts to punycode,
 * so the check runs on what Chromium would actually load.
 */
function parseAllowed(
  raw: unknown,
  allowedProtocols: ReadonlySet<string>,
): ParsedUrl {
  if (typeof raw !== "string") {
    return refuse("invalid");
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return refuse("empty");
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return refuse("too-long");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return refuse("invalid");
  }

  // Percent-encoding can make the normalised address much longer than the input.
  if (url.href.length > MAX_URL_LENGTH) {
    return refuse("too-long");
  }
  if (!allowedProtocols.has(url.protocol)) {
    return refuse("scheme");
  }
  if (url.username !== "" || url.password !== "") {
    return refuse("credentials");
  }
  if (url.hostname === "") {
    return refuse("invalid");
  }
  return { ok: true, url };
}

/**
 * SEC-6: may this address be loaded in a browser tab?
 * Only http(s) pages without embedded credentials are allowed; plain http is
 * allowed but flagged `insecure` so the UI can say so.
 * @returns the normalised address to load, or a plain-language reason.
 */
export function checkTabUrl(raw: string): TabUrlCheck {
  const result = parseAllowed(raw, TAB_PROTOCOLS);
  if (isRefused(result)) {
    return result;
  }
  return {
    ok: true,
    url: result.url.href,
    insecure: result.url.protocol === "http:",
  };
}

/**
 * SEC-10: may this address be handed to the operating system
 * (`shell.openExternal`)? Only https links are allowed, because the OS will
 * happily launch programs for file:, smb: and custom protocol links.
 */
export function checkExternalUrl(raw: string): ExternalUrlCheck {
  const result = parseAllowed(raw, EXTERNAL_PROTOCOLS);
  if (isRefused(result)) {
    return result;
  }
  return { ok: true, url: result.url.href };
}

/**
 * A URL scheme at the start of an address ("https:", "chrome-extension:",
 * "view-source:", "ms-settings:"), but not a host followed by a port number
 * ("localhost:3000", "example.com:8080/path"), which is how people type
 * local servers.
 */
const LEADING_SCHEME = /^[a-z][\w+.-]*:(?!\d+(?:[/?#]|$))/i;

/**
 * Unicode format characters (category Cf: zero-width space, byte-order mark,
 * direction marks) are invisible, often come along when an address is copied
 * from a chat or document, and could hide a scheme from the user.
 */
// Built with the constructor: the project's TypeScript target rejects the
// "u" flag in a regex literal, but Chromium and Node support it.
const FORMAT_CHARACTERS = new RegExp("\\p{Cf}", "gu");

/**
 * Add `https://` to an address typed without a scheme ("youtube.com").
 * Anything that already names a scheme, or is a relative path, is returned
 * unchanged so that `checkTabUrl` can judge it. `localhost:3000` counts as a
 * host, not a scheme.
 */
export function prependHttp(raw: string): string {
  const url = raw.trim();
  if (/^\.*\//.test(url) || LEADING_SCHEME.test(url)) {
    return url;
  }
  return `https://${url}`;
}

/**
 * SEC-6: check an address the user typed into the URL bar or a bookmark.
 * Removes invisible formatting characters, applies the `prependHttp`
 * convenience, then the tab policy.
 */
export function checkTypedTabUrl(raw: string): TabUrlCheck {
  if (typeof raw !== "string") {
    return refuse("invalid");
  }
  const cleaned = raw.replace(FORMAT_CHARACTERS, "").trim();
  if (cleaned === "") {
    return refuse("empty");
  }
  return checkTabUrl(prependHttp(cleaned));
}
