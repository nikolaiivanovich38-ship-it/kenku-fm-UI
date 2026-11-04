/**
 * Bringing audio into the library (import stream, wave 2): adding files and
 * folders (EDT-6), embedded tags (DAT-5), moving the old player's library in
 * (DAT-9), finding and relinking moved files (DAT-8) and suggestions from
 * descriptive titles (DAT-4). Reached by tests now and by the new interface in
 * wave 3; nothing here is wired into the old player. See docs/data-model.md.
 */
export { AUDIO_EXTENSIONS, isAudioFile, collectAudioFiles, type FoundFile, type ImportProblem } from "./audioFiles";
export { guessKind } from "./kindGuess";
export { readFileFacts, QUICK_CHECKSUM_BYTES } from "./fileFacts";
export {
  noTagReader,
  createMusicMetadataTagReader,
  titleFromFileName,
  type EmbeddedTags,
  type TagReader,
  type MusicMetadataResult,
  type ParseFile,
} from "./tagReader";
export {
  importAudio,
  refreshEmbeddedTags,
  describeImport,
  BATCH,
  type ImportOptions,
  type ImportProgress,
  type ImportResult,
} from "./pipeline";
export {
  importLegacyLibrary,
  parseLegacyPlayerState,
  legacyLocation,
  LEGACY_JOB,
  type LegacyImportOptions,
  type LegacyImportReport,
  type LegacyPlayerState,
} from "./legacy";
export { findMissingTracks, planRelink, applyRelink, type MissingTrack, type RelinkMatch, type RelinkPlan } from "./relink";
export { suggestFromTitles, applyTitleSuggestions, type TitleSuggestion, type AcceptedSuggestion } from "./titleTags";
