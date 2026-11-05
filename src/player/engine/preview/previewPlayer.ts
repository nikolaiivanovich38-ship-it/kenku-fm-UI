/**
 * PRV-1: preview in the game master's headphones. Matches the prototype's
 * L.preview / L.previewPlaylist / L.previewPad / L.stopPreview
 * (design/prototype/src/core.js):
 *
 * - one preview at a time: starting another stops the one playing;
 * - pressing Preview again on the item that is previewing stops it;
 * - a track plays itself, a playlist its first track, a pad its sound;
 * - the change is announced in plain words for the screen reader's live
 *   region ("Previewing in your headphones: Tavern", "Preview stopped"),
 *   unless the item is quiet (the Audio profile says its own sentences);
 * - while it plays, where it is in its file is sent about twenty times a
 *   second ("position"), so the Audio profile's playhead follows the sound;
 * - it can be paused and carried on, and its headphone volume is kept from
 *   one preview to the next (UX-16, the Now playing bar's preview row).
 *
 * Preview voices are made in the PreviewOutput's context and connect only to
 * its input, never to the engine's mixer, so nothing previewed can reach the
 * table mix that Discord records.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { DomainLookup, DomainPlaylist, DomainTrack, playlistTracks } from "../../../common/domain";
import { browserScheduler, GainLike, Scheduler } from "../audio/types";
import type { PlayableSource } from "../sources/layers";
import type { MediaRequest } from "../sources/sourceLoader";
import { Voice, VoiceOptions } from "../voice/voice";
import type { PreviewOutput } from "./previewOutput";

export interface PreviewItem {
  /** Track id, "pl:<playlist id>" or "pad:<board id>/<pad id>", as in the prototype. */
  key: string;
  /** What the announcement and the "Previewing:" line call it. */
  label: string;
  media: MediaRequest;
  options?: VoiceOptions;
  /** Announce nothing for this item (the screen that started it says what happens). */
  quiet?: boolean;
  /** What it is, and the track it plays (a playlist's first track, a pad's first sound). */
  kind?: PreviewKind;
  trackId?: string | null;
  playlistId?: string | null;
  /** "<board id>/<pad id>" for a pad. */
  padKey?: string | null;
  /** Where the game master started it, in words a screen gives ("the session planner"). */
  from?: string | null;
}

export type PreviewKind = "track" | "playlist" | "pad";

export interface PreviewState {
  key: string;
  label: string;
  kind: PreviewKind;
  trackId: string | null;
  playlistId: string | null;
  padKey: string | null;
  from: string | null;
  paused: boolean;
  /** PLY-15: the normalising gain it plays at, in dB, the same the players would hear (0: as it is). */
  gainDb: number;
}

interface PreviewEvents {
  /** What is previewing now (null: nothing), with a sentence for the live region. */
  change: (state: PreviewState | null, announcement: string) => void;
  /** A preview could not play (sent before its "change", quiet or not), with the reason in plain words. */
  failed: (key: string, message: string) => void;
  /** Where the preview is in its file, in seconds, sent every POSITION_MS while it plays. */
  position: (key: string, seconds: number) => void;
}

/** A switch or a stop fades this fast, so it does not click. */
const STOP_FADE_SECONDS = 0.1;
/** How long a change of the headphone volume takes. */
const VOLUME_RAMP_SECONDS = 0.05;
/** How often the position is sent while a preview plays (about the screen's frame rate for a playhead). */
const POSITION_MS = 50;

export class PreviewPlayer extends TypedEmitter<PreviewEvents> {
  private readonly output: PreviewOutput;
  private readonly scheduler: Scheduler;
  private readonly load: (request: MediaRequest) => Promise<PlayableSource>;
  private voice: Voice | null = null;
  private state: PreviewState | null = null;
  /** The headphone volume: every preview voice plays through it, so it holds from one preview to the next. */
  private readonly gain: GainLike;
  private volumeLevel = 1;
  private positionTimer: unknown = null;
  /** The item previewing now is quiet: its stop is not announced either. */
  private quiet = false;

  constructor(options: {
    output: PreviewOutput;
    /** Makes sources in the output's context: a SourceLoader built on `output.context`. */
    load: (request: MediaRequest) => Promise<PlayableSource>;
    scheduler?: Scheduler;
  }) {
    super();
    this.output = options.output;
    this.load = options.load;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.gain = this.output.context.createGain() as GainLike;
    this.gain.connect(this.output.input);
  }

  /** The headphone volume, 0 to 1. */
  volume(): number {
    return this.volumeLevel;
  }

  /** Sets the headphone volume (kept between 0 and 1). */
  setVolume(volume: number): void {
    const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    if (v === this.volumeLevel) return;
    // A short ramp, so moving the slider never clicks.
    const now = this.output.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.volumeLevel, now);
    this.gain.gain.linearRampToValueAtTime(v, now + VOLUME_RAMP_SECONDS);
    this.volumeLevel = v;
    this.emit("change", this.current(), "");
  }

  /** The previewing voice's length in seconds, once known. */
  length(): number | null {
    return this.voice && Number.isFinite(this.voice.duration) ? this.voice.duration : null;
  }

  /** Pauses the preview, or carries on if it is paused. False when nothing previews. */
  togglePause(): boolean {
    if (!this.voice || !this.state) return false;
    if (this.state.paused) {
      this.voice.resume();
      this.state = { ...this.state, paused: false };
    } else {
      this.voice.pause();
      this.state = { ...this.state, paused: true };
    }
    this.emit("change", this.current(), this.quiet ? "" : this.state.paused ? "Preview paused" : `Previewing in your headphones: ${this.state.label}`);
    return true;
  }

  /** PLY-15: the normalising gain changed where the preview plays from (the library's setting or a choice). */
  setGainDb(db: number): void {
    if (!this.voice || !this.state) return;
    this.voice.setGainDb(db);
    if (this.state.gainDb === this.voice.gainDb) return;
    this.state = { ...this.state, gainDb: this.voice.gainDb };
    this.emit("change", this.current(), "");
  }

  current(): PreviewState | null {
    return this.state ? { ...this.state } : null;
  }

  isPreviewing(key: string): boolean {
    return this.state?.key === key;
  }

  /** Where the preview is in its file now; null while nothing previews. */
  position(): { key: string; seconds: number } | null {
    return this.voice && this.state ? { key: this.state.key, seconds: this.voice.position() } : null;
  }

  /** What a Preview button does: start this item, or stop it if it is the one previewing. */
  toggle(item: PreviewItem): void {
    if (this.isPreviewing(item.key)) {
      this.stop();
    } else {
      this.play(item);
    }
  }

  play(item: PreviewItem): void {
    this.halt(STOP_FADE_SECONDS);
    const voice = new Voice(
      { context: this.output.context, scheduler: this.scheduler, destination: this.gain },
      this.load(item.media),
      item.options ?? {},
      { id: `preview:${item.key}` },
    );
    this.voice = voice;
    this.state = {
      key: item.key,
      label: item.label,
      kind: item.kind ?? (item.key.startsWith("pad:") ? "pad" : item.key.startsWith("pl:") ? "playlist" : "track"),
      trackId: item.trackId ?? item.media.trackId ?? null,
      playlistId: item.playlistId ?? null,
      padKey: item.padKey ?? null,
      from: item.from ?? null,
      paused: false,
      gainDb: voice.gainDb,
    };
    this.quiet = !!item.quiet;
    voice.on("state", () => {
      if (this.voice !== voice || !voice.isFinal()) {
        return;
      }
      this.voice = null;
      this.state = null;
      this.stopPositions();
      const failure = voice.state === "failed" ? `Could not play the preview of ${item.label}.` : null;
      if (failure) this.emit("failed", item.key, failure);
      this.emit("change", null, item.quiet ? "" : (failure ?? "Preview finished"));
    });
    this.emit("change", this.current(), item.quiet ? "" : `Previewing in your headphones: ${item.label}`);
    this.sendPositions(voice, item.key);
  }

  stop(): void {
    const quiet = this.quiet;
    if (this.halt(STOP_FADE_SECONDS)) {
      this.emit("change", null, quiet ? "" : "Preview stopped");
    }
  }

  dispose(): void {
    this.halt(0);
    this.removeAllListeners();
  }

  /** Send this voice's position every POSITION_MS while it plays (not while it loads). */
  private sendPositions(voice: Voice, key: string): void {
    const tick = () => {
      if (this.voice !== voice) return;
      if (voice.state === "playing") this.emit("position", key, voice.position());
      this.positionTimer = this.scheduler.setTimeout(tick, POSITION_MS);
    };
    this.positionTimer = this.scheduler.setTimeout(tick, POSITION_MS);
  }

  private stopPositions(): void {
    if (this.positionTimer !== null) this.scheduler.clearTimeout(this.positionTimer);
    this.positionTimer = null;
  }

  /** Stop the voice without announcing it; true when something was previewing. */
  private halt(fadeSeconds: number): boolean {
    const voice = this.voice;
    this.voice = null;
    this.state = null;
    this.stopPositions();
    if (!voice) {
      return false;
    }
    void voice.stop(fadeSeconds);
    return true;
  }
}

/** A track's name as the game master sees it. */
function titleOf(track: DomainTrack): string {
  return track.title || track.metaTitle || track.fileName;
}

/** Preview a track. */
export function trackPreview(track: DomainTrack, media: MediaRequest): PreviewItem {
  return { key: track.id, label: titleOf(track), media, kind: "track", trackId: track.id };
}

/** Preview a playlist: its first track; an empty playlist gives a message to show instead. */
export function playlistPreview(
  playlist: DomainPlaylist,
  lookup: DomainLookup,
  mediaOf: (track: DomainTrack) => MediaRequest,
): PreviewItem | { message: string } {
  const first = playlistTracks(playlist, lookup)[0];
  if (!first) {
    return { message: "This playlist has no tracks yet" };
  }
  return { key: `pl:${playlist.id}`, label: `${playlist.name}: ${titleOf(first)}`, media: mediaOf(first), kind: "playlist", trackId: first.id, playlistId: playlist.id };
}

/** Preview a pad's sound, decoded so it starts at once as the pad would. */
export function padPreview(pad: { boardId: string; padId: string; label: string; media: MediaRequest }): PreviewItem {
  return {
    key: `pad:${pad.boardId}/${pad.padId}`,
    label: `${pad.label} (pad)`,
    kind: "pad",
    padKey: `${pad.boardId}/${pad.padId}`,
    media: { ...pad.media, preferBuffer: pad.media.preferBuffer ?? true },
  };
}
