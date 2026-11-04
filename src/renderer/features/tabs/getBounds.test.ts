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

  it("assumes the expanded width before the sidebar is drawn", () => {
    expect(getBounds()).toMatchObject({ x: 240 });
  });
});
