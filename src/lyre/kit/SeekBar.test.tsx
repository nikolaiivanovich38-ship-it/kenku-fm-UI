/**
 * SeekBar (0.5.1, Nik 11 Nov: "I can't click and interact with the tracking bar … and choose to skip to a certain
 * point in the track"): the standard slider pattern for a playing track's position.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { SeekBar } from "./SeekBar";

function show(position: number | null = 83, length: number | null = 245) {
  const onSeek = vi.fn();
  render(<SeekBar name="Ashes" position={position} length={length} lane="music" onSeek={onSeek} />);
  return { onSeek, bar: screen.getByRole("slider", { name: "Position in Ashes" }) };
}

describe("SeekBar", () => {
  it("is a slider named for the track, its value in seconds and in words (1:23 of 4:05)", async () => {
    const { bar } = show();
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "245");
    expect(bar).toHaveAttribute("aria-valuenow", "83");
    expect(bar).toHaveAttribute("aria-valuetext", "1:23 of 4:05");
    expect(bar).toHaveAttribute("tabindex", "0");
    await expectNoAxeViolations();
  });

  it("Left and Right move 5 s, Home goes to the start and End to the end, inside the track", async () => {
    const { bar, onSeek } = show();
    bar.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenLastCalledWith(88);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(78);
    await userEvent.keyboard("{Home}");
    expect(onSeek).toHaveBeenLastCalledWith(0);
    await userEvent.keyboard("{End}");
    expect(onSeek).toHaveBeenLastCalledWith(245);
    onSeek.mockClear();
    render(<SeekBar name="Rain" position={2} length={245} lane="amb" onSeek={onSeek} />);
    screen.getByRole("slider", { name: "Position in Rain" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it("a click or a drag jumps to that point of the bar, once, when let go; the slider shows it while dragging", () => {
    const { bar, onSeek } = show();
    bar.getBoundingClientRect = () => ({ left: 100, right: 300, width: 200, top: 0, bottom: 24, height: 24, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(bar, { clientX: 150, pointerId: 1, button: 0 });
    fireEvent.pointerMove(bar, { clientX: 200, pointerId: 1 });
    expect(bar).toHaveAttribute("aria-valuetext", "2:03 of 4:05");
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.pointerUp(bar, { clientX: 200, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(122.5);
  });

  it("while the length is not known it is greyed and does nothing", async () => {
    const { bar, onSeek } = show(null, null);
    expect(bar).toHaveAttribute("aria-disabled", "true");
    expect(bar).toHaveAttribute("aria-valuetext", "Loading");
    bar.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSeek).not.toHaveBeenCalled();
  });
});
