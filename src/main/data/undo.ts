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
import type { Store } from "./store";

/** Tables that are derived from others or are bookkeeping, never undone directly. */
const NOT_UNDOABLE = new Set(["schema_migrations", "search_docs"]);

export type UndoableTable = { name: string; columns: string[]; primaryKey: string[] };

type Entry = {
  table: string;
  op: "insert" | "update" | "delete";
  /** JSON of the primary key. */
  key: string;
  /** JSON of the old values: the whole row for delete, the changed columns for update. */
  old: string | null;
};

type Step = { label: string; entries: Entry[] };

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
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private tables = new Map<string, UndoableTable>();

  /**
   * Starts following every change made through `store.change()`.
   * @param options.limit steps kept (default 100; EDT-2 asks for at least 50)
   */
  constructor(store: Store, options: { limit?: number } = {}) {
    this.store = store;
    this.limit = options.limit ?? 100;
    this.installTriggers();
    store.setChangeHooks({
      begin: () => this.startCapture(),
      commit: (label) => {
        const entries = this.endCapture();
        if (entries.length === 0) return;
        this.undoStack.push({ label, entries });
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack = [];
      },
      rollback: () => undefined,
    });
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

  /** Applies the opposite of each entry, newest first. */
  private applyInverse(entries: Entry[]) {
    const extract = (param: string, column: string) =>
      `json_extract(${param}, '$."${column.replace(/"/g, '\\"').replace(/'/g, "''")}"')`;
    for (const entry of [...entries].reverse()) {
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
  private replay(step: Step): Step {
    if (this.store.inChange) throw new Error("Cannot undo or redo while a change is running.");
    const db = this.store.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Rows come back in reverse order, so a child may briefly arrive before its parent.
      db.exec("PRAGMA defer_foreign_keys = ON");
      this.startCapture();
      this.applyInverse(step.entries);
      const entries = this.endCapture();
      db.exec("COMMIT");
      return { label: step.label, entries };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Undoes the newest step; returns its label, or null when there is nothing to undo. */
  undo(): string | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    try {
      this.redoStack.push(this.replay(step));
    } catch (error) {
      this.undoStack.push(step);
      throw error;
    }
    return step.label;
  }

  /** Redoes the newest undone step; returns its label, or null when there is nothing to redo. */
  redo(): string | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    try {
      this.undoStack.push(this.replay(step));
    } catch (error) {
      this.redoStack.push(step);
      throw error;
    }
    return step.label;
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
