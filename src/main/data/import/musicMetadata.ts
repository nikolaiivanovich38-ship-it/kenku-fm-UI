/**
 * DAT-5: the real tag reader, music-metadata (MIT, pure JavaScript). Imported only by the library's own process
 * (libraryProcessCore.ts), never by the main process.
 *
 * music-metadata is ESM-only: its package exports name no "require" entry, so the CommonJS `require` this file
 * compiles to cannot be resolved by webpack's usual rules. webpack.main.config.js points "music-metadata" at its
 * Node entry file (an alias), and webpack bundles it as ESM (its parsers become chunks beside lyreLibrary.js).
 * Vitest runs this file as ESM and imports the package natively, so the tests use the same library.
 */
import { parseFile } from "music-metadata";

import { createMusicMetadataTagReader, type TagReader } from "./tagReader";

export const musicMetadataTagReader: TagReader = createMusicMetadataTagReader(parseFile);
