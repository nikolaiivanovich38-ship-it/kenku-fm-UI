import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDisplay, createLyreDisplayBridge, zoomFactorOf } from "./display";

afterEach(() => {
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.contrast;
});

describe("Look and feel › Display on the page (UX-11)", () => {
  it("marks the page with the density and high contrast, and zooms it to the text size", () => {
    const zoom = vi.fn();
    applyDisplay({ density: "comfortable", textSize: 150, highContrast: true }, zoom);
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(zoom).toHaveBeenCalledWith(1.5);
    applyDisplay({ density: "compact", textSize: 100, highContrast: false }, zoom);
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.contrast).toBeUndefined();
    expect(zoom).toHaveBeenLastCalledWith(1);
  });

  it("keeps the zoom between 100 and 200 %, whatever it is given", () => {
    expect(zoomFactorOf(200)).toBe(2);
    expect(zoomFactorOf(300)).toBe(2);
    expect(zoomFactorOf(10)).toBe(1);
    expect(zoomFactorOf(Number.NaN)).toBe(1);
  });

  it("the page's bridge zooms the page only within 1 to 2, and never with anything but a number", () => {
    const frame = { setZoomFactor: vi.fn() };
    const bridge = createLyreDisplayBridge(frame);
    bridge.setZoom(1.25);
    bridge.setZoom(5);
    bridge.setZoom("2" as unknown as number);
    expect(frame.setZoomFactor.mock.calls).toEqual([[1.25], [2]]);
  });
});
