/**
 * Versioned schema with automatic upgrades (DAT-6).
 *
 * Each upgrade is a numbered step (1, 2, 3 …) that runs once. The steps that
 * have run are recorded in `schema_migrations` (also mirrored in
 * `PRAGMA user_version` so other tools can see the version).
 *
 * Every step runs in its own transaction with foreign-key enforcement paused,
 * so a step may rebuild a table the way the SQLite manual describes
 * ("Making Other Kinds Of Table Schema Changes"). Before the step commits,
 * `PRAGMA foreign_key_check` must come back empty; otherwise the step is rolled
 * back. A failed step leaves the database exactly as it was before that step.
 *
 * Rule for later versions: never edit a step that has been released; add a new one.
 */
import type { DatabaseSync } from "../sqlite";
import { LibraryDatabaseError } from "../errors";

export type Migration = {
  /** 1 for the first schema, then 2, 3 … with no gaps. */
  version: number;
  /** Short description, shown in error messages and stored with the version. */
  name: string;
  /** Applies the change. Runs inside a transaction; throw to abort. */
  up(db: DatabaseSync, context: MigrationContext): void;
};

export type MigrationContext = {
  /** Current time in milliseconds, for rows a step creates. */
  now: number;
};

export type MigrationResult = {
  /** Version before the upgrade (0 for a new, empty file). */
  from: number;
  to: number;
  /** Versions applied by this call, in order. */
  applied: number[];
};

function ensureMigrationsTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

/** The newest version recorded in the database (0 when none). */
export function schemaVersion(db: DatabaseSync): number {
  ensureMigrationsTable(db);
  const row = db.prepare("SELECT coalesce(max(version), 0) AS version FROM schema_migrations").get() as {
    version: number;
  };
  return row.version;
}

function checkNumbering(migrations: readonly Migration[]) {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Schema upgrades must be numbered 1, 2, 3 … in order; found ${migration.version} at position ${index + 1}.`,
      );
    }
  });
}

/**
 * Changes a table in ways ALTER TABLE cannot (new constraints, changed or
 * dropped columns): creates the new table, copies the rows, swaps it in, then
 * recreates the table's indexes and every trigger. Triggers are dropped first
 * because SQLite rechecks them when a table is renamed, and the search triggers
 * refer to most tables. For use inside a later migration step only.
 *
 * @param columnDefinitions everything between the brackets of CREATE TABLE
 * @param copiedColumns columns that exist in both the old and the new table
 */
export function rebuildTable(db: DatabaseSync, table: string, columnDefinitions: string, copiedColumns: string[]) {
  const schemaSql = (type: string, tableFilter: string | null) =>
    (
      db
        .prepare(
          `SELECT sql FROM sqlite_schema WHERE type = ? AND sql IS NOT NULL ${tableFilter ? "AND tbl_name = ?" : ""}`,
        )
        .all(...(tableFilter ? [type, tableFilter] : [type])) as { sql: string }[]
    ).map((row) => row.sql);
  const triggerNames = (
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'").all() as { name: string }[]
  ).map((row) => row.name);
  const triggers = schemaSql("trigger", null);
  const indexes = schemaSql("index", table);

  for (const name of triggerNames) db.exec(`DROP TRIGGER "${name}"`);
  const columns = copiedColumns.map((column) => `"${column}"`).join(", ");
  db.exec(`CREATE TABLE "${table}__rebuild" (${columnDefinitions})`);
  db.exec(`INSERT INTO "${table}__rebuild" (${columns}) SELECT ${columns} FROM "${table}"`);
  db.exec(`DROP TABLE "${table}"`);
  db.exec(`ALTER TABLE "${table}__rebuild" RENAME TO "${table}"`);
  for (const sql of indexes) db.exec(sql);
  for (const sql of triggers) db.exec(sql);
}

/** Brings the database up to the newest version in `migrations`. */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
  clock: () => number = Date.now,
): MigrationResult {
  checkNumbering(migrations);
  const from = schemaVersion(db);
  const latest = migrations.length;
  if (from > latest) {
    throw new LibraryDatabaseError(
      "newer-version",
      `This library was saved by a newer version of Cue Desk (library version ${from}, this app knows up to ${latest}). ` +
        "Update Cue Desk to open it. Nothing has been changed.",
    );
  }

  const applied: number[] = [];
  const foreignKeysWereOn = (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1;
  // Can only be changed outside a transaction.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const migration of migrations.slice(from)) {
      db.exec("BEGIN IMMEDIATE");
      try {
        migration.up(db, { now: clock() });
        const broken = db.prepare("PRAGMA foreign_key_check").all();
        if (broken.length > 0) {
          throw new Error(`${broken.length} row(s) would point at rows that do not exist.`);
        }
        db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          migration.version,
          migration.name,
          clock(),
        );
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        db.exec("ROLLBACK");
        throw new LibraryDatabaseError(
          "upgrade-failed",
          `Cue Desk could not upgrade your library to version ${migration.version} ("${migration.name}"). ` +
            "Your library has been left as it was. " +
            (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }
  } finally {
    if (foreignKeysWereOn) db.exec("PRAGMA foreign_keys = ON");
  }
  return { from, to: schemaVersion(db), applied };
}
