/**
 * Every schema version, in order. Append new steps; never change released ones.
 * Version 1 is the whole library as first released (DB review item 8 folded the
 * unreleased steps of waves 1 and 2 into it).
 */
import type { Migration } from "./migrate";
import { v001Library } from "./v001-library";
import { v002Peaks } from "./v002-peaks";
import { v003Round5 } from "./v003-round5";
import { v004Loudness } from "./v004-loudness";

export const MIGRATIONS: readonly Migration[] = [v001Library, v002Peaks, v003Round5, v004Loudness];

export { migrate, rebuildTable, schemaVersion, type Migration, type MigrationResult } from "./migrate";
