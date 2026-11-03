/**
 * FND-4: a throw-away data folder for automated end-to-end tests.
 *
 * When `CUE_DESK_USER_DATA_DIR` holds an absolute folder, the app keeps all
 * its data there and skips the Kenku FM carry-over, so a test run never reads
 * or changes a real library. Kept free of Electron imports so it can be tested.
 */
import path from "path";
import type { CarryOverResult } from "./carryOver";

/** Environment variable naming the data folder for a test run. */
export const USER_DATA_DIR_ENV = "CUE_DESK_USER_DATA_DIR";

/** The test data folder, or null when the app should use its normal folder. */
export function userDataOverride(env: NodeJS.ProcessEnv): string | null {
  const value = env[USER_DATA_DIR_ENV]?.trim();
  if (!value || !path.isAbsolute(value)) {
    return null;
  }
  return path.normalize(value);
}

/** The carry-over result reported when a test data folder is in use. */
export function skippedCarryOver(destDir: string): CarryOverResult {
  return {
    status: "no-old-data",
    sourceDir: "",
    destDir,
    copiedItems: [],
    skippedItems: [{ item: "*", reason: `${USER_DATA_DIR_ENV} is set` }],
    fileCount: 0,
    errors: [],
  };
}
