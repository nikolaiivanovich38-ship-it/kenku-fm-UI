/**
 * SEC-8: argument checks for messages the app's pages send to the main
 * process. A page that has been tricked into sending odd values (strings for
 * ids, huge strings, objects) is refused at the boundary instead of reaching
 * Electron APIs. Free of Electron imports so it can be unit-tested.
 */

/** Checks one argument. */
export type ArgCheck = (value: unknown) => boolean;

/** Checks a message's whole argument list. */
export type ArgsCheck = (args: readonly unknown[]) => boolean;

/**
 * Longest address Chromium will load (url/url_constants.h `kMaxURLChars`).
 * Anything Chromium could open is accepted, so no legitimate tab is refused.
 */
export const MAX_URL_LENGTH = 2 * 1024 * 1024;

/** Ids of web contents (tabs, the player view) as Electron hands them out, plus -1 for "refused". */
export const isWebContentsId: ArgCheck = (value) => Number.isSafeInteger(value);

export const isFiniteNumber: ArgCheck = (value) =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean: ArgCheck = (value) => typeof value === "boolean";

/** A string of at most `maxLength` characters. */
export function isStringUpTo(maxLength: number): ArgCheck {
  return (value) => typeof value === "string" && value.length <= maxLength;
}

/** An integer between `min` and `max` inclusive. */
export function isIntegerIn(min: number, max: number): ArgCheck {
  return (value) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Exactly one of the given values. */
export function isOneOf(...allowed: readonly unknown[]): ArgCheck {
  return (value) => allowed.includes(value);
}

/** A plain object (not null, not an array): the remote API replies from the player. */
export const isPlainObject: ArgCheck = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `check`, or the argument left out. */
export function optional(check: ArgCheck): ArgCheck {
  return (value) => value === undefined || check(value);
}

/**
 * The argument list matches `checks` position by position. Trailing optional
 * arguments may be left out; extra arguments are refused.
 */
export function argsMatch(...checks: readonly ArgCheck[]): ArgsCheck {
  return (args) =>
    args.length <= checks.length && checks.every((check, index) => check(args[index]));
}

/** For channels that carry no arguments. */
export const noArgs: ArgsCheck = argsMatch();
