/**
 * OUT-5, PRV-1: the private channel between the player page and the hidden
 * capture window (messages: src/common/playerAudio.ts).
 *
 * Like the WP2 audio port (SEC-2), the main process makes a
 * MessageChannelMain and hands one end to each page only: the player page
 * (registered as the app's player, never a website tab) and the capture
 * window. Audio then flows between the two pages directly. A new channel is
 * made whenever either page loads again, and the old ends are closed, so a
 * stale end goes dead.
 *
 * The player page also learns the rooms here ("PLAYER_ROOMS", main process →
 * player page), so the engine knows which bots it can play to.
 *
 * Wave 3: the new interface's page (`lyre-view`, src/lyre) hosts the engine.
 * While it is open it alone holds the channel and hears the rooms; the old
 * player gets neither. The old player plays with Howler and reaches Discord
 * through tab capture, so it never needed the channel outside tests, and a
 * second page sending frames into the same rooms would be heard twice. When
 * the new page closes, the old player gets a channel again (its test hook,
 * e2e/rooms.spec.ts, uses it).
 */
import { MessageChannelMain, type WebContents } from "electron";

import type { Room } from "../../common/domain/types";
import { trustedContents } from "../security/trustedContents";

/** Channel on which the player page receives its end. */
export const PLAYER_AUDIO_PORT = "PLAYER_AUDIO_PORT";
/** Channel on which the capture window receives its end. */
export const CAPTURE_PLAYER_PORT = "AUDIO_CAPTURE_PLAYER_PORT";
/** Rooms for the player page (main process → player page; not in IPC_CHANNELS). */
export const PLAYER_ROOMS = "PLAYER_ROOMS";

type Channel = Pick<MessageChannelMain, "port1" | "port2">;
type Page = Pick<WebContents, "isDestroyed" | "isLoading" | "postMessage" | "send" | "on" | "off">;

interface Watched {
  contents: Page;
  /**
   * The page has loaded. Not `!isLoading()`: Chromium can still report a
   * loaded page as loading (a request it holds open), so a finished load is
   * what counts.
   */
  loaded: boolean;
  stop(): void;
}

export class PlayerAudioBridge {
  private capture?: Watched;
  private player?: Watched;
  /** Wave 3: the new interface's page; holds the channel instead of the player while open. */
  private lyre?: Watched;
  private channel?: Channel;
  private rooms: Room[] = [];

  constructor(private readonly createChannel: () => Channel = () => new MessageChannelMain()) {}

  /** The capture window; connected each time it finishes loading. */
  setCapture(contents: Page): void {
    this.capture?.stop();
    this.capture = this.watch(contents, () => {
      this.capture = undefined;
      this.close();
    });
    this.reconnect();
  }

  /** The player page (PLAYER_REGISTER_VIEW). Anything that is not the app's player page is refused. */
  setPlayer(contents: Page): void {
    if (contents.isDestroyed() || trustedContents.roleOf(contents as WebContents) !== "player-view") {
      console.error("Refused to give the player audio channel to a page that is not the player");
      return;
    }
    if (this.player?.contents === contents) {
      return;
    }
    this.player?.stop();
    this.player = this.watch(contents, () => {
      const wasHolder = this.holder() === this.player;
      this.player = undefined;
      if (wasHolder) {
        this.close();
      }
    });
    // While the new interface's page holds the channel, the old player waits.
    if (this.holder() === this.player) {
      this.reconnect();
    }
  }

  /** Wave 3: the new interface's page. Anything that is not that page is refused, the old player included. */
  setLyre(contents: Page): void {
    if (contents.isDestroyed() || trustedContents.roleOf(contents as WebContents) !== "lyre-view") {
      console.error("Refused to give the player audio channel to a page that is not Lyre's own interface");
      return;
    }
    if (this.lyre?.contents === contents) {
      return;
    }
    this.lyre?.stop();
    this.lyre = this.watch(contents, () => {
      this.lyre = undefined;
      // The old player, if open, takes the channel back.
      this.close();
      this.reconnect();
    });
    this.reconnect();
  }

  /** OUT-5: the rooms changed; the player page is told. */
  setRooms(rooms: Room[]): void {
    this.rooms = rooms.map((room) => ({ botId: room.botId, name: room.name }));
    this.sendRooms();
  }

  destroy(): void {
    this.capture?.stop();
    this.player?.stop();
    this.lyre?.stop();
    this.capture = undefined;
    this.player = undefined;
    this.lyre = undefined;
    this.close();
  }

  /** The page that holds the channel: the new interface's page while it is open, else the old player. */
  private holder(): Watched | undefined {
    return this.lyre && !this.lyre.contents.isDestroyed() ? this.lyre : this.player;
  }

  private watch(contents: Page, onGone: () => void): Watched {
    const onLoad = () => {
      watched.loaded = true;
      // A page that does not hold the channel (the old player while the new
      // page is open) loading again changes nothing.
      if (watched === this.capture || watched === this.holder()) {
        this.reconnect();
      }
    };
    const stop = () => {
      contents.off("did-finish-load", onLoad);
      contents.off("destroyed", onDestroyed);
    };
    const onDestroyed = () => {
      stop();
      onGone();
    };
    contents.on("did-finish-load", onLoad);
    contents.on("destroyed", onDestroyed);
    const watched: Watched = { contents, loaded: !contents.isLoading(), stop };
    return watched;
  }

  private reconnect() {
    const holder = this.holder();
    if (!isReady(this.capture) || !isReady(holder)) {
      return;
    }
    const capture = this.capture.contents;
    const player = holder.contents;
    this.close();
    const channel = this.createChannel();
    this.channel = channel;
    capture.postMessage(CAPTURE_PLAYER_PORT, null, [channel.port1]);
    player.postMessage(PLAYER_AUDIO_PORT, null, [channel.port2]);
    this.sendRooms();
  }

  private sendRooms() {
    const player = this.holder()?.contents;
    if (player && !player.isDestroyed()) {
      player.send(PLAYER_ROOMS, this.rooms);
    }
  }

  private close() {
    this.channel?.port1.close();
    this.channel?.port2.close();
    this.channel = undefined;
  }
}

function isReady(watched: Watched | undefined): watched is Watched {
  return Boolean(watched?.loaded) && !watched!.contents.isDestroyed();
}
