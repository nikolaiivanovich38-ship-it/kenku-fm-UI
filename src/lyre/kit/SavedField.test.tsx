import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { SAVE_AFTER_MS, SavedField } from "./SavedField";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(multiline = false) {
  const onSave = vi.fn();
  render(<SavedField aria-label="Notes" value="" onSave={onSave} multiline={multiline} />);
  return { onSave, field: screen.getByRole("textbox", { name: "Notes" }) };
}

describe("a field that saves itself (UX-19): on Enter, on leaving it, or after a second without typing", () => {
  it("never saves per key: one save a second after the typing stops", () => {
    const { onSave, field } = setup();
    for (const text of ["B", "Br", "Bri", "Brin", "Bring"]) {
      fireEvent.change(field, { target: { value: text } });
      act(() => vi.advanceTimersByTime(300));
    }
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SAVE_AFTER_MS));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("Bring");
    expect(SAVE_AFTER_MS).toBe(1000);
  });

  it("saves at once on leaving the field", () => {
    const { onSave, field } = setup();
    fireEvent.change(field, { target: { value: "Bring dice" } });
    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledWith("Bring dice");
    act(() => vi.advanceTimersByTime(SAVE_AFTER_MS));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saves at once on Enter in a one-line field, and not in a text area", () => {
    const one = setup();
    fireEvent.change(one.field, { target: { value: "Ashes" } });
    fireEvent.keyDown(one.field, { key: "Enter" });
    expect(one.onSave).toHaveBeenCalledWith("Ashes");
  });

  it("Enter in a text area is a new line, saved after the pause", () => {
    const onSave = vi.fn();
    render(<SavedField aria-label="Longer notes" value="" onSave={onSave} multiline />);
    const field = screen.getByRole("textbox", { name: "Longer notes" });
    fireEvent.change(field, { target: { value: "One" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("leaving it without a change saves nothing", () => {
    const { onSave, field } = setup();
    fireEvent.focus(field);
    fireEvent.blur(field);
    expect(onSave).not.toHaveBeenCalled();
  });
});
