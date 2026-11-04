import { describe, expect, it } from "vitest";
import { isErrorCause } from "./errorCause";

describe("isErrorCause (UX finding 4)", () => {
  it("accepts the two kinds of cause the main process sends", () => {
    expect(isErrorCause({ kind: "output", id: "bot-1" })).toBe(true);
    expect(isErrorCause({ kind: "address" })).toBe(true);
  });

  it.each([undefined, null, "output", { kind: "output" }, { kind: "output", id: 3 }, { kind: "file" }])(
    "ignores anything else: %j",
    (value) => {
      expect(isErrorCause(value)).toBe(false);
    },
  );
});
