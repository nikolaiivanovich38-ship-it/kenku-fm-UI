/**
 * Every schema version, in order. Append new steps; never change released ones.
 * Version 1 is the whole library as first released (DB review item 8 folded the
 * unreleased steps of waves 1 and 2 into it).
 */
import type { Migration } from "./migrate";
import { v001Library } from "./v001-library";

export const MIGRATIONS: readonly Migration[] = [v001Library];

export { migrate, rebuildTable, schemaVersion, type Migration, type MigrationResult } from "./migrate";
