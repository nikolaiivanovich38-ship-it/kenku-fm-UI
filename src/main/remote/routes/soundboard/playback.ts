import { FastifyPluginCallback } from "fastify";

import type { RemoteHost } from "../..";
import { VIEW_ERROR } from "../../";
import { SoundboardPlaybackReply } from "../../../../types/player";

export const playback: (manager: RemoteHost) => FastifyPluginCallback =
  (manager) => (fastify, _, done) => {
    fastify.get("/", async (_, reply) => {
      const view = manager.getView();
      if (view) {
        try {
          const playback = await manager.requests.ask<SoundboardPlaybackReply>(view, "soundboardPlayback");
          reply.status(200).send(playback);
        } catch {
          reply.status(408).send({
            statusCode: 408,
            error: "Request Timeout",
            message: "Unable to retrieve playback in a reasonable time",
          });
        }
      } else {
        reply.status(503).send(VIEW_ERROR);
      }
    });

    done();
  };
