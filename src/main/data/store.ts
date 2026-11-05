/**
 * The open library database plus the helpers every repository uses:
 * cached prepared statements, a clock, and `change()`, which wraps each
 * edit in one transaction (and, in undo.ts, one undo step).
 *
 * The database runs on the main process, which also feeds Discord's audio
 * from a queue holding 200 ms of sound (DB review item 1). An edit takes well
 * under a millisecond; bulk work (tagging thousands of tracks, deleting a tag
 * group, relinking a moved library) goes through `changeInBatches`, which saves
 * about 500 rows per transaction and lets the event loop run between them,
 * while the undo history still sees one step.
 */
import { LibraryBusyError } from "./errors";
import { SEARCH_FLUSH_LIMIT, flushSearchIndex, installSearchIndex } from "./searchIndex";
import type { DatabaseSync, SQLInputValue, StatementSync } from "./sqlite";

export type StoreOptions = {
  /** Current time in milliseconds; injected so tests control it. */
  now?: () => number;
  /** Search entries rebuilt with a change, at most (default SEARCH_FLUSH_LIMIT); tests use a small one. */
  searchFlushLimit?: number;
};

/**
 * Prepared statements kept (review nice-to-have): an IN list of each new
 * length is a new statement, so the cache drops the least recently used.
 */
export const STATEMENT_CACHE_SIZE = 200;

/** Rows per transaction in bulk work: each batch takes tens of milliseconds at most. */
export const BATCH_SIZE = 500;

/** Lets the event loop run (timers, Discord's audio packets, IPC) before the next batch. */
export const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

type ChangeHooks = {
  /** Called when a top-level change, or one batch of a bulk change, starts (inside its transaction). */
  begin(label: string): void;
  /**
   * Called just before a top-level change commits, while its rows can still
   * be read. Returns what to do once COMMIT has succeeded (nothing happens if
   * COMMIT fails), so a step is never recorded for a change that was lost.
   */
  commit(label: string): (() => void) | void;
  /** Called after a top-level change (or one batch) was rolled back. */
  rollback(): void;
  /** Forget every undo and redo step (see Store.clearHistory). */
  reset?(): void;
  /** Called just before one batch of a bulk change commits: what it changed, kept until the last batch. */
  takeBatch?(): unknown;
  /** Called once every batch of a bulk change is saved: they become one step. */
  recordBatches?(label: string, batches: unknown[]): void;
  /** Called when a batch fails: puts back what the batches saved before it changed. */
  revertBatches?(batches: unknown[]): Promise<void>;
};

/**
 * Ends a failed transaction and passes the original error on. SQLite rolls a
 * transaction back by itself on some errors (a full disk, an I/O error, out of
 * memory); an explicit ROLLBACK would then fail with "no transaction is
 * active" and hide the real reason, so it runs only while one is open.
 */
export function rollbackAfter(db: DatabaseSync, error: unknown): never {
  if (db.isTransaction) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error says more; SQLite has ended the transaction anyway.
    }
  }
  throw error;
}

function rollbackQuietly(db: DatabaseSync) {
  try {
    if (db.isTransaction) db.exec("ROLLBACK");
  } catch {
    // Nothing more to do: the next change rebuilds the entries still waiting.
  }
}

export class Store {
  readonly db: DatabaseSync;
  readonly now: () => number;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  private hooks: ChangeHooks | null = null;
  private job: string | null = null;
  private afterBulkWork: (() => void) | null = null;
  private readonly searchFlushLimit: number;
  private searchCatchUp: Promise<void> | null = null;

  constructor(db: DatabaseSync, options: StoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.searchFlushLimit = Math.max(1, options.searchFlushLimit ?? SEARCH_FLUSH_LIMIT);
    installSearchIndex(db);
  }

  /**
   * Work every transaction does just before COMMIT: rebuilds the search entries
   * of the tracks it changed, once each (searchIndex.ts). Undo calls it too.
   * When one change touched more tracks than one pass rebuilds, the rest
   * follow after it (searchCaughtUp).
   */
  beforeCommit(): void {
    if (flushSearchIndex(this.db, this.searchFlushLimit)) this.catchUpSearch();
  }

  /** Resolves once every changed track's search entry is rebuilt. */
  searchCaughtUp(): Promise<void> {
    return this.searchCatchUp ?? Promise.resolve();
  }

  /** Rebuilds the waiting search entries a pass at a time, with the event loop free between passes. */
  private catchUpSearch(): void {
    if (this.searchCatchUp) return;
    this.searchCatchUp = (async () => {
      let more = true;
      while (more) {
        await nextTurn();
        // A closed library has nothing to catch up; the marks went with its connection.
        if (!this.db.isOpen) return;
        // A change or bulk work in progress rebuilds entries itself before it commits.
        if (this.depth > 0 || this.job !== null || this.db.isTransaction) continue;
        this.db.exec("BEGIN IMMEDIATE");
        try {
          more = flushSearchIndex(this.db, this.searchFlushLimit);
          this.db.exec("COMMIT");
        } catch {
          rollbackQuietly(this.db);
          more = false;
        }
      }
    })().finally(() => {
      this.searchCatchUp = null;
    });
  }

  /** Prepared once per SQL text and reused: most edits run the same few statements. */
  statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement) {
      // Most recently used last (a Map keeps insertion order).
      this.statements.delete(sql);
    } else {
      statement = this.db.prepare(sql);
      if (this.statements.size >= STATEMENT_CACHE_SIZE) this.statements.delete(this.statements.keys().next().value as string);
    }
    this.statements.set(sql, statement);
    return statement;
  }

  /** How many prepared statements are kept. */
  get cachedStatements(): number {
    return this.statements.size;
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

  /** The label of the bulk change (or bulk undo) being saved in batches, or null. */
  get busyWith(): string | null {
    return this.job;
  }

  /** Lets the undo history follow every top-level change. */
  setChangeHooks(hooks: ChangeHooks | null) {
    this.hooks = hooks;
  }

  /** Called after each piece of bulk work, for tidying such as a WAL checkpoint (library.ts). */
  setAfterBulkWork(fn: (() => void) | null) {
    this.afterBulkWork = fn;
  }

  /** Throws LibraryBusyError while a bulk change is being saved. */
  refuseWhileBusy(): void {
    if (this.job !== null) throw new LibraryBusyError(this.job);
  }

  /**
   * Runs async bulk work that no other edit may interleave with: edits,
   * undo and backups are refused (LibraryBusyError) until it ends. Refused
   * itself, synchronously, while a change or other bulk work is running.
   */
  exclusive<T>(label: string, work: () => Promise<T>): Promise<T> {
    if (this.depth > 0) throw new Error("Bulk work cannot start inside a change.");
    this.refuseWhileBusy();
    this.job = label;
    const done = () => {
      this.job = null;
      this.afterBulkWork?.();
    };
    return work().then(
      (value) => {
        done();
        return value;
      },
      (error: unknown) => {
        done();
        throw error;
      },
    );
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
    this.refuseWhileBusy();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    let committed: (() => void) | undefined;
    let result: T;
    try {
      this.hooks?.begin(label);
      result = fn();
      this.beforeCommit();
      const afterCommit = this.hooks?.commit(label);
      committed = typeof afterCommit === "function" ? afterCommit : undefined;
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        rollbackAfter(this.db, error);
      } finally {
        this.hooks?.rollback();
      }
    } finally {
      this.depth = 0;
    }
    committed?.();
    return result;
  }

  /**
   * Bulk work over `items` as one change and one undo step (DB review 1):
   * `fn` gets about `batchSize` (default 500) items at a time, each batch in
   * its own transaction, with the event loop free in between, so Discord's
   * audio keeps flowing. `last` is true for the final batch (do closing work
   * there, such as deleting the tag group whose tags the batches took off).
   * An empty list still runs `fn([], true)` once.
   *
   * - A short list (one batch) is saved at once, before this returns.
   * - Inside another change, all of it becomes part of that change, at once.
   * - Otherwise edits wait (LibraryBusyError) until it ends; if a batch fails,
   *   the batches already saved are put back and the promise rejects.
   * Errors found before any work starts are thrown, not returned as a rejection.
   */
  changeInBatches<T>(
    label: string,
    items: readonly T[],
    fn: (batch: T[], last: boolean) => void,
    options: { batchSize?: number } = {},
  ): Promise<void> {
    const size = Math.max(1, options.batchSize ?? BATCH_SIZE);
    if (this.depth > 0 || items.length <= size) {
      this.change(label, () => fn([...items], true));
      return Promise.resolve();
    }
    return this.exclusive(label, async () => {
      const saved: unknown[] = [];
      for (let start = 0; start < items.length; start += size) {
        const last = start + size >= items.length;
        try {
          saved.push(this.saveBatch(label, () => fn(items.slice(start, start + size), last)));
        } catch (error) {
          await this.hooks?.revertBatches?.(saved);
          throw error;
        }
        if (!last) await nextTurn();
      }
      this.hooks?.recordBatches?.(label, saved);
    });
  }

  /** One transaction of a bulk change; returns what the undo history noted. */
  private saveBatch(label: string, fn: () => void): unknown {
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      this.hooks?.begin(label);
      fn();
      this.beforeCommit();
      const noted = this.hooks?.takeBatch?.();
      this.db.exec("COMMIT");
      return noted;
    } catch (error) {
      try {
        rollbackAfter(this.db, error);
      } finally {
        this.hooks?.rollback();
      }
    } finally {
      this.depth = 0;
    }
  }

  /**
   * Forgets the undo history. Call it after writes made with
   * `changeWithoutHistory` that the game master would see (an import, the move
   * of the old player's library): an older step replayed over them could
   * conflict and be lost (DB review item 10).
   */
  clearHistory(): void {
    if (this.depth > 0) throw new Error("Cannot clear the undo history while a change is running.");
    this.hooks?.reset?.();
  }

  /**
   * Runs `fn` in one transaction that is not recorded for undo: bulk imports,
   * the old player's library moving in, and bookkeeping such as "last used",
   * which Ctrl+Z should not step through.
   *
   * Afterwards the undo history is cleared (DB review 10): an older step
   * replayed over rows written here could clash with them and be lost. Pass
   * `bookkeeping: true` for writes undo never touches (a column no step
   * records, such as last_used_at), which keep the history.
   */
  changeWithoutHistory<T>(fn: () => T, options: { bookkeeping?: boolean } = {}): T {
    if (this.depth > 0) throw new Error("changeWithoutHistory cannot run inside another change.");
    this.refuseWhileBusy();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    let result: T;
    try {
      result = fn();
      this.beforeCommit();
      this.db.exec("COMMIT");
    } catch (error) {
      return rollbackAfter(this.db, error);
    } finally {
      this.depth = 0;
    }
    if (!options.bookkeeping) this.hooks?.reset?.();
    return result;
  }
}
