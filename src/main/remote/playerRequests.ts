/**
 * PERF-9: ask the player view for its state on behalf of a remote API request.
 *
 * Each request gets its own id, which the player sends back with its reply,
 * so simultaneous requests (several Stream Deck buttons polling at once) each
 * get their own answer. One listener per reply channel serves every request,
 * and a request that times out is forgotten, so nothing piles up on `ipcMain`.
 * SEC-8: replies are accepted from the player view only.
 */
import { ipcMain } from "electron";
import { guardIpc, type GuardedIpc } from "../security/ipcGuard";

/** How long the player has to answer before the API reports a timeout. */
export const PLAYER_REPLY_TIMEOUT_MS = 5000;

/** Request channel the player listens on, and the channel it replies on. */
export const PLAYER_QUERIES = {
  playlists: {
    request: "PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST",
    reply: "PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY",
  },
  playlistPlayback: {
    request: "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REQUEST",
    reply: "PLAYER_REMOTE_PLAYLIST_PLAYBACK_REPLY",
  },
  soundboards: {
    request: "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REQUEST",
    reply: "PLAYER_REMOTE_SOUNDBOARD_GET_ALL_REPLY",
  },
  soundboardPlayback: {
    request: "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST",
    reply: "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY",
  },
} as const;

export type PlayerQuery = keyof typeof PLAYER_QUERIES;

/** Thrown (as a rejection) when the player does not answer in time. */
export class PlayerReplyTimeout extends Error {
  constructor() {
    super("Request timeout");
  }
}

interface Pending {
  query: PlayerQuery;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Something that can be sent a message: the player view's web contents. */
export interface PlayerView {
  send(channel: string, ...args: unknown[]): void;
}

export class PlayerRequests {
  private readonly pending = new Map<number, Pending>();
  private readonly ipc: GuardedIpc;
  private nextId = 1;

  constructor(
    private readonly timeoutMs = PLAYER_REPLY_TIMEOUT_MS,
    ipc: GuardedIpc = guardIpc(ipcMain),
  ) {
    this.ipc = ipc;
    for (const query of Object.keys(PLAYER_QUERIES) as PlayerQuery[]) {
      this.ipc.on(PLAYER_QUERIES[query].reply, (_event, payload, requestId) =>
        this.settle(query, requestId as number, payload),
      );
    }
  }

  /** Ask the player for `query` and wait for its answer, or reject with `PlayerReplyTimeout`. */
  ask<T>(view: PlayerView, query: PlayerQuery): Promise<T> {
    const id = this.nextId;
    this.nextId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PlayerReplyTimeout());
      }, this.timeoutMs);
      this.pending.set(id, { query, resolve: resolve as (value: unknown) => void, reject, timer });
      view.send(PLAYER_QUERIES[query].request, id);
    });
  }

  /** Number of requests still waiting for the player (for tests and diagnostics). */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Stop listening and fail any request still waiting. */
  destroy(): void {
    this.ipc.dispose();
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new PlayerReplyTimeout());
      this.pending.delete(id);
    }
  }

  private settle(query: PlayerQuery, id: number, payload: unknown) {
    const request = this.pending.get(id);
    if (!request || request.query !== query) {
      return;
    }
    clearTimeout(request.timer);
    this.pending.delete(id);
    request.resolve(payload);
  }
}
