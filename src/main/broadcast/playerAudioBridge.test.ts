import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerAudioBridge, PLAYER_AUDIO_PORT, CAPTURE_PLAYER_PORT } from "./playerAudioBridge";

const roles = vi.hoisted(() => new Map<unknown, string>());
vi.mock("../security/trustedContents", () => ({
  trustedContents: { roleOf: (contents: unknown) => roles.get(contents) ?? null },
}));

class FakePort {
  closed = false;
  constructor(readonly name: string) {}
  close() {
    this.closed = true;
  }
}

let channels: { port1: FakePort; port2: FakePort }[];
const createChannel = () => {
  const channel = { port1: new FakePort(`p1-${channels.length}`), port2: new FakePort(`p2-${channels.length}`) };
  channels.push(channel);
  return channel as never;
};

class FakeContents extends EventEmitter {
  destroyed = false;
  loading = true;
  postMessage = vi.fn();
  send = vi.fn();
  isDestroyed = () => this.destroyed;
  isLoading = () => this.loading;
  /**
   * The page has loaded. Chromium may still report it loading (a request of
   * the page still open, as in the packaged player page), so `loading` stays.
   */
  load() {
    this.emit("did-finish-load");
  }
}

function page(role: string | null) {
  const contents = new FakeContents();
  if (role) {
    roles.set(contents, role);
  }
  return contents;
}

/** Ports each page was handed, in order. */
const handed = (contents: FakeContents, channel: string) =>
  contents.postMessage.mock.calls.filter(([name]) => name === channel).map(([, message, ports]) => {
    expect(message).toBeNull();
    return (ports as FakePort[])[0];
  });

let bridge: PlayerAudioBridge;
let capture: FakeContents;
let player: FakeContents;

beforeEach(() => {
  channels = [];
  roles.clear();
  bridge = new PlayerAudioBridge(createChannel);
  capture = page("audio-capture");
  player = page("player-view");
});

describe("PlayerAudioBridge (OUT-5, PRV-1): a private channel between the player page and the capture window", () => {
  it("hands one end to each page once both have loaded", () => {
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    expect(channels).toEqual([]);
    capture.load();
    expect(channels).toEqual([]);
    player.load();
    expect(channels).toHaveLength(1);
    expect(handed(capture, CAPTURE_PLAYER_PORT)).toEqual([channels[0].port1]);
    expect(handed(player, PLAYER_AUDIO_PORT)).toEqual([channels[0].port2]);
  });

  it("makes a new channel when either page loads again, and closes the old one", () => {
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    capture.load();
    player.load();
    player.load();
    capture.load();
    expect(channels).toHaveLength(3);
    expect(channels[0].port1.closed && channels[0].port2.closed).toBe(true);
    expect(channels[1].port1.closed && channels[1].port2.closed).toBe(true);
    expect(handed(player, PLAYER_AUDIO_PORT)).toHaveLength(3);
  });

  it("connects at once a page that has already loaded", () => {
    capture.loading = false;
    player.loading = false;
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    expect(channels).toHaveLength(1);
  });

  it("gives the player end only to the app's player page, never a website tab or another page", () => {
    capture.loading = false;
    bridge.setCapture(capture as never);
    for (const other of [page(null), page("main-window"), page("audio-capture")]) {
      other.loading = false;
      bridge.setPlayer(other as never);
      expect(other.postMessage).not.toHaveBeenCalled();
    }
    expect(channels).toEqual([]);
  });

  it("stops when the player page is closed, and a new player page gets a new channel", () => {
    capture.loading = false;
    player.loading = false;
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    player.destroyed = true;
    player.emit("destroyed");
    expect(channels[0].port1.closed).toBe(true);
    const next = page("player-view");
    next.loading = false;
    bridge.setPlayer(next as never);
    expect(channels).toHaveLength(2);
    // The old page's listeners are gone.
    player.emit("did-finish-load");
    expect(channels).toHaveLength(2);
  });

  it("tells the player page the rooms, now and after it loads again", () => {
    capture.loading = false;
    player.loading = false;
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    const rooms = [{ botId: "bot-a", name: "Tavern" }];
    bridge.setRooms(rooms);
    expect(player.send).toHaveBeenLastCalledWith("PLAYER_ROOMS", rooms);
    player.send.mockClear();
    player.load();
    expect(player.send).toHaveBeenCalledWith("PLAYER_ROOMS", rooms);
  });

  it("closes the channel and forgets both pages when destroyed", () => {
    capture.loading = false;
    player.loading = false;
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    bridge.destroy();
    expect(channels[0].port1.closed).toBe(true);
    capture.emit("did-finish-load");
    expect(channels).toHaveLength(1);
  });
});

// --- w3-host ---
describe("PlayerAudioBridge (wave 3): the new interface's page takes the channel from the old player", () => {
  let lyre: FakeContents;

  beforeEach(() => {
    lyre = page("lyre-view");
    capture.loading = false;
    player.loading = false;
    bridge.setCapture(capture as never);
    bridge.setPlayer(player as never);
    bridge.setRooms([{ botId: "bot-a", name: "Tavern" }]);
    player.postMessage.mockClear();
    player.send.mockClear();
  });

  it("hands the channel and the rooms to the new page once it has loaded, and closes the old player's channel", () => {
    bridge.setLyre(lyre as never);
    expect(channels).toHaveLength(1);
    lyre.load();
    expect(channels).toHaveLength(2);
    expect(channels[0].port1.closed && channels[0].port2.closed).toBe(true);
    expect(handed(lyre, PLAYER_AUDIO_PORT)).toEqual([channels[1].port2]);
    expect(handed(capture, CAPTURE_PLAYER_PORT).slice(-1)).toEqual([channels[1].port1]);
    expect(lyre.send).toHaveBeenLastCalledWith("PLAYER_ROOMS", [{ botId: "bot-a", name: "Tavern" }]);
  });

  it("gives the old player nothing more while the new page is open: no channel end, no rooms", () => {
    lyre.loading = false;
    bridge.setLyre(lyre as never);
    player.load();
    bridge.setRooms([{ botId: "bot-b", name: "Dungeon" }]);
    expect(player.postMessage).not.toHaveBeenCalled();
    expect(player.send).not.toHaveBeenCalled();
    // The old player reloading does not disturb the new page's channel.
    expect(channels).toHaveLength(2);
    expect(lyre.send).toHaveBeenLastCalledWith("PLAYER_ROOMS", [{ botId: "bot-b", name: "Dungeon" }]);
  });

  it("makes a new channel for the new page when it or the capture window loads again", () => {
    lyre.loading = false;
    bridge.setLyre(lyre as never);
    lyre.load();
    capture.load();
    expect(handed(lyre, PLAYER_AUDIO_PORT)).toHaveLength(3);
    expect(channels.slice(0, 3).every((channel) => channel.port1.closed && channel.port2.closed)).toBe(true);
  });

  it("refuses any page that is not the new interface's page, the old player included", () => {
    for (const other of [page(null), page("main-window"), page("player-view"), page("audio-capture")]) {
      other.loading = false;
      bridge.setLyre(other as never);
      expect(other.postMessage).not.toHaveBeenCalled();
    }
    expect(channels).toHaveLength(1);
  });

  it("gives the channel back to the old player when the new page closes", () => {
    lyre.loading = false;
    bridge.setLyre(lyre as never);
    lyre.destroyed = true;
    lyre.emit("destroyed");
    expect(channels).toHaveLength(3);
    expect(handed(player, PLAYER_AUDIO_PORT)).toEqual([channels[2].port2]);
    expect(player.send).toHaveBeenLastCalledWith("PLAYER_ROOMS", [{ botId: "bot-a", name: "Tavern" }]);
    // The closed page's listeners are gone.
    lyre.emit("did-finish-load");
    expect(channels).toHaveLength(3);
  });

  it("leaves the new page's channel alone when the old player opens, closes or is registered again", () => {
    lyre.loading = false;
    bridge.setLyre(lyre as never);
    player.destroyed = true;
    player.emit("destroyed");
    const another = page("player-view");
    another.loading = false;
    bridge.setPlayer(another as never);
    expect(channels).toHaveLength(2);
    expect(channels[1].port1.closed || channels[1].port2.closed).toBe(false);
    expect(another.postMessage).not.toHaveBeenCalled();
  });

  it("registering the same new page twice changes nothing", () => {
    lyre.loading = false;
    bridge.setLyre(lyre as never);
    bridge.setLyre(lyre as never);
    expect(channels).toHaveLength(2);
  });
});
