/**
 * Every schema version, in order. Append new steps; never change released ones.
 * Cue lists, pads and cue actions (WPD) will be step 2 or later.
 */
import type { Migration } from "./migrate";
import { v001Initial } from "./v001-initial";

export const MIGRATIONS: readonly Migration[] = [v001Initial];

export { migrate, rebuildTable, schemaVersion, type Migration, type MigrationResult } from "./migrate";
