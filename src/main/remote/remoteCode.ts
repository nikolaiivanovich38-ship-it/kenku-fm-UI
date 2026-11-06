/**
 * SEC-4: the secret code every remote-control request must carry.
 *
 * 20 symbols of Crockford's base32 (digits and letters without I, L, O and U), shown in five groups of four, hold
 * 100 random bits: far too many to guess, even without the rate limit, and still short enough to type into a
 * Stream Deck plugin. Typing mistakes that are easy to make (lower case, no dashes, O for 0, I or L for 1) still
 * match.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SYMBOLS = 20;

/** How a code is shown: AB01-CD23-EF45-GH67-JK89. */
export const REMOTE_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;

export function generateRemoteCode(random: (size: number) => Buffer = randomBytes): string {
  // 13 bytes are 104 bits; the first 100 become 20 five-bit symbols.
  const bytes = random(13);
  let bits = 0;
  let value = 0;
  let symbols = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && symbols.length < SYMBOLS) {
      bits -= 5;
      symbols += ALPHABET[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return symbols.match(/.{4}/g)!.join("-");
}

/** The code as compared: upper case, no spaces or dashes, O read as 0 and I or L as 1. */
export function normaliseRemoteCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/**
 * Whether a typed code is the expected one. Both are hashed first, so the comparison takes the same time whatever
 * the codes hold or how long they are (timingSafeEqual needs equal lengths).
 */
export function codesMatch(typed: string, expected: string): boolean {
  const want = normaliseRemoteCode(expected);
  if (want === "") return false;
  const digest = (text: string) => createHash("sha256").update(text, "utf8").digest();
  return timingSafeEqual(digest(normaliseRemoteCode(typed)), digest(want));
}
