import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createLyreWindowBridge } from "./preloadWindow";
import { WindowFrame, hexColour, windowButtonsSpace } from "./windowFrame";

describe("the window bridge (FND-16 step 2)", () => {
  it("sends the buttons' colours, exactly two #rrggbb values, and asks to maximise", () => {
    const ipc = { send: vi.fn() };
    const bridge = createLyreWindowBridge(ipc);
    bridge.setTitleBar({ color: "#0d1d18", symbolColor: "#f1e4c8", extra: 1 } as never);
    bridge.setTitleBar({ color: "red", symbolColor: "#f1e4c8" });
    bridge.toggleMaximise();
    expect(ipc.send.mock.calls).toEqual([["LYRE_TITLE_BAR", { color: "#0d1d18", symbolColor: "#f1e4c8" }], ["LYRE_WINDOW_MAXIMISE"]]);
  });
});

describe("where the window's buttons are (ROUND8.md §1)", () => {
  it("is the window's width less the free part of the title bar, in CSS pixels; none when the window draws no buttons", () => {
    expect(windowButtonsSpace({ visible: true, getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 822, height: 36 }) as DOMRect }, 960)).toEqual({ width: 138, height: 36 });
    // Text at 200 %: the same 138×36 screen pixels are half as many CSS pixels.
    expect(windowButtonsSpace({ visible: true, getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 411, height: 18 }) as DOMRect }, 480)).toEqual({ width: 69, height: 18 });
    expect(windowButtonsSpace({ visible: false, getTitlebarAreaRect: () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect }, 960)).toEqual({ width: 0, height: 0 });
    expect(windowButtonsSpace(undefined, 960)).toEqual({ width: 0, height: 0 });
  });

  it("reads colours as #rrggbb, and nothing for a see-through one", () => {
    expect(hexColour("rgb(13, 29, 24)")).toBe("#0d1d18");
    expect(hexColour("rgba(13, 29, 24, 1)")).toBe("#0d1d18");
    expect(hexColour("rgba(0, 0, 0, 0)")).toBeNull();
    expect(hexColour("transparent")).toBeNull();
  });
});

describe("WindowFrame", () => {
  function page() {
    return render(
      <div id="app">
        <main>
          <div className="viewhead" data-testid="strip">
            <button type="button">Back</button>
            <span data-testid="empty" />
          </div>
        </main>
        <WindowFrame bridge={bridge} paintKey="fern" />
      </div>,
    );
  }
  const bridge = { setTitleBar: vi.fn(), toggleMaximise: vi.fn() };

  it("asks to maximise on a double-click of an empty part of a strip, never of a control in it", () => {
    const { getByTestId, getByRole } = page();
    fireEvent.doubleClick(getByRole("button", { name: "Back" }));
    expect(bridge.toggleMaximise).not.toHaveBeenCalled();
    fireEvent.doubleClick(getByTestId("empty"));
    expect(bridge.toggleMaximise).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(document.body);
    expect(bridge.toggleMaximise).toHaveBeenCalledTimes(1);
  });

  it("keeps no space free where the window draws no buttons (a browser, a test)", () => {
    page();
    expect(document.getElementById("app")?.style.getPropertyValue("--wco-w")).toBe("0px");
    expect(document.getElementById("app")?.style.getPropertyValue("--wco-h")).toBe("0px");
  });
});
