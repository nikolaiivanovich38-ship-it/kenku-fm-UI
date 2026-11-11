/**
 * Plain input checks at the edge of the data layer. Values come from the
 * interface (later over IPC), so nothing is trusted: each check returns a
 * clean value or throws a ValidationError naming the field.
 */
import { ValidationError } from "./errors";

/** Names, titles and labels. */
export const MAX_NAME_LENGTH = 500;
/** Notes and paths. */
export const MAX_TEXT_LENGTH = 20_000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function plainText(field: string, value: unknown, max: number): string {
  if (typeof value !== "string") throw new ValidationError(field, `${field} must be text.`);
  if (value.length > max) throw new ValidationError(field, `${field} is too long (at most ${max} characters).`);
  if (CONTROL_CHARACTERS.test(value)) throw new ValidationError(field, `${field} contains characters that are not allowed.`);
  return value;
}

/** Text that must not be blank once spaces are trimmed (names, titles). */
export function requiredName(field: string, value: unknown, max = MAX_NAME_LENGTH): string {
  const text = plainText(field, value, max).trim();
  if (text === "") throw new ValidationError(field, `${field} cannot be empty.`);
  return text;
}

/** Text that may be empty (labels, notes). */
export function optionalText(field: string, value: unknown, max = MAX_TEXT_LENGTH): string {
  if (value === undefined || value === null) return "";
  return plainText(field, value, max);
}

/** Text or null (null, undefined and blank become null). */
export function nullableText(field: string, value: unknown, max = MAX_NAME_LENGTH): string | null {
  if (value === undefined || value === null) return null;
  const text = plainText(field, value, max).trim();
  return text === "" ? null : text;
}

/** An id: given by the app or kept from older data. */
export function id(field: string, value: unknown): string {
  const text = plainText(field, value, 200);
  if (text.trim() === "" || text !== text.trim()) throw new ValidationError(field, `${field} is not a valid id.`);
  return text;
}

export function ids(field: string, value: unknown): string[] {
  if (!Array.isArray(value)) throw new ValidationError(field, `${field} must be a list.`);
  return value.map((item, index) => id(`${field}[${index}]`, item));
}

/** A whole number in a range, or null. */
export function nullableInteger(field: string, value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  return integer(field, value, min, max);
}

export function integer(field: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(field, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function numberInRange(field: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(field, `${field} must be a number from ${min} to ${max}.`);
  }
  return value;
}

/** A duration or time position in milliseconds (up to 100 hours). */
export function milliseconds(field: string, value: unknown): number {
  return integer(field, value, 0, 100 * 60 * 60 * 1000);
}

export function boolean(field: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw new ValidationError(field, `${field} must be yes or no (true/false).`);
  return value;
}

export function oneOf<T extends string>(field: string, value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
    throw new ValidationError(field, `${field} must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

export function nullableOneOf<T extends string>(field: string, value: unknown, choices: readonly T[]): T | null {
  if (value === undefined || value === null) return null;
  return oneOf(field, value, choices);
}

/** Design round 7 (DAT-10, ORG-4): the pad palette's colour names, which tag groups, tags and folders take too. */
export const PALETTE_COLORS = ["steel", "ember", "gold", "moss", "violet", "plum", "sea", "bone"] as const;

/** A colour of the pad palette by name (any letter case), or null. */
export function nullablePaletteColor(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const name = typeof value === "string" ? value.toLowerCase() : "";
  if (!(PALETTE_COLORS as readonly string[]).includes(name)) {
    throw new ValidationError(field, `Choose one of the colours: ${PALETTE_COLORS.join(", ")}.`);
  }
  return name;
}

/** A colour as #rrggbb, or null. */
export function nullableColor(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ValidationError(field, `${field} must be a colour written as #rrggbb.`);
  }
  return value.toLowerCase();
}

/** A calendar date YYYY-MM-DD, or null. */
export function nullableDate(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(field, `${field} must be a date written as YYYY-MM-DD.`);
  }
  return value;
}

/** A web address (http or https only). */
export function webAddress(field: string, value: unknown): string {
  const text = plainText(field, value, 4000).trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ValidationError(field, `${field} is not a web address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(field, `${field} must start with http:// or https://.`);
  }
  return text;
}

/** Rejects anything that is not a plain object (patches and inputs). */
export function record(field: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(field, `${field} is missing or not an object.`);
  }
  return value as Record<string, unknown>;
}
