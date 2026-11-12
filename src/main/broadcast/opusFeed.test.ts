import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { AudioPlayerStatus } from "@discordjs/voice";
import type { AudioResource } from "@discordjs/voice";
import type { Readable } from "stream";
import {
  MAX_QUEUED_PACKETS,
  OpusPacketFeed,
  PacketStream,
  TARGET_QUEUED_PACKETS,
  TRIM_AFTER_PACKETS,
  type FeedPlayer,
} from "./opusFeed";

const packet = (n: number) => Buffer.from([n]);

describe("PacketStream", () => {
  it("hands out packets one read at a time, in order", () => {
    const stream = new PacketStream();
    stream.pushPacket(packet(1));
    stream.pushPacket(packet(2));
    expect(stream.read()).toEqual(packet(1));
    expect(stream.read()).toEqual(packet(2));
    expect(stream.read()).toBeNull();
  });

  it("drops the oldest packets so the delay stays bounded", () => {
    const stream = new PacketStream();
    // One packet sits in the stream's own buffer, the rest in the queue.
    const pushed = MAX_QUEUED_PACKETS + 10;
    for (let n = 0; n < pushed; n++) {
      stream.pushPacket(packet(n));
    }
    const read: number[] = [];
    for (let chunk = stream.read(); chunk; chunk = stream.read()) {
      read.push((chunk as Buffer)[0]);
    }
    expect(read.length).toBeLessThanOrEqual(MAX_QUEUED_PACKETS + 1);
    expect(read[read.length - 1]).toBe(pushed - 1);
  });
});

describe("PacketStream delay after a stall (PERF-8)", () => {
  it("drops one packet at a time while a backlog persists, down to the target", () => {
    const stream = new PacketStream();
    stream.read(); // the player is waiting for a packet
    // A stall: six packets arrive at once.
    for (let n = 0; n < 6; n++) {
      stream.pushPacket(packet(n));
    }
    // From then on one arrives for each one played.
    let next = 6;
    for (let step = 0; step < TRIM_AFTER_PACKETS * 10; step++) {
      stream.read();
      stream.pushPacket(packet(next++ % 256));
    }
    expect(stream.queued).toBeLessThanOrEqual(TARGET_QUEUED_PACKETS);
  });

  it("keeps a short backlog that clears by itself", () => {
    const stream = new PacketStream();
    for (let n = 0; n < TARGET_QUEUED_PACKETS + 2; n++) {
      stream.pushPacket(packet(n));
    }
    const read: number[] = [];
    for (let chunk = stream.read(); chunk; chunk = stream.read()) {
      read.push((chunk as Buffer)[0]);
    }
    expect(read).toEqual([0, 1, 2, 3]);
  });
});

describe("PacketStream timing counts (w51-audio)", () => {
  it("counts the player's reads that found nothing, as holes once another packet of the same sound comes", () => {
    const stream = new PacketStream();
    stream.pushPacket(packet(1));
    expect(stream.read()).toEqual(packet(1));
    expect(stream.read()).toBeNull(); // Discord's player sends 20 ms of silence instead
    expect(stream.read()).toBeNull();
    expect(stream.timing()).toMatchObject({ packets: 1, holes: 0 });
    stream.pushPacket(packet(2));
    expect(stream.timing()).toMatchObject({ packets: 2, holes: 2 });
  });

  it("does not count the stream's own internal reads", () => {
    const stream = new PacketStream();
    stream.read(0);
    stream.pushPacket(packet(1));
    expect(stream.timing().holes).toBe(0);
  });

  it("counts the packets it drops to keep the delay short", () => {
    const stream = new PacketStream();
    for (let n = 0; n < MAX_QUEUED_PACKETS + 4; n++) stream.pushPacket(packet(n));
    expect(stream.timing().dropped).toBeGreaterThan(0);
  });
});

class FakePlayer extends EventEmitter {
  state: { status: AudioPlayerStatus } = { status: AudioPlayerStatus.Idle };
  resources: Readable[] = [];
  play = vi.fn((resource: { stream: Readable }) => {
    this.resources.push(resource.stream);
    this.setStatus(AudioPlayerStatus.Playing);
  });
  stop = vi.fn(() => {
    this.setStatus(AudioPlayerStatus.Idle);
    return true;
  });
  setStatus(status: AudioPlayerStatus) {
    const old = this.state;
    this.state = { status };
    this.emit("stateChange", old, this.state);
  }
}

function feedWithPlayer() {
  const player = new FakePlayer();
  const feed = new OpusPacketFeed(
    player as unknown as FeedPlayer,
    (stream) => ({ stream }) as unknown as AudioResource,
  );
  return { player, feed };
}

describe("OpusPacketFeed (PERF-4)", () => {
  it("starts playing on the first packet and keeps one resource while packets flow", () => {
    const { player, feed } = feedWithPlayer();
    feed.push(packet(1));
    feed.push(packet(2));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.resources[0].read()).toEqual(packet(1));
    expect(player.resources[0].read()).toEqual(packet(2));
  });

  it("starts a new resource after the player went idle during a silence", () => {
    const { player, feed } = feedWithPlayer();
    feed.push(packet(1));
    player.setStatus(AudioPlayerStatus.Idle);
    expect(player.resources[0].destroyed).toBe(true);
    feed.push(packet(2));
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.resources[1].read()).toEqual(packet(2));
  });

  it("drops packets while muted and stops what was playing", () => {
    const { player, feed } = feedWithPlayer();
    feed.push(packet(1));
    feed.muted = true;
    expect(player.stop).toHaveBeenCalled();
    feed.push(packet(2));
    expect(player.play).toHaveBeenCalledTimes(1);
    feed.muted = false;
    feed.push(packet(3));
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it("w51-audio: adds up the counts of every resource it played (holes, drops) for the log", () => {
    const { player, feed } = feedWithPlayer();
    feed.push(packet(1));
    player.resources[0].read();
    player.resources[0].read();
    feed.push(packet(2));
    player.setStatus(AudioPlayerStatus.Idle);
    feed.push(packet(3));
    expect(feed.timing()).toEqual({ packets: 3, holes: 1, dropped: 0 });
  });

  it("stops listening to the player when disposed", () => {
    const { player, feed } = feedWithPlayer();
    feed.dispose();
    expect(player.listenerCount("stateChange")).toBe(0);
  });
});

/**
 * w51-audio: is the Discord end a cause of the stutter Nik heard? A simulation of two minutes of packets arriving
 * unevenly (each 20 ms frame waits for the capture window's next sound-card callback, then up to 10 ms on the way),
 * read by @discordjs/voice's player on its 20 ms cycle with Windows' coarse 15.6 ms timers, and with a 60 ms stall
 * every second. Measured: 1 or 2 holes in 6,000 packets, all at the start while the queue fills; nothing dropped.
 * The stream absorbs uneven arrival by itself, so it was left as it is.
 */
describe("PacketStream with uneven arrival and coarse timers (w51-audio)", () => {
  function simulate({ timerStepMs, callbackMs, wayMs, stallEveryMs = 0, stallMs = 0 }: { timerStepMs: number; callbackMs: number; wayMs: number; stallEveryMs?: number; stallMs?: number }) {
    let seed = 1;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const stream = new PacketStream();
    const end = 120_000;
    const arrivals: number[] = [];
    for (let k = 0; k * 20 < end; k++) {
      // The sound card runs 50 parts per million slow against the computer's clock.
      let at = Math.ceil((k * 20 * 1.00005) / callbackMs) * callbackMs + random() * wayMs;
      if (stallEveryMs && Math.floor(at / stallEveryMs) !== Math.floor((at - stallMs) / stallEveryMs)) {
        at = Math.ceil(at / stallEveryMs) * stallEveryMs + stallMs;
      }
      arrivals.push(at);
    }
    arrivals.sort((a, b) => a - b);
    // @discordjs/voice: next = start + 20 n; each step waits max(1, next - now), rounded up to the timer's step.
    let next = arrivals[0];
    let readAt = arrivals[0];
    let arrived = 0;
    while (readAt < end) {
      while (arrived < arrivals.length && arrivals[arrived] <= readAt) stream.pushPacket(packet(arrived++ % 256));
      stream.read();
      next += 20;
      readAt = Math.ceil((readAt + Math.max(1, next - readAt)) / timerStepMs) * timerStepMs;
    }
    return stream.timing();
  }

  it.each([
    { timerStepMs: 1, callbackMs: 10, wayMs: 2 },
    { timerStepMs: 15.625, callbackMs: 10, wayMs: 10 },
    { timerStepMs: 15.625, callbackMs: 20, wayMs: 10 },
    { timerStepMs: 15.625, callbackMs: 10, wayMs: 2, stallEveryMs: 1000, stallMs: 60 },
  ])("fills at most two holes in two minutes, and drops nothing: %j", (conditions) => {
    const timing = simulate(conditions);
    expect(timing.packets).toBeGreaterThan(5_990);
    expect(timing.holes).toBeLessThanOrEqual(2);
    expect(timing.dropped).toBe(0);
  });
});
