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
let db;
try {
  db = new DatabaseSync(workerData.path, { readOnly: true });
  const rows = db.prepare("PRAGMA quick_check(1)").all();
  const ok = rows.length === 1 && rows[0].quick_check === "ok";
  parentPort.postMessage({ ok, detail: ok ? "" : rows.map((row) => row.quick_check).join("; ") });
} catch (error) {
  parentPort.postMessage({ ok: false, detail: String((error && error.message) || error) });
} finally {
  if (db) db.close();
}
`;

/**
 * Starts the check on a worker thread. `result` always resolves (never
 * rejects); after `cancel()` it resolves to "cancelled".
 */
export function quickCheckInBackground(databasePath: string): {
  result: Promise<IntegrityResult | "cancelled">;
  cancel(): void;
} {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { path: databasePath } });
  // Never keep the app running just for this check.
  worker.unref();
  let settled = false;
  let cancelled = false;
  const result = new Promise<IntegrityResult | "cancelled">((resolve) => {
    const finish = (value: IntegrityResult | "cancelled") => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    worker.once("message", (message: IntegrityResult) => finish(message));
    worker.once("error", (error: Error) => finish({ ok: false, detail: error.message }));
    worker.once("exit", () =>
      finish(cancelled ? "cancelled" : { ok: false, detail: "The check stopped before it finished." }),
    );
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
