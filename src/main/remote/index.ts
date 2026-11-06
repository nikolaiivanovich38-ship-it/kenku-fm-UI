import type { FastifyInstance } from "fastify";
import type { PlayerRequests } from "./playerRequests";
import { get as playlistGet } from "./routes/playlist";
import { play as playlistPlay } from "./routes/playlist/play";
import { playback as playlistPlayback } from "./routes/playlist/playback";
import { get as soundboardGet } from "./routes/soundboard";
import { play as soundboardPlay } from "./routes/soundboard/play";
import { stop as soundboardStop } from "./routes/soundboard/stop";
import { playback as soundboardPlayback } from "./routes/soundboard/playback";

/** What the routes need from the main process: the player view and its question-and-answer channel. */
export interface RemoteHost {
  getView(): Electron.WebContents | undefined;
  requests: PlayerRequests;
}

export type ReplyError = {
  statusCode: number;
  error: string;
  message: string;
};

export const VIEW_ERROR: ReplyError = {
  statusCode: 503,
  error: "Service Unavailable",
  message: "Unable to connect to Lyre",
};

export function registerRemote(fastify: FastifyInstance, manager: RemoteHost) {
  fastify.register(playlistGet(manager), {
    prefix: "/v1/playlist",
  });
  fastify.register(playlistPlay(manager), {
    prefix: "/v1/playlist/play",
  });
  fastify.register(playlistPlayback(manager), {
    prefix: "/v1/playlist/playback",
  });
  fastify.register(soundboardGet(manager), {
    prefix: "/v1/soundboard",
  });
  fastify.register(soundboardPlay(manager), {
    prefix: "/v1/soundboard/play",
  });
  fastify.register(soundboardStop(manager), {
    prefix: "/v1/soundboard/stop",
  });
  fastify.register(soundboardPlayback(manager), {
    prefix: "/v1/soundboard/playback",
  });
}
