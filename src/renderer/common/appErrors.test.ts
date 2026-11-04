import { describe, expect, it, vi } from "vitest";

import { onAppError, showAppError } from "./appErrors";

describe("appErrors", () => {
  it("delivers a message, and what it is about, to every listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onAppError(first);
    const stopSecond = onAppError(second);
    showAppError("That page was not opened.", { kind: "address" });
    expect(first).toHaveBeenCalledWith("That page was not opened.", { kind: "address" });
    expect(second).toHaveBeenCalledWith("That page was not opened.", { kind: "address" });
    stopFirst();
    stopSecond();
  });

  it("stops delivering once unsubscribed", () => {
    const listener = vi.fn();
    onAppError(listener)();
    showAppError("Ignored");
    expect(listener).not.toHaveBeenCalled();
  });
});
