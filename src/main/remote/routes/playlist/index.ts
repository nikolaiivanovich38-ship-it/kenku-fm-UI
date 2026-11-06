import { FastifyPluginCallback } from "fastify";

import type { RemoteHost } from "../..";
import { VIEW_ERROR } from "../..";
import { PlaylistsReply } from "../../../../types/player";

export const get: (manager: RemoteHost) => FastifyPluginCallback =
  (manager) => (fastify, _, done) => {
    fastify.get("/", async (_, reply) => {
      const view = manager.getView();
      if (view) {
        try {
          const playlists = await manager.requests.ask<PlaylistsReply>(view, "playlists");
          reply.status(200).send(playlists);
        } catch {
          reply.status(408).send({
            statusCode: 408,
            error: "Request Timeout",
            message: "Unable to retrieve playlists in a reasonable time",
          });
        }
      } else {
        reply.status(503).send(VIEW_ERROR);
      }
    });

    done();
  };
