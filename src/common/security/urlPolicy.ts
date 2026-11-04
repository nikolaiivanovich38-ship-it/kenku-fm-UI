/**
 * SEC-6 / SEC-10 / SEC-15: which addresses Cue Desk is willing to open.
 *
 * Pure module (no Electron import) so the same rules run in the main process,
 * which enforces them, and in the renderer, which uses them to explain a
 * refusal to the user before anything is sent to the main process.
 *
 * This is the one place that decides what is allowed:
 * - `checkTabUrl`: what a website tab may load, including every navigation,
 *   redirect and popup a page starts. Web pages only (http, https).
 * - `checkTypedTabUrl`: what the user may open from the address bar or a
 *   bookmark. Web pages, plus files on this computer, which come back as
 *   "local file, needs confirmation" (`isLocalFile`): the main process asks
 *   the user before opening one (SEC-15).
 * - `checkLocalFileUrl`: the main process's own check of such a file address.
 * - `checkExternalUrl`: what may be handed to the operating system.
 */

/** Why an address was refused, for code that needs to branch on it. */
export type UrlRefusalCode =
  | "empty"
  | "invalid"
  | "scheme"
  | "credentials"
  | "too-long"
  | "network-file";

export type UrlRefusal = { ok: false; code: UrlRefusalCode; reason: string };

export type TabUrlCheck =
  | { ok: true; url: string; insecure: boolean }
  | UrlRefusal;

export type ExternalUrlCheck = { ok: true; url: string } | UrlRefusal;

/**
 * SEC-15: a file on this computer that the user asked for. Not "allowed" and
 * not "refused": the main process opens it only after asking the user (or when
 * its folder is on the user's list of remembered folders).
 */
export type LocalFileCheck = { ok: "ask"; kind: "local-file"; url: string };

/** What the address bar and bookmarks may open: a web page, a local file to confirm, or nothing. */
export type UserTabUrlCheck = TabUrlCheck | LocalFileCheck;

/** Chromium refuses URLs longer than 2 MiB; refuse them here first. */
const MAX_URL_LENGTH = 2 * 1024 * 1024;

const TAB_PROTOCOLS = new Set(["https:", "http:"]);
const EXTERNAL_PROTOCOLS = new Set(["https:"]);
const FILE_PROTOCOLS = new Set(["file:"]);

const REASONS: Record<UrlRefusalCode, string> = {
  empty: "Type a web address, for example youtube.com.",
  invalid:
    "That doesn't look like a web address. Check the spelling, for example youtube.com.",
  scheme:
    "Cue Desk only opens web pages whose address starts with https:// or http://.",
  credentials:
    "Addresses containing a user name or password are not allowed. Remove the part before the @ sign and log in on the page instead.",
  "too-long": "That web address is too long to open.",
  "network-file":
    "Cue Desk only opens files on this computer, not files in a shared network folder. Copy the file to this computer first.",
};

/**
 * True when a check refused the address. Use this rather than `!check.ok`:
 * the project's TypeScript settings do not narrow on boolean literals.
 */
export function isRefused(
  check: UserTabUrlCheck | ExternalUrlCheck | ParsedUrl | LocalFileCheck,
): check is UrlRefusal {
  return check.ok === false;
}

/** SEC-15: true when the address is a file on this computer, to be confirmed by the user. */
export function isLocalFile(
  check: UserTabUrlCheck | LocalFileCheck | UrlRefusal,
): check is LocalFileCheck {
  return check.ok === "ask";
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
  // A file address has no host (checkLocalFileUrl refuses one that has).
  if (url.hostname === "" && url.protocol !== "file:") {
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
 * SEC-15: may the user open this file address? Only files on this computer:
 * `file://server/share` and `file:////server/share` are Windows network
 * shares, and opening one makes Windows send the user's login to that server.
 * An encoded slash or backslash (%2F, %5C) is refused because it would turn
 * into a folder separator once the address becomes a path.
 * @returns "ask" with the normalised address (the main process then asks the
 *   user), or a plain-language reason.
 */
export function checkLocalFileUrl(raw: string): LocalFileCheck | UrlRefusal {
  const result = parseAllowed(raw, FILE_PROTOCOLS);
  if (isRefused(result)) {
    return result;
  }
  const { url } = result;
  if (url.hostname !== "" || url.pathname.startsWith("//")) {
    return refuse("network-file");
  }
  if (/%(2f|5c)/i.test(url.pathname)) {
    return refuse("invalid");
  }
  return { ok: "ask", kind: "local-file", url: url.href };
}

/** A Windows path with a drive letter: `C:\Music\rain.html` or `C:/Music/rain.html`. */
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i;
/** A network path: `\\server\share` or `//server/share`. */
const NETWORK_PATH = /^(\\\\|\/\/)/;

/**
 * Turn a path pasted from Windows Explorer or a Mac/Linux file manager into a
 * file address, or return undefined when `text` is not such a path. Characters
 * that mean something in an address (`%`, `#`, `?`) are kept as part of the
 * file name.
 */
function pathToFileAddress(text: string): string | undefined {
  const escape = (path: string) =>
    path.replace(/\\/g, "/").replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
  if (NETWORK_PATH.test(text)) {
    return `file:${escape(text)}`;
  }
  if (WINDOWS_DRIVE_PATH.test(text)) {
    return `file:///${escape(text)}`;
  }
  if (text.startsWith("/")) {
    return `file://${escape(text)}`;
  }
  return undefined;
}

function isFileAddress(address: string): boolean {
  try {
    return new URL(address).protocol === "file:";
  } catch {
    return false;
  }
}

/**
 * SEC-6 / SEC-15: check an address the user typed into the URL bar or saved
 * in a bookmark. Removes invisible formatting characters and turns a pasted
 * file path into a file address; otherwise applies the `prependHttp`
 * convenience. Web pages then go through the tab policy; files on this
 * computer come back as "ask" (`isLocalFile`).
 */
export function checkTypedTabUrl(raw: string): UserTabUrlCheck {
  if (typeof raw !== "string") {
    return refuse("invalid");
  }
  const cleaned = raw.replace(FORMAT_CHARACTERS, "").trim();
  if (cleaned === "") {
    return refuse("empty");
  }
  const address = pathToFileAddress(cleaned) ?? prependHttp(cleaned);
  if (isFileAddress(address)) {
    return checkLocalFileUrl(address);
  }
  return checkTabUrl(address);
}
