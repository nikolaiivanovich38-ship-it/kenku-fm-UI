/**
 * The open library database plus the helpers every repository uses:
 * cached prepared statements, a clock, and `change()`, which wraps each
 * edit in one transaction (and, in undo.ts, one undo step).
 */
import type { DatabaseSync, SQLInputValue, StatementSync } from "./sqlite";

export type StoreOptions = {
  /** Current time in milliseconds; injected so tests control it. */
  now?: () => number;
};

type ChangeHooks = {
  /** Called when a top-level change starts (inside its transaction). */
  begin(label: string): void;
  /** Called just before a top-level change commits. */
  commit(label: string): void;
  /** Called after a top-level change was rolled back. */
  rollback(): void;
};

export class Store {
  readonly db: DatabaseSync;
  readonly now: () => number;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  private hooks: ChangeHooks | null = null;

  constructor(db: DatabaseSync, options: StoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
  }

  /** Prepared once per SQL text and reused: most edits run the same few statements. */
  statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.statement(sql).run(...params).changes);
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  /** True while a change is running. */
  get inChange(): boolean {
    return this.depth > 0;
  }

  /** Lets the undo history follow every top-level change. */
  setChangeHooks(hooks: ChangeHooks | null) {
    this.hooks = hooks;
  }

  /**
   * Runs `fn` as one change with a plain-language `label` ("Delete 3 tracks").
   * All of it is saved, or none of it. A change started inside another change
   * becomes part of the outer one.
   */
  change<T>(label: string, fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      this.hooks?.begin(label);
      const result = fn();
      this.hooks?.commit(label);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.hooks?.rollback();
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  /**
   * Runs `fn` in one transaction that is not recorded for undo: bulk imports and
   * bookkeeping such as "last used", which Ctrl+Z should not step through.
   */
  changeWithoutHistory<T>(fn: () => T): T {
    if (this.depth > 0) throw new Error("changeWithoutHistory cannot run inside another change.");
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth = 0;
    }
  }
}
