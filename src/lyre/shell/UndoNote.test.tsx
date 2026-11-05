/** Undo for large changes, in a message like the board's resize message, and Ctrl+Z (w3-ux 10). */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryState } from "../../common/lyre/api";
import { PlaceholderScreen } from "../screens/Placeholder";
import { SCREENS } from "../screens";
import { Shell } from "./Shell";
import { ShellDataProvider, type ShellData } from "./ShellData";
import { useUndoNote } from "./UndoNote";

function Deleter() {
  const { offer } = useUndoNote();
  return (
    <>
      <PlaceholderScreen title="Pad boards" />
      <button type="button" onClick={() => offer('Deleted the pad board "Combat".', 'Delete board "Combat"')}>
        Delete
      </button>
      <input aria-label="Name" />
    </>
  );
}

function history(label: string | null = 'Delete board "Combat"') {
  let state: HistoryState = { canUndo: label !== null, canRedo: false, undoLabel: label, redoLabel: null };
  return {
    setLabel: (next: string | null) => (state = { ...state, undoLabel: next, canUndo: next !== null }),
    state: vi.fn(async () => state),
    undo: vi.fn(async () => ({ ok: true as const, value: { undone: state.undoLabel ?? "" }, changed: [], undoLabel: null })),
  };
}

function open(h: ReturnType<typeof history>, path = "boards") {
  window.history.replaceState(null, "", `#/${path}`);
  const data: ShellData = { history: h };
  render(
    <ShellDataProvider value={data}>
      <Shell screens={{ ...SCREENS, boards: Deleter, live: Deleter }} />
    </ShellDataProvider>,
  );
}

const note = () => screen.queryByRole("group", { name: "Undo" });

beforeEach(() => localStorage.clear());

describe("the undo message", () => {
  it("says what happened, with Undo and a close button; Undo undoes that change and says so", async () => {
    const h = history();
    open(h);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(note()).toHaveTextContent('Deleted the pad board "Combat".');
    await user.click(within(note()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(h.undo).toHaveBeenCalledOnce());
    await waitFor(() => expect(note()).toBeNull());
    expect(document.getElementById("lyre-toast")).toHaveTextContent('Undone: Delete board "Combat"');
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("does not undo something else that happened since", async () => {
    const h = history();
    open(h);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    h.setLabel('Rename "Weather"');
    await user.click(within(note()!).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent("That cannot be undone here any more: something else changed since."));
    expect(h.undo).not.toHaveBeenCalled();
    expect(note()).toBeNull();
  });

  it("closes without undoing", async () => {
    const h = history();
    open(h);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(note()!).getByRole("button", { name: "Dismiss message" }));
    expect(note()).toBeNull();
    expect(h.undo).not.toHaveBeenCalled();
  });
});

describe("Ctrl+Z", () => {
  it("undoes the library's last change and says what it undid", async () => {
    const h = history('Tag 2 tracks');
    open(h);
    const user = userEvent.setup();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(h.undo).toHaveBeenCalledOnce());
    expect(document.getElementById("lyre-toast")).toHaveTextContent("Undone: Tag 2 tracks");
  });

  it("is left to a text field while typing", async () => {
    const h = history();
    open(h);
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Control>}z{/Control}");
    await act(async () => undefined);
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("is left to Live, which has its own Undo", async () => {
    const h = history();
    open(h, "live");
    await userEvent.setup().keyboard("{Control>}z{/Control}");
    await act(async () => undefined);
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("says when there is nothing to undo", async () => {
    const h = history(null);
    open(h);
    await userEvent.setup().keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent("Nothing to undo."));
    expect(h.undo).not.toHaveBeenCalled();
  });
});
