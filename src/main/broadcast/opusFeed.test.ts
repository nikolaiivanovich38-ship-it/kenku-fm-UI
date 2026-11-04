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

  it("stops listening to the player when disposed", () => {
    const { player, feed } = feedWithPlayer();
    feed.dispose();
    expect(player.listenerCount("stateChange")).toBe(0);
  });
});
