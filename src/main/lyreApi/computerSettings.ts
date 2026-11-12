/**
 * This computer's settings (round 7, FND-16): Look and feel › Display, Headphones and speakers, keys in other programs
 * and Sound to Discord. Kept beside the library in `this-computer.json`, never in a backup or a .lyre file. The
 * library's process writes the file (libraryApiRound7.ts settings.setComputer); the main process only reads it, to
 * apply Sound to Discord to the capture window (src/main/soundToDiscord.ts). Kept free of the database, so the main
 * process can read it without loading the library.
 */
import fs from "fs";
import path from "path";

import {
  checkDevices,
  checkDisplay,
  checkStreamingMode,
  DEFAULT_DEVICES,
  DEFAULT_DISPLAY,
  DEFAULT_STREAMING_MODE,
  type AudioDevices,
  type DisplaySettings,
  type StreamingMode,
} from "../../common/domain";

/** The file's name, in the library's folder. */
export const THIS_COMPUTER_FILE = "this-computer.json";

/** Where this computer's settings are kept for the library in `libraryFolder`. */
export function computerSettingsFile(libraryFolder: string): string {
  return path.join(libraryFolder, THIS_COMPUTER_FILE);
}

export type ComputerSettings = { display: DisplaySettings; devices: AudioDevices; globalKeys: boolean; streamingMode: StreamingMode };

export const DISPLAY_KEYS = ["density", "textSize", "highContrast"] as const;
export const DEVICE_KEYS = ["airDevice", "previewDevice", "split", "previewEar"] as const;

/** The file as written, or null when it is missing, damaged or not an object. */
function readRaw(file: string | null): Record<string, unknown> | null {
  if (!file) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** This computer's settings from its file, each value checked (a damaged or hand-edited file gives the defaults). */
export function readComputerSettings(file: string | null): ComputerSettings {
  const out: ComputerSettings = { display: { ...DEFAULT_DISPLAY }, devices: { ...DEFAULT_DEVICES }, globalKeys: false, streamingMode: DEFAULT_STREAMING_MODE };
  const r = readRaw(file);
  if (!r) return out;
  const display = typeof r.display === "object" && r.display ? (r.display as Partial<DisplaySettings>) : {};
  const devices = typeof r.devices === "object" && r.devices ? (r.devices as Partial<AudioDevices>) : {};
  for (const key of DISPLAY_KEYS) if (display[key] !== undefined && !checkDisplay({ [key]: display[key] })) (out.display as unknown as Record<string, unknown>)[key] = display[key];
  for (const key of DEVICE_KEYS) if (devices[key] !== undefined && !checkDevices({ [key]: devices[key] })) (out.devices as unknown as Record<string, unknown>)[key] = devices[key];
  if (typeof r.globalKeys === "boolean") out.globalKeys = r.globalKeys;
  if (!checkStreamingMode(r.streamingMode)) out.streamingMode = r.streamingMode as StreamingMode;
  return out;
}

/**
 * Whether the file holds a Sound to Discord choice of its own. False until the game master (or the one-time copy of
 * the old main window's choice, src/main/legacy/oldWindowMove.ts) has chosen one.
 */
export function hasStreamingMode(file: string | null): boolean {
  return !checkStreamingMode(readRaw(file)?.streamingMode);
}
