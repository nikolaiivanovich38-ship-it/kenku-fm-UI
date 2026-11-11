/**
 * FND-16: Settings › Sound to Discord (Best sound quality or Lighter on the computer) is one of this computer's
 * settings, saved by the library's process in this-computer.json (computerSettings.ts). The main process reads it
 * when the window opens and again whenever the library says the settings changed, and hands it to the capture
 * window's manager, which uses it from the next time a bot joins a voice channel. Until 0.5.0 the old main window
 * kept this setting and sent it over AUDIO_CAPTURE_SET_STREAMING_MODE.
 */
import type { StreamingMode } from "../common/domain";
import type { LyreEvent } from "../common/lyre/api";
import { readComputerSettings } from "./lyreApi/computerSettings";

export interface SoundToDiscordOptions {
  /** This computer's settings file (computerSettingsFile). */
  file: string | null;
  /** Usually AudioCaptureManagerMain.setStreamingMode. */
  apply: (mode: StreamingMode) => void;
}

export class SoundToDiscord {
  private applied: StreamingMode | null = null;

  constructor(private readonly options: SoundToDiscordOptions) {
    this.refresh();
  }

  /** Reads the file again and applies Sound to Discord when it differs from what was applied last. */
  refresh(): void {
    const mode = readComputerSettings(this.options.file).streamingMode;
    if (mode === this.applied) return;
    this.applied = mode;
    this.options.apply(mode);
  }

  /** Give every event of the library here; only a change to the settings is read. */
  onLibraryEvent(event: LyreEvent): void {
    if (event.type === "changed" && event.areas.includes("settings")) this.refresh();
  }
}
