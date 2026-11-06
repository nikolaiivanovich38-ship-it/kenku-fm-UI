/**
 * SEC-4: the remote-control server (Stream Deck, phone remotes) with its locks on.
 *
 * Every request, before any route sees it:
 *   1. at most REQUEST_LIMIT requests a minute from one network address (429 beyond);
 *   2. no `Origin` header: browsers add one to every request a web page makes, so a page cannot drive Lyre (403);
 *   3. a `Host` header that names this computer by number or as `localhost`, with the server's port: a web name
 *      pointed at this computer (DNS rebinding) is refused (403);
 *   4. the secret code as `Authorization: Bearer <code>`, compared in constant time (401 without it); after
 *      FAILURE_LIMIT wrong codes in FAILURE_WINDOW_MS an address is refused, even with the right code, until the
 *      window has passed (429).
 * Bodies are JSON only (fastify's text/plain reader is removed; 415 for anything else), so the "simple" requests
 * any web page may send without asking are not understood. Answers leave out file and track addresses, so they do
 * not show where the game master's files are.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import net from "net";

import { registerRemote, type RemoteHost } from ".";
import { RateLimit } from "./rateLimit";
import { codesMatch } from "./remoteCode";

export const REQUEST_LIMIT = 600;
export const REQUEST_WINDOW_MS = 60_000;
export const FAILURE_LIMIT = 10;
export const FAILURE_WINDOW_MS = 10 * 60_000;

/** Largest request body accepted: the remote's commands are a few bytes of JSON. */
const BODY_LIMIT = 16 * 1024;

export interface RemoteServerOptions {
  host: RemoteHost;
  /** The current secret code. */
  code: () => string;
  /** The port the server listens on, for the Host check. */
  port: () => number;
  now?: () => number;
}

export function createRemoteServer(options: RemoteServerOptions): FastifyInstance {
  const now = options.now ?? Date.now;
  const requestLimit = new RateLimit({ limit: REQUEST_LIMIT, windowMs: REQUEST_WINDOW_MS, now });
  const failureLimit = new RateLimit({ limit: FAILURE_LIMIT, windowMs: FAILURE_WINDOW_MS, now });

  const fastify = Fastify({ bodyLimit: BODY_LIMIT });
  fastify.removeContentTypeParser("text/plain");

  fastify.addHook("onRequest", async (request, reply) => {
    const caller = request.ip;
    const pace = requestLimit.hit(caller);
    if (!pace.allowed) {
      return refuse(reply, 429, "Too many requests. Wait a moment and try again.", pace.retryAfterMs ?? 0);
    }
    if (request.headers.origin !== undefined) {
      return refuse(reply, 403, "Lyre's remote control does not accept requests from web pages.");
    }
    if (!isAllowedHost(request.headers.host, options.port())) {
      return refuse(
        reply,
        403,
        "Reach Lyre by this computer's address in numbers (for example 127.0.0.1) and the remote control's port.",
      );
    }
    const lockout = failureLimit.check(caller);
    if (!lockout.allowed) {
      const retryAfterMs = lockout.retryAfterMs ?? 0;
      const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
      return refuse(
        reply,
        429,
        `Too many wrong codes. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
        retryAfterMs,
      );
    }
    if (!codesMatch(bearerCode(request), options.code())) {
      failureLimit.hit(caller);
      reply.header("www-authenticate", 'Bearer realm="Lyre"');
      return refuse(reply, 401, "The secret code is missing or wrong. Copy it from Lyre's Settings.");
    }
  });

  fastify.addHook("preSerialization", async (_request, _reply, payload) => stripFileAddresses(payload));

  registerRemote(fastify, options.host);
  return fastify;
}

function refuse(reply: FastifyReply, statusCode: number, message: string, retryAfterMs?: number) {
  if (retryAfterMs !== undefined) {
    reply.header("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  }
  const error = { 401: "Unauthorized", 403: "Forbidden", 429: "Too Many Requests" }[statusCode] ?? "Error";
  return reply.status(statusCode).send({ statusCode, error, message });
}

function bearerCode(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match ? match[1] : "";
}

/**
 * Whether a Host header names this computer the way a remote tool does: `localhost`, an IPv4 address or a
 * bracketed IPv6 address, with the server's port (no port only for port 80). Names other than localhost are what
 * DNS rebinding needs, so they are refused.
 */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const match = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/i.exec(host);
  if (!match) return false;
  const [, name, givenPort] = match;
  const portOk = givenPort === undefined ? port === 80 : Number(givenPort) === port;
  if (!portOk) return false;
  if (name.startsWith("[")) return net.isIPv6(name.slice(1, -1));
  return name.toLowerCase() === "localhost" || net.isIPv4(name);
}

/**
 * A copy of an answer without `url` keys (tracks and sounds) and without text that is a `file:` address (custom
 * backgrounds). Remote tools use ids and titles only.
 */
export function stripFileAddresses(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFileAddresses);
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "url" || (typeof item === "string" && /^file:/i.test(item))) continue;
    copy[key] = stripFileAddresses(item);
  }
  return copy;
}
