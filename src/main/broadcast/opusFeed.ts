import { Readable } from "stream";
import {
  AudioPlayerStatus,
  createAudioResource,
  StreamType,
  type AudioPlayer,
  type AudioResource,
} from "@discordjs/voice";

/**
 * Most packets waiting for Discord's 20 ms player clock (200 ms). Packets
 * arrive one by one, but a busy computer can deliver a few at once after a
 * short stall; they wait here instead of being lost. Beyond this the oldest
 * are dropped.
 */
export const MAX_QUEUED_PACKETS = 10;

/**
 * PERF-8: a queue left longer than this after a stall would keep the extra
 * delay for good, because packets arrive exactly as fast as they are played.
 * While more than this many wait for `TRIM_AFTER_PACKETS` packets in a row,
 * one is dropped, which brings the delay back down step by step.
 */
export const TARGET_QUEUED_PACKETS = 2;
export const TRIM_AFTER_PACKETS = 50;

/**
 * A pull-based stream of Opus packets: hands Discord's audio player one packet
 * per read and keeps at most `MAX_QUEUED_PACKETS` waiting.
 */
export class PacketStream extends Readable {
  private queue: Buffer[] = [];
  private wanted = false;
  /** Packets pushed in a row while more than the target were waiting. */
  private backlogged = 0;

  constructor() {
    super({ objectMode: true, highWaterMark: 1 });
  }

  /** Packets waiting to be read (for tests and diagnosis). */
  get queued(): number {
    return this.queue.length;
  }

  pushPacket(packet: Buffer): void {
    this.queue.push(packet);
    if (this.queue.length > TARGET_QUEUED_PACKETS) {
      this.backlogged++;
    } else {
      this.backlogged = 0;
    }
    if (this.queue.length > MAX_QUEUED_PACKETS || this.backlogged >= TRIM_AFTER_PACKETS) {
      this.queue.shift();
      this.backlogged = 0;
    }
    this.drain();
  }

  override _read(): void {
    this.wanted = true;
    this.drain();
  }

  private drain(): void {
    while (this.wanted && this.queue.length > 0) {
      this.wanted = this.push(this.queue.shift());
    }
  }
}

/** The parts of @discordjs/voice's AudioPlayer the feed uses. */
export type FeedPlayer = Pick<AudioPlayer, "play" | "stop" | "state" | "on" | "off">;

/**
 * Feeds the broadcast's Opus packets to one output's audio player.
 *
 * PERF-4: packets arrive already encoded (WebCodecs in the capture window),
 * so the resource is `StreamType.Opus` and @discordjs/voice does no encoding.
 * The capture window sends nothing during silence; the player then idles
 * (after `maxMissedFrames`), and the next packet starts a new resource.
 * While muted, packets are dropped.
 */
export class OpusPacketFeed {
  private stream?: PacketStream;
  private _muted = false;

  constructor(
    private readonly player: FeedPlayer,
    private readonly createResource: (stream: Readable) => AudioResource = (stream) =>
      createAudioResource(stream, { inputType: StreamType.Opus }),
  ) {
    player.on("stateChange", this.handlePlayerState);
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(muted: boolean) {
    this._muted = muted;
    if (muted) {
      this.stop();
    }
  }

  push(packet: Buffer): void {
    if (this._muted) {
      return;
    }
    if (!this.stream) {
      const stream = new PacketStream();
      this.stream = stream;
      stream.pushPacket(packet);
      this.player.play(this.createResource(stream));
      return;
    }
    this.stream.pushPacket(packet);
  }

  /** End the current resource (the broadcast stopped or the output muted). */
  stop(): void {
    const stream = this.stream;
    this.stream = undefined;
    if (stream) {
      this.player.stop(true);
      stream.destroy();
    }
  }

  dispose(): void {
    this.stop();
    this.player.off("stateChange", this.handlePlayerState);
  }

  private handlePlayerState = (_old: unknown, state: { status: AudioPlayerStatus }) => {
    if (state.status === AudioPlayerStatus.Idle && this.stream) {
      // The player gave up after a silence; start afresh with the next packet.
      this.stream.destroy();
      this.stream = undefined;
    }
  };
}
