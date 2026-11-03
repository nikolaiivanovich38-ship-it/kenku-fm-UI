import { describe, expect, it, vi } from "vitest";

import { onAppError, showAppError } from "./appErrors";

describe("appErrors", () => {
  it("delivers a message to every listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onAppError(first);
    const stopSecond = onAppError(second);
    showAppError("That page was not opened.");
    expect(first).toHaveBeenCalledWith("That page was not opened.");
    expect(second).toHaveBeenCalledWith("That page was not opened.");
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
