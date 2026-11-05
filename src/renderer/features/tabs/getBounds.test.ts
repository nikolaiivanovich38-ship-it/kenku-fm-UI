import { afterEach, describe, expect, it } from "vitest";
import { getBounds } from "./getBounds";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getBounds (UX-10)", () => {
  it("places views right of the expanded sidebar", () => {
    document.body.innerHTML = '<nav id="sidebar" data-width="240"></nav><div id="controls"></div>';
    expect(getBounds()).toMatchObject({ x: 240, width: window.innerWidth - 240 });
  });

  it("follows the sidebar when it is collapsed", () => {
    document.body.innerHTML = '<nav id="sidebar" data-width="56"></nav><div id="controls"></div>';
    expect(getBounds()).toMatchObject({ x: 56, width: window.innerWidth - 56 });
  });

  it("starts right of an open side panel that is wider than the sidebar (UX finding 8)", () => {
    document.body.innerHTML = '<nav id="sidebar" data-width="56"></nav><div id="controls"></div>';
    const panel = document.createElement("div");
    panel.className = "MuiModal-root";
    panel.setAttribute("data-side-panel", "");
    panel.getBoundingClientRect = () => ({ right: 400 }) as DOMRect;
    document.body.appendChild(panel);
    expect(getBounds()).toMatchObject({ x: 400, width: window.innerWidth - 400 });
  });

  it("takes the whole width when the sidebar steps aside for the Lyre tab (w3-ux 4)", () => {
    document.body.innerHTML = '<nav id="sidebar" data-width="0"></nav><div id="controls"></div>';
    expect(getBounds()).toMatchObject({ x: 0, width: window.innerWidth });
  });

  it("assumes the expanded width before the sidebar is drawn", () => {
    expect(getBounds()).toMatchObject({ x: 240 });
  });
});
