import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportSaveError, saveErrorMessage, setSaveErrorHandler, useSaveErrorMessages } from "./saveErrors";

/** PERF-6: failed saves of the player library are shown to the user. */
afterEach(() => {
  setSaveErrorHandler(null);
});

describe("save error messages (PERF-6)", () => {
  it("says what went wrong in plain words", () => {
    expect(saveErrorMessage(new DOMException("exceeded the quota", "QuotaExceededError"))).toBe(
      "Your changes could not be saved: there is not enough storage space. They will be retried.",
    );
    expect(saveErrorMessage(new Error("The disk is locked."))).toBe(
      "Your changes could not be saved: The disk is locked. They will be retried.",
    );
    expect(saveErrorMessage("odd")).toBe("Your changes could not be saved: odd. They will be retried.");
  });

  it("passes failures to the player's error message", () => {
    const onError = vi.fn();
    const { unmount } = renderHook(() => useSaveErrorMessages(onError));
    reportSaveError(new Error("Disk full"));
    expect(onError).toHaveBeenCalledWith("Your changes could not be saved: Disk full. They will be retried.");
    unmount();
    reportSaveError(new Error("later"));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure from before the player was shown and shows it then", () => {
    reportSaveError(new Error("Disk full"));
    const onError = vi.fn();
    renderHook(() => useSaveErrorMessages(onError));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Your changes could not be saved: Disk full. They will be retried.");
  });
});
