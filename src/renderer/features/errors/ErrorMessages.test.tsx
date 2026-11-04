import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";

import errorsReducer, { errorShown } from "./errorsSlice";
import { ErrorMessages } from "./ErrorMessages";

function setup(messages: string[]) {
  const store = configureStore({ reducer: { errors: errorsReducer } });
  messages.forEach((message) => store.dispatch(errorShown({ message })));
  render(
    <Provider store={store}>
      <ErrorMessages />
    </Provider>,
  );
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ErrorMessages", () => {
  it("stays visible until the user closes it (WCAG 2.2.1)", () => {
    vi.useFakeTimers();
    const store = setup(["Couldn't connect to Discord."]);
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't connect to Discord.");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(store.getState().errors.list).toEqual([]);
  });

  it("is part of the page's layout, not a floating box over other controls", () => {
    const { container } = render(<div />);
    setup(["One"]);
    expect(screen.getByRole("alert").closest(".MuiSnackbar-root")).toBeNull();
    expect(container.ownerDocument.body).toContainElement(screen.getByRole("alert"));
  });

  it("shows each message, newest first", () => {
    setup(["Older", "Newer"]);
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(["Newer", "Older"]);
  });

  it("shows nothing without an error", () => {
    setup([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
