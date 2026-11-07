/**
 * SEC-4: the secret code every remote-control request must carry.
 *
 * Lead decision (7 Nov, B6-NOTES): 8 symbols from an alphabet with nothing that looks alike (no 0 or O, no 1, I or
 * L), shown as two groups of four ("K7QD-92XF"), because Nik reads it off the screen and types it on a phone. 31^8 is
 * about 8.5 × 10^11 codes (39 bits); with ten wrong codes in ten minutes locking a device out (rateLimit.ts), guessing
 * one on a home network would take thousands of years. Each symbol comes from crypto.randomInt, which has no modulo
 * bias. Lower case, spaces and a missing dash still match.
 */
import { createHash, randomInt, timingSafeEqual } from "crypto";

/** A to Z without I, L and O, then 2 to 9. */
export const REMOTE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SYMBOLS = 8;

/** How a code is shown: K7QD-92XF. */
export const REMOTE_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

/** `random(below)` answers a whole number from 0 to below - 1 (crypto.randomInt in the app; tests give their own). */
export function generateRemoteCode(random: (below: number) => number = randomInt): string {
  let symbols = "";
  for (let i = 0; i < SYMBOLS; i++) symbols += REMOTE_CODE_ALPHABET[random(REMOTE_CODE_ALPHABET.length)];
  return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

/** The code as compared: upper case, without spaces or dashes. */
export function normaliseRemoteCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "");
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
