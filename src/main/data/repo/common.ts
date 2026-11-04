/** Small helpers shared by the repository modules. */
import { randomUUID } from "crypto";
import { NotFoundError, ValidationError } from "../errors";
import type { Store } from "../store";
import * as v from "../validate";

/** A new id, or the given one after checking it. */
export function newId(given?: unknown): string {
  return given === undefined ? randomUUID() : v.id("id", given);
}

/** Throws NotFoundError unless a row with `id` exists in `table`. */
export function requireRow(store: Store, table: string, entity: string, id: unknown): string {
  const checked = v.id(`${entity} id`, id);
  if (!store.get(`SELECT 1 AS found FROM ${table} WHERE id = ?`, checked)) throw new NotFoundError(entity, checked);
  return checked;
}

/** Runs `fn`, turning a UNIQUE constraint failure into a plain "already exists" message. */
export function unique<T>(field: string, what: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new ValidationError(field, `${what} already exists.`);
    }
    throw error;
  }
}

/** SQLite has no boolean type; 0 and 1 are stored. */
export const toFlag = (value: boolean) => (value ? 1 : 0);

/** "1 track" / "3 tracks", for undo labels. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Checks the patch is an object and has only the listed keys. */
export function patchOf(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const patch = v.record("changes", value);
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) throw new ValidationError(key, `${key} cannot be changed here.`);
  }
  return patch;
}

/** `?, ?, ?` for an IN list. */
export const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");
