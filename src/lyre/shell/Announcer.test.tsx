import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AnnouncerProvider, useAnnounce } from "./Announcer";

function Trigger() {
  const { say, toast } = useAnnounce();
  return (
    <>
      <button type="button" onClick={() => say("Scene: Crypt ambush")}>Say</button>
      <button type="button" onClick={() => toast("Nothing is ticked in Send to, so nobody would hear it")}>Toast</button>
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("announcements (A11Y-3): the polite live region and the toast", () => {
  it("speaks through a polite live region that is out of sight, clearing it first so a repeat is heard", () => {
    const { container } = render(
      <AnnouncerProvider>
        <Trigger />
      </AnnouncerProvider>,
    );
    const live = container.ownerDocument.getElementById("lyre-live")!;
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveClass("sr-only");
    act(() => screen.getByRole("button", { name: "Say" }).click());
    expect(live).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(40));
    expect(live).toHaveTextContent("Scene: Crypt ambush");
  });

  it("shows a short note that goes away by itself", () => {
    render(
      <AnnouncerProvider>
        <Trigger />
      </AnnouncerProvider>,
    );
    const toast = document.getElementById("lyre-toast")!;
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).not.toBeVisible();
    act(() => screen.getByRole("button", { name: "Toast" }).click());
    expect(toast).toBeVisible();
    expect(toast).toHaveTextContent("Nothing is ticked in Send to, so nobody would hear it");
    act(() => vi.advanceTimersByTime(2300));
    expect(toast).not.toBeVisible();
  });
});
