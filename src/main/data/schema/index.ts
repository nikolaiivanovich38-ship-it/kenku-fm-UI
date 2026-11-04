/**
 * Every schema version, in order. Append new steps; never change released ones.
 * Cue lists and pad actions (WPD) will be step 3 or later.
 */
import type { Migration } from "./migrate";
import { v001Initial } from "./v001-initial";
import { v002Design } from "./v002-design";

export const MIGRATIONS: readonly Migration[] = [v001Initial, v002Design];

export { migrate, rebuildTable, schemaVersion, type Migration, type MigrationResult } from "./migrate";
