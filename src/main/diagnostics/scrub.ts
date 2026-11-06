/**
 * FND-9: what Save diagnostics takes out before anything is written (docs/security.md "w4-guide"): Discord bot
 * tokens wherever they appear, every value whose name says it is secret, and the user's home folder in paths
 * (written as "~", so a file path no longer names the person).
 */

/** A Discord bot token: three base64url parts, the first the bot's id (at least 17 digits, so 23+ characters). */
const DISCORD_TOKEN = /[\w-]{23,}\.[\w-]{6,7}\.[\w-]{27,}/g;
/** Names of values that hold secrets ("token", "botToken", "clientSecret", "apiKey", "password", "authorization"). */
const SECRET_NAME = /token|secret|passw|credential|api[-_]?key|private[-_]?key|auth/i;

export interface ScrubOptions {
  /** The user's home folder (os.homedir()). */
  home: string;
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The home folder, with either kind of slash and in any case, when it is followed by a slash or ends the path. */
function homePattern(home: string): RegExp | null {
  const trimmed = home.replace(/[\\/]+$/, "");
  if (trimmed.length < 3) return null;
  const parts = trimmed.split(/[\\/]+/).map(escapeForRegExp);
  return new RegExp(`${parts.join("[\\\\/]+")}(?=[\\\\/]|$|[^\\w.-])`, "gi");
}

export function scrubText(text: string, options: ScrubOptions): string {
  let out = text.replace(DISCORD_TOKEN, "[token removed]");
  const home = homePattern(options.home);
  if (home) out = out.replace(home, "~");
  return out;
}

/** A copy of `value` (JSON data) with secrets replaced by "[removed]" and every text scrubbed. */
export function scrubValue(value: unknown, options: ScrubOptions): unknown {
  if (typeof value === "string") return scrubText(value, options);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, options));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[scrubText(key, options)] = SECRET_NAME.test(key) ? "[removed]" : scrubValue(v, options);
    }
    return out;
  }
  return value;
}
