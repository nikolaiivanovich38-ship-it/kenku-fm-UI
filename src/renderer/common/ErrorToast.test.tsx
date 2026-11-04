import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import { ErrorToast } from "./ErrorToast";

afterEach(() => {
  vi.useRealTimers();
});

describe("ErrorToast", () => {
  it("stays visible until the user closes it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ErrorToast error="Couldn't connect to Discord." onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't connect to Discord.",
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way of dialog buttons at the bottom (top centre)", () => {
    render(<ErrorToast error="Couldn't connect to Discord." onClose={() => undefined} />);
    expect(screen.getByRole("alert").closest(".MuiSnackbar-root")).toHaveClass(
      "MuiSnackbar-anchorOriginTopCenter",
    );
  });

  it("is placed outside the app's root, so an open dialog does not hide it from screen readers", () => {
    const { container } = render(
      <ErrorToast error="Couldn't connect to Discord." onClose={() => undefined} />,
    );
    expect(container).not.toContainElement(screen.getByRole("alert"));
    expect(document.body).toContainElement(screen.getByRole("alert"));
  });

  it("shows nothing without an error", () => {
    render(<ErrorToast onClose={() => undefined} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
