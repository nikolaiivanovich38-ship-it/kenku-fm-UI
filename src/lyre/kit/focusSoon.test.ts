import { afterEach, describe, expect, it, vi } from "vitest";
import { focusSoon } from "./focusSoon";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function button(k: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.dataset.k = k;
  document.body.append(b);
  return b;
}

describe("focusSoon (UX-R4): focus to a neighbour when the control in use goes", () => {
  it("waits until the control in use has gone, then focuses the first one drawn", () => {
    vi.useFakeTimers();
    const used = button("x1");
    const next = button("x2");
    used.focus();
    focusSoon(['[data-k="x2"]']);
    vi.advanceTimersByTime(100);
    expect(used).toHaveFocus();
    used.remove();
    vi.advanceTimersByTime(100);
    expect(next).toHaveFocus();
  });

  it("with move, focuses the new control as soon as it is drawn", () => {
    vi.useFakeTimers();
    const add = button("add");
    add.focus();
    focusSoon(['[data-k="room"]'], { move: true });
    vi.advanceTimersByTime(100);
    const room = button("room");
    vi.advanceTimersByTime(100);
    expect(room).toHaveFocus();
  });

  it("leaves focus alone once the person has moved it, and gives up after its time", () => {
    vi.useFakeTimers();
    const used = button("x1");
    const other = button("other");
    used.focus();
    focusSoon(['[data-k="late"]'], { ms: 500 });
    used.remove();
    other.focus();
    button("late");
    vi.advanceTimersByTime(1000);
    expect(other).toHaveFocus();
  });
});
