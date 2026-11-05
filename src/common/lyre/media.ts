/**
 * Where a track's audio is, as the player loads it (MediaRequest.url in src/player/engine/sources): a file path
 * becomes a file:// address. The fake and the main-process LyreApi both use this, so they hand out the same address.
 */

/** Escapes one path segment; a drive letter's colon stays as it is. */
const segment = (part: string) => encodeURIComponent(part).replace(/%3A/gi, ":");

/** `H:\Audio\a b.flac` → `file:///H:/Audio/a%20b.flac`; `\\nas\audio\x.wav` → `file://nas/audio/x.wav`; `/home/x.wav` → `file:///home/x.wav`. */
export function fileAddress(path: string): string {
  const network = /^(\\\\|\/\/)/.test(path);
  const parts = path.replace(/^(\\\\|\/\/)/, "").split(/[\\/]/).filter((p, i) => p !== "" || i === 0);
  const joined = parts.map(segment).join("/");
  if (network) return `file://${joined}`;
  return path.startsWith("/") ? `file://${joined}` : `file:///${joined}`;
}
