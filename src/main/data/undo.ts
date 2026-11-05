/**
 * Undo and redo at the data layer (EDT-2).
 *
 * How it works: temporary triggers (they exist only while the app has the
 * library open and are never saved in the file) watch every table the
 * game master's edits touch. While a change runs, each inserted, updated or
 * deleted row is noted with its old values. When the change commits, those
 * notes become one undo step, however many rows it touched, including rows
 * removed by cascades (deleting a track also removes its playlist entries,
 * tags and markers). Undo applies the notes backwards; the rows that changes
 * are noted again and become the redo step.
 *
 * Because the triggers are built from the tables present when the library is
 * opened, tables added by later schema versions are covered automatically.
 * The search index follows by its own triggers and is not part of the history.
 * The history lives in memory: it starts empty each time the library opens.
 */
import type { DatabaseSync } from "./sqlite";
import { nextTurn, rollbackAfter, type Store } from "./store";

/**
 * Rows per transaction when a large step is undone or redone (DB review 1).
 * Each row costs a few hundredths of a millisecond, so a batch stays far below
 * the 200 ms the Discord audio queue holds.
 */
export const UNDO_BATCH_ENTRIES = 500;

/** Tables that are derived from others or are bookkeeping, never undone directly. */
const NOT_UNDOABLE = new Set(["schema_migrations", "search_docs", "track_peaks"]);

export type UndoableTable = { name: string; columns: string[]; primaryKey: string[] };

type Entry = {
  table: string;
  op: "insert" | "update" | "delete";
  /** JSON of the primary key. */
  key: string;
  /** JSON of the old values: the whole row for delete, the changed columns for update. */
  old: string | null;
};

type Step = { label: string; entries: Entry[]; /** Roughly the memory it takes, in bytes. */ bytes: number };

/** Roughly what a step's notes take in memory: their text, two bytes a character, plus bookkeeping. */
function sizeOf(entries: Entry[]): number {
  let chars = 0;
  for (const entry of entries) chars += entry.table.length + entry.key.length + (entry.old?.length ?? 0) + 32;
  return chars * 2;
}

const step = (label: string, entries: Entry[]): Step => ({ label, entries, bytes: sizeOf(entries) });

/** Memory the history may take (DB review 10): deleting 5,000 tracks makes a step of about 20 MB. */
export const UNDO_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

export type UndoState = {
  canUndo: boolean;
  canRedo: boolean;
  /** What Undo would undo, for "Undo Delete 3 tracks". */
  undoLabel: string | null;
  redoLabel: string | null;
};

const quoteName = (name: string) => `"${name.replace(/"/g, '""')}"`;
const jsonObject = (prefix: "NEW" | "OLD", columns: string[]) =>
  `json_object(${columns.map((c) => `'${c.replace(/'/g, "''")}', ${prefix}.${quoteName(c)}`).join(", ")})`;

/** Ordinary tables of the main database that the history follows. */
export function undoableTables(db: DatabaseSync): UndoableTable[] {
  const tables = db.prepare("PRAGMA main.table_list").all() as { name: string; type: string }[];
  return tables
    .filter((table) => table.type === "table" && !table.name.startsWith("sqlite_") && !NOT_UNDOABLE.has(table.name))
    .map((table) => {
      const info = db.prepare(`PRAGMA main.table_info(${quoteName(table.name)})`).all() as { name: string; pk: number }[];
      const primaryKey = info
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      if (primaryKey.length === 0) throw new Error(`Table ${table.name} needs a primary key for undo.`);
      return { name: table.name, columns: info.map((column) => column.name), primaryKey };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class UndoHistory {
  private readonly store: Store;
  private readonly limit: number;
  private readonly batchEntries: number;
  private readonly memoryLimit: number;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private tables = new Map<string, UndoableTable>();
  private recordedSteps = 0;

  /**
   * Starts following every change made through `store.change()` and `store.changeInBatches()`.
   * @param options.limit steps kept (default 100; EDT-2 asks for at least 50)
   * @param options.batchEntries rows per transaction when a large step is undone (default UNDO_BATCH_ENTRIES)
   * @param options.memoryLimitBytes memory the steps may take (default UNDO_MEMORY_LIMIT_BYTES); the newest step is always kept
   */
  constructor(store: Store, options: { limit?: number; batchEntries?: number; memoryLimitBytes?: number } = {}) {
    this.store = store;
    this.limit = options.limit ?? 100;
    this.memoryLimit = options.memoryLimitBytes ?? UNDO_MEMORY_LIMIT_BYTES;
    this.batchEntries = Math.max(1, options.batchEntries ?? UNDO_BATCH_ENTRIES);
    this.installTriggers();
    store.setChangeHooks({
      begin: () => this.startCapture(),
      // The rows are read before COMMIT (they live in the transaction), but
      // the step is recorded only once COMMIT has succeeded: a commit that
      // fails (full disk) leaves no step for a change that never happened.
      commit: (label) => {
        const entries = this.endCapture();
        if (entries.length === 0) return;
        return () => this.record(step(label, entries));
      },
      rollback: () => undefined,
      reset: () => this.clear(),
      // A bulk change: each batch's rows are kept, and become one step at the end.
      takeBatch: () => this.endCapture(),
      recordBatches: (label, batches) => {
        const entries = (batches as Entry[][]).flat();
        if (entries.length > 0) this.record(step(label, entries));
      },
      revertBatches: (batches) => this.putBack((batches as Entry[][]).flat()),
    });
  }

  /** A new step: redo is gone, and the oldest steps go beyond the step and memory limits. */
  private record(done: Step) {
    this.recordedSteps++;
    this.undoStack.push(done);
    this.redoStack = [];
    this.trim();
  }

  private trim() {
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    let bytes = [...this.undoStack, ...this.redoStack].reduce((sum, s) => sum + s.bytes, 0);
    while (bytes > this.memoryLimit && this.undoStack.length > 1) bytes -= (this.undoStack.shift() as Step).bytes;
  }

  /** (Re)creates the temporary capture triggers for the current tables. */
  installTriggers(): void {
    const db = this.store.db;
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS undo_capture_state (active INTEGER NOT NULL);
      CREATE TEMP TABLE IF NOT EXISTS undo_capture (
        seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, op TEXT NOT NULL, key TEXT NOT NULL, old TEXT, new TEXT
      );
      DELETE FROM temp.undo_capture_state;
      INSERT INTO temp.undo_capture_state VALUES (0);
    `);
    const existing = db.prepare("SELECT name FROM temp.sqlite_schema WHERE type = 'trigger' AND name LIKE 'undo\\_%' ESCAPE '\\'").all() as {
      name: string;
    }[];
    for (const trigger of existing) db.exec(`DROP TRIGGER temp.${quoteName(trigger.name)}`);

    this.tables = new Map();
    for (const table of undoableTables(db)) {
      this.tables.set(table.name, table);
      const name = quoteName(table.name);
      const tableText = `'${table.name.replace(/'/g, "''")}'`;
      const active = "(SELECT active FROM temp.undo_capture_state)";
      const changed = table.columns.map((c) => `OLD.${quoteName(c)} IS NOT NEW.${quoteName(c)}`).join(" OR ");
      db.exec(`
        CREATE TEMP TRIGGER ${quoteName(`undo_${table.name}_insert`)} AFTER INSERT ON main.${name} WHEN ${active}
        BEGIN
          INSERT INTO temp.undo_capture (tbl, op, key) VALUES (${tableText}, 'insert', ${jsonObject("NEW", table.primaryKey)});
        END;
        CREATE TEMP TRIGGER ${quoteName(`undo_${table.name}_update`)} AFTER UPDATE ON main.${name} WHEN ${active} AND (${changed})
        BEGIN
          INSERT INTO temp.undo_capture (tbl, op, key, old, new)
            VALUES (${tableText}, 'update', ${jsonObject("NEW", table.primaryKey)},
                    ${jsonObject("OLD", table.columns)}, ${jsonObject("NEW", table.columns)});
        END;
        CREATE TEMP TRIGGER ${quoteName(`undo_${table.name}_delete`)} AFTER DELETE ON main.${name} WHEN ${active}
        BEGIN
          INSERT INTO temp.undo_capture (tbl, op, key, old)
            VALUES (${tableText}, 'delete', ${jsonObject("OLD", table.primaryKey)}, ${jsonObject("OLD", table.columns)});
        END;
      `);
    }
  }

  private startCapture() {
    this.store.db.exec("DELETE FROM temp.undo_capture; UPDATE temp.undo_capture_state SET active = 1;");
  }

  /** Stops noting rows and returns what was noted, oldest first. */
  private endCapture(): Entry[] {
    const db = this.store.db;
    const rows = db.prepare("SELECT tbl, op, key, old, new FROM temp.undo_capture ORDER BY seq").all() as {
      tbl: string;
      op: Entry["op"];
      key: string;
      old: string | null;
      new: string | null;
    }[];
    db.exec("DELETE FROM temp.undo_capture; UPDATE temp.undo_capture_state SET active = 0;");
    return rows.map((row) => {
      if (row.op !== "update") return { table: row.tbl, op: row.op, key: row.key, old: row.old };
      // Keep only the columns this update changed, so undoing it leaves alone
      // anything changed outside the history since (such as "last used").
      const before = JSON.parse(row.old as string) as Record<string, unknown>;
      const after = JSON.parse(row.new as string) as Record<string, unknown>;
      const changed = Object.fromEntries(Object.entries(before).filter(([column, value]) => after[column] !== value));
      return { table: row.tbl, op: row.op, key: row.key, old: JSON.stringify(changed) };
    });
  }

  /** Applies the opposite of each entry, in the order given (callers pass them newest first). */
  private applyInverse(entries: Entry[]) {
    const extract = (param: string, column: string) =>
      `json_extract(${param}, '$."${column.replace(/"/g, '\\"').replace(/'/g, "''")}"')`;
    for (const entry of entries) {
      const table = this.tables.get(entry.table);
      if (!table) throw new Error(`The library no longer has the table "${entry.table}".`);
      const name = quoteName(table.name);
      const where = table.primaryKey.map((c) => `${quoteName(c)} = ${extract("?1", c)}`).join(" AND ");
      if (entry.op === "insert") {
        this.store.run(`DELETE FROM main.${name} WHERE ${where}`, entry.key);
      } else if (entry.op === "delete") {
        const columns = table.columns;
        this.store.run(
          `INSERT INTO main.${name} (${columns.map(quoteName).join(", ")}) VALUES (${columns.map((c) => extract("?1", c)).join(", ")})`,
          entry.old as string,
        );
      } else {
        const columns = Object.keys(JSON.parse(entry.old as string) as object);
        if (columns.length === 0) continue;
        this.store.run(
          `UPDATE main.${name} SET ${columns.map((c) => `${quoteName(c)} = ${extract("?2", c)}`).join(", ")} WHERE ${where}`,
          entry.key,
          entry.old as string,
        );
      }
    }
  }

  /** Replays a step backwards in one transaction and returns the step that reverses it. */
  private replay(done: Step): Step {
    const db = this.store.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Rows come back in reverse order, so a child may briefly arrive before its parent.
      db.exec("PRAGMA defer_foreign_keys = ON");
      this.startCapture();
      this.applyInverse([...done.entries].reverse());
      this.store.beforeCommit();
      const entries = this.endCapture();
      db.exec("COMMIT");
      return step(done.label, entries);
    } catch (error) {
      return rollbackAfter(db, error);
    }
  }

  /** Applies the opposite of `entries` (in the order given) in one transaction; returns what that changed. */
  private applyBatch(entries: Entry[]): Entry[] {
    const db = this.store.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      this.startCapture();
      this.applyInverse(entries);
      this.store.beforeCommit();
      const done = this.endCapture();
      db.exec("COMMIT");
      return done;
    } catch (error) {
      return rollbackAfter(db, error);
    }
  }

  /**
   * Replays a large step backwards in batches of `batchEntries` rows, letting
   * the event loop run between them (DB review 1). A batch cannot wait for a
   * parent row that a later batch brings back, so foreign keys are switched
   * off meanwhile: the step holds every row it changed, cascades included, so
   * replaying it exactly needs none of their actions. If a batch fails, the
   * batches before it are put back and the error is passed on.
   */
  private async replayInBatches(done: Step): Promise<Step> {
    const inverse = [...done.entries].reverse();
    const applied: Entry[][] = [];
    await this.withoutForeignKeys(async () => {
      for (let start = 0; start < inverse.length; start += this.batchEntries) {
        try {
          applied.push(this.applyBatch(inverse.slice(start, start + this.batchEntries)));
        } catch (error) {
          await this.putBack(applied.flat());
          throw error;
        }
        await nextTurn();
      }
    });
    return step(done.label, applied.flat());
  }

  /** Undoes rows saved by a bulk change or a bulk replay that then failed (none of it becomes a step). */
  private async putBack(entries: Entry[]): Promise<void> {
    const inverse = [...entries].reverse();
    await this.withoutForeignKeys(async () => {
      for (let start = 0; start < inverse.length; start += this.batchEntries) {
        this.applyBatch(inverse.slice(start, start + this.batchEntries));
        await nextTurn();
      }
    });
  }

  private async withoutForeignKeys(work: () => Promise<void>): Promise<void> {
    const db = this.store.db;
    const wasOn = (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys === 1;
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      await work();
    } finally {
      if (wasOn) db.exec("PRAGMA foreign_keys = ON");
    }
  }

  private refuseDuringChange() {
    if (this.store.inChange) throw new Error("Cannot undo or redo while a change is running.");
    this.store.refuseWhileBusy();
  }

  /**
   * Replays `step` and puts the step that reverses it on `onto`. A small step
   * is replayed (and its reverse stacked) before this returns; a large one in
   * batches. Resolves to the step's label.
   */
  private run(done: Step, verb: "Undo" | "Redo", onto: () => Step[]): Promise<string> {
    if (done.entries.length <= this.batchEntries) {
      try {
        onto().push(this.replay(done));
        this.trim();
        return Promise.resolve(done.label);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return this.store.exclusive(`${verb} ${done.label}`, async () => {
      onto().push(await this.replayInBatches(done));
      this.trim();
      return done.label;
    });
  }

  /**
   * Undoes the newest step; resolves to its label, or null when there is
   * nothing to undo. A small step is undone before this returns; a large one
   * (thousands of rows) in batches, with edits waiting meanwhile. A step that
   * fails to replay is rolled back and dropped (the promise rejects): putting
   * it back would make every later undo fail on it. Throws at once during a
   * change or while bulk work is being saved.
   */
  undo(): Promise<string | null> {
    this.refuseDuringChange();
    const next = this.undoStack.pop();
    return next ? this.run(next, "Undo", () => this.redoStack) : Promise.resolve(null);
  }

  /** Redoes the newest undone step, like `undo()`; a step that fails is dropped. */
  redo(): Promise<string | null> {
    this.refuseDuringChange();
    const next = this.redoStack.pop();
    return next ? this.run(next, "Redo", () => this.undoStack) : Promise.resolve(null);
  }

  /** How many steps writes have made so far (undo and redo do not count): a write made a step when this grew. */
  get recorded(): number {
    return this.recordedSteps;
  }

  state(): UndoState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    };
  }

  /** Forgets every step (for example after a bulk import). */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
