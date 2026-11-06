import { FastifyPluginCallback } from "fastify";

import type { RemoteHost } from "../..";
import { VIEW_ERROR } from "../..";
import { SoundboardsReply } from "../../../../types/player";

export const get: (manager: RemoteHost) => FastifyPluginCallback =
  (manager) => (fastify, _, done) => {
    fastify.get("/", async (_, reply) => {
      const view = manager.getView();
      if (view) {
        try {
          const soundboards = await manager.requests.ask<SoundboardsReply>(view, "soundboards");
          reply.status(200).send(soundboards);
        } catch {
          reply.status(408).send({
            statusCode: 408,
            error: "Request Timeout",
            message: "Unable to retrieve soundboards in a reasonable time",
          });
        }
      } else {
        reply.status(503).send(VIEW_ERROR);
      }
    });

    done();
  };
