/**
 * SEC-2: the internal audio socket must only ever be reachable from this
 * computer. Using the literal IPv4 loopback address (not "localhost", which
 * may resolve to ::1 or be overridden) keeps the server bind address and the
 * client connect address identical.
 */
export const LOOPBACK_HOST = "127.0.0.1";

/** WebSocket address of a server bound to `LOOPBACK_HOST` on `port`. */
export function toLoopbackWebSocketUrl(port: number): string {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid audio socket port: ${String(port)}`);
  }
  return `ws://${LOOPBACK_HOST}:${port}`;
}
