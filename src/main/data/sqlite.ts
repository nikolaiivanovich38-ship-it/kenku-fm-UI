/**
 * Opens SQLite connections with Node's built-in `node:sqlite` (decision D3).
 *
 * Node marks `node:sqlite` as experimental and prints a warning the first time
 * it loads. The warning says nothing useful to a game master and clutters the
 * log and the test output, so only that one warning is held back here; every
 * other warning still reaches `process.emitWarning`.
 *
 * The module is loaded with `process.getBuiltinModule` rather than a static
 * import so the warning can be caught, and so webpack never has to resolve it.
 */
import type { DatabaseSync } from "node:sqlite";

export type { DatabaseSync, StatementSync, SQLInputValue } from "node:sqlite";

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | undefined;

function isSqliteExperimentalWarning(warning: unknown, rest: unknown[]): boolean {
  const message = warning instanceof Error ? warning.message : String(warning);
  const type = warning instanceof Error ? warning.name : rest[0];
  const typeName = typeof type === "object" && type !== null ? (type as { type?: string }).type : type;
  return typeName === "ExperimentalWarning" && /sqlite/i.test(message);
}

/** Loads `node:sqlite` once, without its "experimental" warning. */
export function loadSqlite(): SqliteModule {
  if (sqliteModule) return sqliteModule;
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function (warning: unknown, ...rest: unknown[]) {
    if (isSqliteExperimentalWarning(warning, rest)) return;
    return (originalEmitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    sqliteModule = process.getBuiltinModule("node:sqlite") as SqliteModule;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
  return sqliteModule;
}

export type ConnectionOptions = {
  /** Open without the right to change anything (used to check backups). */
  readOnly?: boolean;
};

/**
 * Opens a database file (or ":memory:") with the settings the library relies on:
 * - foreign keys on, so links between rows are enforced;
 * - write-ahead logging for files, so a crash mid-write cannot damage the file
 *   and backups can be taken while the app keeps working;
 * - recursive triggers on, so a row replaced by `INSERT OR REPLACE` is still
 *   seen by the undo log and the search index.
 */
export function openConnection(location: string, options: ConnectionOptions = {}): DatabaseSync {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(location, { readOnly: options.readOnly ?? false });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA recursive_triggers = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    if (location !== ":memory:" && !options.readOnly) {
      db.exec("PRAGMA journal_mode = WAL");
      // With WAL, NORMAL keeps the file consistent after a crash; at most the
      // last moment of edits before a power cut can be lost.
      db.exec("PRAGMA synchronous = NORMAL");
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
