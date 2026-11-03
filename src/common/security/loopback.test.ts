import { describe, expect, it } from "vitest";
import { LOOPBACK_HOST, toLoopbackWebSocketUrl } from "./loopback";

describe("toLoopbackWebSocketUrl (SEC-2)", () => {
  it("always targets 127.0.0.1, never a name that might resolve elsewhere", () => {
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
    expect(toLoopbackWebSocketUrl(51234)).toBe("ws://127.0.0.1:51234");
  });

  it.each([0, -1, 65536, 1.5, NaN, "80" as unknown as number])(
    "rejects invalid port %j",
    (port) => {
      expect(() => toLoopbackWebSocketUrl(port)).toThrow(/port/i);
    },
  );
});
