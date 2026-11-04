/**
 * Every schema version, in order. Append new steps; never change released ones.
 * Cue lists and pad actions (WPD) will be step 4 or later.
 */
import type { Migration } from "./migrate";
import { v001Initial } from "./v001-initial";
import { v002Design } from "./v002-design";
import { v003Import } from "./v003-import";

export const MIGRATIONS: readonly Migration[] = [v001Initial, v002Design, v003Import];

export { migrate, rebuildTable, schemaVersion, type Migration, type MigrationResult } from "./migrate";
