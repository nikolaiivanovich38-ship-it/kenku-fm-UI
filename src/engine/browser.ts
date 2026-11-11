/**
 * Builds the engine for the player page with real browser parts: a Web Audio
 * context, <audio> elements for streaming and XMLHttpRequest for reading
 * small files. Unit tests use the fakes instead; the real-browser e2e test
 * (e2e/engine.spec.ts) checks this wiring in the packaged app.
 */
import { browserScheduler, fromAudioContext, MediaElementLike } from "./audio/types";
import { PlaybackEngine } from "./engine";
import { readBytes } from "./sources/readBytes";
import { MediaResolver, SourceLoader, SourcePolicy } from "./sources/sourceLoader";

export interface BrowserEngine {
  engine: PlaybackEngine;
  audioContext: AudioContext;
  /** Stop everything and close the audio context. */
  close(): Promise<void>;
}

export function createBrowserEngine(
  options: {
    audioContext?: AudioContext;
    resolver?: MediaResolver;
    policy?: Partial<SourcePolicy>;
    /**
     * "anonymous" for a page whose files come from another origin (the Lyre page's lyre-media: addresses, security
     * review 6): without it, Web Audio plays a cross-origin <audio> element as silence.
     */
    crossOrigin?: "anonymous";
  } = {},
): BrowserEngine {
  const audioContext = options.audioContext ?? new AudioContext({ latencyHint: "playback" });
  const context = fromAudioContext(audioContext);
  const loader = new SourceLoader({
    context,
    createElement: () => {
      const element = document.createElement("audio");
      // Never shown; the element only feeds the Web Audio graph.
      element.controls = false;
      if (options.crossOrigin) element.crossOrigin = options.crossOrigin;
      return element as MediaElementLike;
    },
    fetchBytes: (url, limit) => readBytes(url, limit),
    resolver: options.resolver,
    policy: options.policy,
  });
  const engine = new PlaybackEngine({ context, scheduler: browserScheduler, loader });
  return {
    engine,
    audioContext,
    close: async () => {
      engine.dispose();
      await audioContext.close();
    },
  };
}
