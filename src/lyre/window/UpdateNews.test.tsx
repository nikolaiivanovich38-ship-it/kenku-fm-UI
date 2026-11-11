import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UpdateState, UpdatesBridge } from "../../common/appUpdates";
import { AnnouncerProvider } from "../shell/Announcer";
import { UpdateNews, nextNews } from "./UpdateNews";

const OFFLINE = "Lyre could not check for updates: this computer seems to be offline. It tries again every 15 minutes; this version keeps working.";

function fakeUpdates(first: UpdateState = { kind: "checking" }) {
  const listeners = new Set<(state: UpdateState) => void>();
  const bridge: UpdatesBridge & { report(state: UpdateState): void } = {
    get: async () => first,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restart: vi.fn(),
    report: (state) => act(() => listeners.forEach((l) => l(state))),
  };
  return bridge;
}

function open(bridge: UpdatesBridge) {
  render(
    <AnnouncerProvider>
      <UpdateNews bridge={bridge} />
    </AnnouncerProvider>,
  );
}

describe("update news (FND-16 step 5, ROUND8.md §2)", () => {
  it("an update that has downloaded says so with Restart now, and stays until dismissed", async () => {
    const updates = fakeUpdates();
    open(updates);
    updates.report({ kind: "ready", message: "Lyre has an update. Restart Lyre to use it." });
    const note = (await screen.findByText("Lyre has an update. Restart Lyre to use it.")).closest<HTMLElement>("[role=status]")!;
    expect(note.closest("#lyre-update-slot")).not.toBeNull();
    await userEvent.click(within(note).getByRole("button", { name: "Restart now" }));
    expect(updates.restart).toHaveBeenCalledTimes(1);
    await userEvent.click(within(note).getByRole("button", { name: "Dismiss: Lyre has an update" }));
    expect(screen.queryByText("Lyre has an update. Restart Lyre to use it.")).toBeNull();
  });

  it("a failure is shown once, as a warning card that says what to do, until dismissed; a repeat is not shown", async () => {
    const updates = fakeUpdates();
    open(updates);
    updates.report({ kind: "error", message: OFFLINE, failedAt: 1, tell: true });
    const card = (await screen.findByText(/^Lyre could not check/)).closest<HTMLElement>("[role=alert]")!;
    expect(within(card).getByText("Lyre could not check for updates: this computer seems to be offline.").tagName).toBe("B");
    expect(card).toHaveTextContent("It tries again every 15 minutes; this version keeps working.");
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss: Lyre could not check for updates: this computer seems to be offline." }));
    expect(screen.queryByText(/^Lyre could not check/)).toBeNull();
    updates.report({ kind: "checking" });
    updates.report({ kind: "error", message: OFFLINE, failedAt: 2, tell: false });
    expect(screen.queryByText(/^Lyre could not check/)).toBeNull();
    updates.report({ kind: "up-to-date", checkedAt: 3 });
    updates.report({ kind: "error", message: OFFLINE, failedAt: 4, tell: true });
    expect(await screen.findByText(/^Lyre could not check/)).toBeInTheDocument();
  });

  it("an update that downloaded before the page opened is still news", async () => {
    open(fakeUpdates({ kind: "ready", message: "Lyre has an update. Restart Lyre to use it." }));
    expect(await screen.findByRole("button", { name: "Restart now" })).toBeInTheDocument();
  });

  it("nothing outside the app", () => {
    open(null as never);
    expect(document.getElementById("lyre-update-slot")?.childElementCount).toBe(0);
  });

  it("a ready update takes the failure's place", () => {
    expect(nextNews({ ready: null, failure: "x" }, { kind: "ready", message: "r" })).toEqual({ ready: "r", failure: null });
  });
});
