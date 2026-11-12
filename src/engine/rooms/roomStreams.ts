/**
 * OUT-5, PRV-1: the player page's end of the private channel to the capture
 * window (src/common/playerAudio.ts).
 *
 * The capture window records website tabs (and the old player) as whole
 * pages. Engine sound does not go that way: each room's mix is cut into
 * 20 ms frames by a worklet (a "tap") and sent over this channel, and the
 * capture window plays them into that room's own mix, so every room reaches
 * its own bot. The preview is sent the same way, labelled as preview, and the
 * capture window plays it on the game master's device only; it has an audio
 * context of its own that leads to nothing but its tap, so the player page
 * itself never sounds it and tab capture can never record it.
 */
import { TypedEmitter } from "tiny-typed-emitter";

import {
  isCaptureAudioMessage,
  type AudioPortLike,
  type CaptureAudioMessage,
  type PlayerAudioMessage,
} from "../../common/playerAudio";
import type { DeviceClock } from "../../common/deviceClock";
import type { EngineContext, GainLike, NodeLike } from "../audio/types";
import type { PreviewOutput } from "../preview/previewOutput";
import type { RoomMixer } from "./roomMixer";

/** One 20 ms frame from a tap (PCMStream.worklet.js): planar stereo, 1920 samples. */
export type TapFrame = { index: number; samples: Float32Array; last?: boolean };

/** A worklet that cuts what reaches `input` into frames. */
export interface FrameTap {
  readonly input: NodeLike;
  /**
   * w51-audio: post the frames from the audio thread straight to `port` (null: stop) instead of to `onFrame` on this
   * page's main thread, where a busy screen could hold them up. Taps without it are relayed.
   */
  sendTo?(port: AudioPortLike | null): void;
  dispose(): void;
}

export type FrameTapFactory = (onFrame: (frame: TapFrame) => void) => FrameTap;

/** w51-audio: makes a channel for one tap's frames (`() => new MessageChannel()` in the browser). */
export type FrameChannelFactory = () => { port1: AudioPortLike; port2: AudioPortLike };

/** How long the capture window may take to switch the preview's device. */
export const SINK_ANSWER_TIMEOUT_MS = 5_000;

interface LinkEvents {
  /** A message from the capture window (already checked). */
  message: (message: CaptureAudioMessage) => void;
  /** A new channel replaced the old one (the capture window or this page reloaded). */
  reset: () => void;
}

/** The channel itself: replaced whenever the main process hands over a new end. */
export class PlayerAudioLink extends TypedEmitter<LinkEvents> {
  private port: AudioPortLike | null = null;

  get connected(): boolean {
    return this.port !== null;
  }

  connect(port: AudioPortLike): void {
    this.port?.close?.();
    this.port = port;
    port.onmessage = (event) => {
      if (this.port === port && isCaptureAudioMessage(event.data)) {
        this.emit("message", event.data);
      }
    };
    port.start?.();
    this.emit("reset");
  }

  /** Send a message; false (and nothing sent) while there is no channel. */
  send(message: PlayerAudioMessage, transfer: Transferable[] = []): boolean {
    if (!this.port) {
      return false;
    }
    this.port.postMessage(message, transfer);
    return true;
  }

  close(): void {
    this.port?.close?.();
    this.port = null;
    this.removeAllListeners();
  }
}

interface RoomStreamsEvents {
  /**
   * A bot joined (true) or the last left (false). Rooms are heard only on
   * Discord: a host never plays room outputs on this page's speakers, in a
   * broadcast or outside one (BUG-19).
   */
  broadcast: (active: boolean) => void;
}

/** Sends each engine room's mix to that room in the capture window, while a bot is in a voice channel. */
export class RoomStreams extends TypedEmitter<RoomStreamsEvents> {
  private readonly mixer: RoomMixer;
  private readonly link: PlayerAudioLink;
  private readonly createTap: FrameTapFactory;
  private readonly createChannel?: FrameChannelFactory;
  /** `direct`: the tap sends over a frames channel of its own, so nothing is relayed here (w51-audio). */
  private readonly taps = new Map<string, { tap: FrameTap; output: GainLike; direct: boolean }>();
  private active = false;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(options: { mixer: RoomMixer; link: PlayerAudioLink; createTap: FrameTapFactory; createChannel?: FrameChannelFactory }) {
    super();
    this.mixer = options.mixer;
    this.link = options.link;
    this.createTap = options.createTap;
    this.createChannel = options.createChannel;
    const onRooms = () => this.sync();
    const onMessage = (message: CaptureAudioMessage) => {
      if (message.kind === "broadcast") {
        this.setActive(message.active);
      }
    };
    // A new channel: the capture window starts with no broadcast and says when one starts.
    const onReset = () => this.setActive(false);
    this.mixer.on("rooms", onRooms);
    this.link.on("message", onMessage);
    this.link.on("reset", onReset);
    this.unsubscribe.push(
      () => this.mixer.off("rooms", onRooms),
      () => this.link.off("message", onMessage),
      () => this.link.off("reset", onReset),
    );
  }

  get broadcasting(): boolean {
    return this.active;
  }

  dispose(): void {
    for (const stop of this.unsubscribe) {
      stop();
    }
    this.active = false;
    this.sync();
    this.removeAllListeners();
  }

  private setActive(active: boolean) {
    if (active === this.active) {
      return;
    }
    this.active = active;
    this.sync();
    this.emit("broadcast", active);
  }

  /** One tap per room while broadcasting, none otherwise. The table placeholder is never sent. */
  private sync() {
    const wanted = this.active ? this.mixer.rooms().map((room) => room.botId) : [];
    for (const [room, entry] of this.taps) {
      // A room that went, or whose output node changed, loses its tap.
      if (!wanted.includes(room) || this.mixer.output(room) !== entry.output) {
        this.release(room);
      }
    }
    for (const room of wanted) {
      if (!this.taps.has(room)) {
        const output = this.mixer.output(room);
        const tap = this.createTap((frame) => this.sendFrame(room, tap, frame));
        output.connect(tap.input);
        const direct = Boolean(tap.sendTo && this.createChannel);
        this.taps.set(room, { tap, output, direct });
        if (direct && tap.sendTo && this.createChannel) {
          // w51-audio: the frames' own channel; the capture window learns which room its other end carries.
          const { port1, port2 } = this.createChannel();
          tap.sendTo(port1);
          this.link.send({ kind: "room-frames", room, port: port2 }, [port2 as unknown as Transferable]);
        }
      }
    }
  }

  private sendFrame(room: string, tap: FrameTap, frame: TapFrame) {
    const entry = this.taps.get(room);
    if (entry?.tap !== tap || entry.direct) {
      return;
    }
    this.link.send({ kind: "room", room, index: frame.index, samples: frame.samples }, [frame.samples.buffer as ArrayBuffer]);
  }

  private release(room: string) {
    const entry = this.taps.get(room);
    if (!entry) {
      return;
    }
    this.taps.delete(room);
    try {
      entry.output.disconnect(entry.tap.input);
    } catch {
      // Already disconnected (the room's nodes were freed).
    }
    entry.tap.sendTo?.(null);
    entry.tap.dispose();
  }
}

/** The preview, played through the capture window (PRV-1), with a device choice (PRV-2). */
export interface BridgedPreviewOutput extends PreviewOutput {
  setSinkId(deviceId: string): Promise<void>;
  close(): Promise<void>;
  /** PRV-2: the preview in one ear of a split headset (or both), on its way to the capture window. */
  setEar?(ear: "both" | "left" | "right"): void;
  /** w51-audio: keeps the preview's context on the sound card's clock while a preview plays (common/deviceClock.ts). */
  clock?: DeviceClock;
}

/**
 * PRV-1: a PreviewOutput whose `input` leads only to a tap; its frames go to
 * the capture window as preview. `context` must be an audio context of its
 * own (see `createBrowserBridgedPreview`), so no preview node can be joined to
 * the engine's rooms, and nothing of it plays in this page.
 */
export function createBridgedPreviewOutput(options: {
  context: EngineContext;
  link: PlayerAudioLink;
  createTap: FrameTapFactory;
  /** Closes the preview's own audio context. */
  closeContext?: () => Promise<void>;
  /** w51-audio: with a tap that can send elsewhere, the frames go to the capture window over a channel of their own. */
  createChannel?: FrameChannelFactory;
}): BridgedPreviewOutput {
  const { context, link, createChannel } = options;
  const input = context.createGain();
  const tap = options.createTap((frame) => {
    if (!closed && !(tap.sendTo && createChannel)) {
      link.send({ kind: "preview", index: frame.index, samples: frame.samples }, [frame.samples.buffer as ArrayBuffer]);
    }
  });
  input.connect(tap.input);
  let closed = false;
  // w51-audio: every new channel to the capture window (it or this page reloaded) gets a new frames channel.
  const sendDirect = (): void => {
    if (closed || !tap.sendTo || !createChannel || !link.connected) return;
    const { port1, port2 } = createChannel();
    tap.sendTo(port1);
    link.send({ kind: "preview-frames", port: port2 }, [port2 as unknown as Transferable]);
  };
  link.on("reset", sendDirect);
  sendDirect();
  let nextRequest = 1;
  const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  const onMessage = (message: CaptureAudioMessage) => {
    if (message.kind === "preview-sink-done") {
      const request = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) {
        request?.reject(new Error(message.error));
      } else {
        request?.resolve();
      }
    }
  };
  link.on("message", onMessage);

  return {
    context,
    input,
    setSinkId: (deviceId) =>
      new Promise<void>((resolve, reject) => {
        const id = nextRequest++;
        if (!link.send({ kind: "preview-sink", id, deviceId })) {
          reject(new Error("The preview is not ready yet. Try again in a moment."));
          return;
        }
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error("The sound device did not answer. Try again, or choose another device."));
        }, SINK_ANSWER_TIMEOUT_MS);
        waiting.set(id, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      }),
    close: async () => {
      closed = true;
      link.off("message", onMessage);
      link.off("reset", sendDirect);
      input.disconnect();
      tap.sendTo?.(null);
      tap.dispose();
      await options.closeContext?.();
    },
  };
}
