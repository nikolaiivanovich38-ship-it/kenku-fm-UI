/**
 * PRV-1: preview in the game master's headphones. Matches the prototype's
 * L.preview / L.previewPlaylist / L.previewPad / L.stopPreview
 * (design/prototype/src/core.js):
 *
 * - one preview at a time: starting another stops the one playing;
 * - pressing Preview again on the item that is previewing stops it;
 * - a track plays itself, a playlist its first track, a pad its sound;
 * - the change is announced in plain words for the screen reader's live
 *   region ("Previewing in your headphones: Tavern", "Preview stopped").
 *
 * Preview voices are made in the PreviewOutput's context and connect only to
 * its input, never to the engine's mixer, so nothing previewed can reach the
 * table mix that Discord records.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import { DomainLookup, DomainPlaylist, DomainTrack, playlistTracks } from "../../../common/domain";
import { browserScheduler, Scheduler } from "../audio/types";
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
}

export interface PreviewState {
  key: string;
  label: string;
}

interface PreviewEvents {
  /** What is previewing now (null: nothing), with a sentence for the live region. */
  change: (state: PreviewState | null, announcement: string) => void;
}

/** A switch or a stop fades this fast, so it does not click. */
const STOP_FADE_SECONDS = 0.1;

export class PreviewPlayer extends TypedEmitter<PreviewEvents> {
  private readonly output: PreviewOutput;
  private readonly scheduler: Scheduler;
  private readonly load: (request: MediaRequest) => Promise<PlayableSource>;
  private voice: Voice | null = null;
  private state: PreviewState | null = null;

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
  }

  current(): PreviewState | null {
    return this.state ? { ...this.state } : null;
  }

  isPreviewing(key: string): boolean {
    return this.state?.key === key;
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
      { context: this.output.context, scheduler: this.scheduler, destination: this.output.input },
      this.load(item.media),
      item.options ?? {},
      { id: `preview:${item.key}` },
    );
    this.voice = voice;
    this.state = { key: item.key, label: item.label };
    voice.on("state", () => {
      if (this.voice !== voice || !voice.isFinal()) {
        return;
      }
      this.voice = null;
      this.state = null;
      this.emit(
        "change",
        null,
        voice.state === "failed" ? `Could not play the preview of ${item.label}.` : "Preview finished",
      );
    });
    this.emit("change", this.current(), `Previewing in your headphones: ${item.label}`);
  }

  stop(): void {
    if (this.halt(STOP_FADE_SECONDS)) {
      this.emit("change", null, "Preview stopped");
    }
  }

  dispose(): void {
    this.halt(0);
    this.removeAllListeners();
  }

  /** Stop the voice without announcing it; true when something was previewing. */
  private halt(fadeSeconds: number): boolean {
    const voice = this.voice;
    this.voice = null;
    this.state = null;
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
  return { key: track.id, label: titleOf(track), media };
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
  return { key: `pl:${playlist.id}`, label: `${playlist.name}: ${titleOf(first)}`, media: mediaOf(first) };
}

/** Preview a pad's sound, decoded so it starts at once as the pad would. */
export function padPreview(pad: { boardId: string; padId: string; label: string; media: MediaRequest }): PreviewItem {
  return {
    key: `pad:${pad.boardId}/${pad.padId}`,
    label: `${pad.label} (pad)`,
    media: { ...pad.media, preferBuffer: pad.media.preferBuffer ?? true },
  };
}
