/**
 * The library's integrity check (PRAGMA quick_check), on the calling thread
 * or on a worker thread.
 *
 * quick_check reads every page of the file: about 300 ms for a library of
 * 20,000 tracks on a modest machine. Run on a worker thread with its own
 * read-only connection, it does not hold up start-up; write-ahead logging lets
 * it read while the app keeps working.
 *
 * The worker's code is a string (an "eval" worker), so webpack has no extra
 * file to bundle and the packaged app needs no extra entry point.
 */
import { Worker } from "worker_threads";
import type { DatabaseSync } from "./sqlite";

/** `detail` says what is wrong; empty when ok. */
export type IntegrityResult = { ok: boolean; detail: string };

/** Runs the check on an open connection (blocks until done). */
export function quickCheck(db: DatabaseSync): IntegrityResult {
  const rows = db.prepare("PRAGMA quick_check(1)").all() as { quick_check: string }[];
  return rows.length === 1 && rows[0].quick_check === "ok"
    ? { ok: true, detail: "" }
    : { ok: false, detail: rows.map((row) => row.quick_check).join("; ") };
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("worker_threads");
// Hold back Node's "SQLite is experimental" warning, as sqlite.ts does.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (/sqlite/i.test(String((warning && warning.message) || warning))) return;
  return emitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
process.emitWarning = emitWarning;
function check(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("PRAGMA quick_check(1)").all();
    const ok = rows.length === 1 && rows[0].quick_check === "ok";
    return { ok, detail: ok ? "" : rows.map((row) => row.quick_check).join("; ") };
  } catch (error) {
    return { ok: false, detail: String((error && error.message) || error) };
  } finally {
    if (db) db.close();
  }
}
const library = workerData.library ? check(workerData.library) : null;
let latestGoodBackup = null;
if (!library || !library.ok) {
  latestGoodBackup = workerData.backups.find((path) => check(path).ok) ?? null;
}
parentPort.postMessage({ library, latestGoodBackup });
`;

/** The opening of every worker's code: holds back Node's "SQLite is experimental" warning, as sqlite.ts does. */
export const WORKER_PRELUDE = `
const { parentPort, workerData } = require("worker_threads");
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (/sqlite/i.test(String((warning && warning.message) || warning))) return;
  return emitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
process.emitWarning = emitWarning;
`;

/**
 * Runs `source` (after WORKER_PRELUDE; it posts one message) on a worker
 * thread with `data` as workerData, and resolves to that message. Rejects if
 * the worker fails or stops without answering. The worker never keeps the app
 * running. Used for backups and WAL checkpoints (DB review 1, 6).
 */
export function runInWorker<T>(source: string, data: unknown): Promise<T> {
  const worker = new Worker(WORKER_PRELUDE + source, { eval: true, workerData: data });
  worker.unref();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    worker.once("message", (message: T) => {
      settled = true;
      resolve(message);
    });
    worker.once("error", (error: Error) => {
      settled = true;
      reject(error);
    });
    worker.once("exit", () => {
      if (!settled) reject(new Error("The background task stopped before it finished."));
    });
  });
}

/** What a check on the worker thread found. */
export type BackgroundCheck = {
  /** The library's result, or null when only backups were checked. */
  library: IntegrityResult | null;
  /**
   * The first of `backups` that passes the same check, or null. Looked for
   * only when the library is damaged (or not checked), so a healthy start
   * costs one check.
   */
  latestGoodBackup: string | null;
};

/**
 * Starts checks on a worker thread: the library (if given) and, when it is
 * damaged, the backups in the order given (newest first), so damaged backups
 * never hold up the main process either. `result` always resolves (never
 * rejects); after `cancel()` it resolves to "cancelled".
 */
export function checkInBackground(job: { library?: string; backups: string[] }): {
  result: Promise<BackgroundCheck | "cancelled">;
  cancel(): void;
} {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { library: job.library ?? null, backups: job.backups },
  });
  // Never keep the app running just for this check.
  worker.unref();
  let settled = false;
  let cancelled = false;
  const failed = (detail: string): BackgroundCheck => ({
    library: job.library ? { ok: false, detail } : null,
    latestGoodBackup: null,
  });
  const result = new Promise<BackgroundCheck | "cancelled">((resolve) => {
    const finish = (value: BackgroundCheck | "cancelled") => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    worker.once("message", (message: BackgroundCheck) => finish(message));
    worker.once("error", (error: Error) => finish(failed(error.message)));
    worker.once("exit", () => finish(cancelled ? "cancelled" : failed("The check stopped before it finished.")));
  });
  return {
    result,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      void worker.terminate();
    },
  };
}
