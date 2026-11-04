/**
 * Shared helpers for the data-layer tests: temporary folders and quick
 * database set-up. Test-only; never imported by app code.
 */
import fs from "fs";
import os from "os";
import path from "path";

/** Creates an empty temporary folder; `cleanup()` removes it again. */
export function makeTempFolder(prefix = "cue-desk-data-") {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    folder,
    cleanup: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
}

/** A clock the test moves by hand, so stored times are predictable. */
export function makeClock(start = Date.UTC(2026, 10, 4, 9, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}
