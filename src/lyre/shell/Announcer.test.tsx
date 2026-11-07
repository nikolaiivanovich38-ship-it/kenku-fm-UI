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

  it("shows a short note that goes away by itself (3 s); the note is always in the page, empty when nothing shows", () => {
    render(
      <AnnouncerProvider>
        <Trigger />
      </AnnouncerProvider>,
    );
    const toast = document.getElementById("lyre-toast")!;
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-atomic", "true");
    expect(toast).toBeEmptyDOMElement();
    act(() => screen.getByRole("button", { name: "Toast" }).click());
    expect(toast).toHaveTextContent("Nothing is ticked in Send to, so nobody would hear it");
    act(() => vi.advanceTimersByTime(2900));
    expect(toast).not.toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(200));
    expect(toast).toBeEmptyDOMElement();
  });
});

function Saver({ retry = () => undefined }: { retry?: () => void }) {
  const { saved, saveFailed, say } = useAnnounce();
  return (
    <>
      <input aria-label="Campaign notes" />
      <button type="button" onClick={() => saved("The Sunken Crown notes")}>Save notes</button>
      <button type="button" onClick={() => saved("name “Ashes”", { key: "rn-t13" })}>Save name</button>
      <button type="button" onClick={() => saved("The abbey ruins music", { detail: "2 tracks from position 3" })}>Drop</button>
      <button type="button" onClick={() => saveFailed("The Sunken Crown notes", retry)}>Fail</button>
      <button type="button" onClick={() => say("Repeat one on")}>Say</button>
    </>
  );
}

const renderSaver = (retry?: () => void) =>
  render(
    <AnnouncerProvider>
      <Saver retry={retry} />
    </AnnouncerProvider>,
  );
const press = (name: string) => act(() => screen.getByRole("button", { name }).click());

describe("the Saved pop-up (UX-19, round 6 part 5)", () => {
  it('says "Saved: " and what, with the detail after " · ", read out politely', () => {
    renderSaver();
    press("Drop");
    const pop = screen.getByRole("status");
    expect(pop).toHaveTextContent("Saved: The abbey ruins music · 2 tracks from position 3");
    expect(pop).toHaveAttribute("aria-live", "polite");
  });

  it("the same save within 2 s refreshes the one pop-up: one pop-up, not read out again, its 3 s start again", () => {
    renderSaver();
    press("Save notes");
    act(() => vi.advanceTimersByTime(1500));
    press("Save notes");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "off");
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByRole("status")).toHaveTextContent("Saved: The Sunken Crown notes");
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("a different save replaces it, read out", () => {
    renderSaver();
    press("Save notes");
    press("Save name");
    expect(screen.getByRole("status")).toHaveTextContent("Saved: name “Ashes”");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("is not read out right after the same event was announced (Could 14)", () => {
    renderSaver();
    press("Say");
    press("Save notes");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "off");
  });

  it("never takes focus", () => {
    renderSaver();
    const notes = screen.getByRole("textbox", { name: "Campaign notes" });
    notes.focus();
    act(() => screen.getByRole<HTMLButtonElement>("button", { name: "Save notes" }).click());
    expect(notes).toHaveFocus();
  });

  it("a failed save is an alert that says what to do, stays, and Try again runs the save again", () => {
    const retry = vi.fn();
    renderSaver(retry);
    press("Fail");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not saved: The Sunken Crown notes");
    expect(alert).toHaveTextContent("Lyre could not write it to your computer. Try again; if it fails again, check that the drive has space.");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved");
    act(() => screen.getByRole("button", { name: "Try again" }).click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("the failure can be dismissed, and goes by itself once the same thing is saved", () => {
    renderSaver();
    press("Fail");
    act(() => screen.getByRole("button", { name: "Dismiss: not saved: The Sunken Crown notes" }).click());
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    press("Fail");
    press("Save notes");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toHaveTextContent("Saved: The Sunken Crown notes");
  });
});
