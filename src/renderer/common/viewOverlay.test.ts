import { afterEach, describe, expect, it, vi } from "vitest";
import { SIDE_PANEL_ATTRIBUTE, readViewOverlay, watchViewOverlay } from "./viewOverlay";

/** A portal like the ones MUI puts at the end of <body> for a Dialog, Menu or Popover. */
function addModal(options: { sidePanel?: boolean; right?: number; hidden?: boolean } = {}) {
  const root = document.createElement("div");
  root.className = "MuiModal-root" + (options.hidden ? " MuiModal-hidden" : "");
  if (options.sidePanel) {
    root.setAttribute(SIDE_PANEL_ATTRIBUTE, "");
  }
  root.getBoundingClientRect = () => ({ right: options.right ?? 0 }) as DOMRect;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readViewOverlay (UX finding 1)", () => {
  it("leaves the website or player view alone when nothing is open", () => {
    expect(readViewOverlay(document)).toEqual({ hidden: false, inset: 0 });
  });

  it("hides the view while a dialog, menu or popover is open over it", () => {
    addModal();
    expect(readViewOverlay(document)).toEqual({ hidden: true, inset: 0 });
  });

  it("moves the view to the right of a side panel such as Settings instead of hiding it", () => {
    addModal({ sidePanel: true, right: 360.4 });
    expect(readViewOverlay(document)).toEqual({ hidden: false, inset: 361 });
  });

  it("hides the view when a dialog opens on top of a side panel", () => {
    addModal({ sidePanel: true, right: 360 });
    addModal();
    expect(readViewOverlay(document)).toEqual({ hidden: true, inset: 360 });
  });

  it("ignores a closed dialog that is kept in the page", () => {
    addModal({ hidden: true });
    expect(readViewOverlay(document)).toEqual({ hidden: false, inset: 0 });
  });
});

describe("watchViewOverlay", () => {
  it("reports each change once, as dialogs open and close", async () => {
    const changes: unknown[] = [];
    const stop = watchViewOverlay(document, window, (overlay) => changes.push(overlay));
    const modal = addModal();
    await vi.waitFor(() => expect(changes).toEqual([{ hidden: true, inset: 0 }]));
    modal.remove();
    await vi.waitFor(() => expect(changes).toEqual([{ hidden: true, inset: 0 }, { hidden: false, inset: 0 }]));
    stop();
    addModal();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toHaveLength(2);
  });
});
