import { describe, expect, it } from "vitest";
import { sidebarSpace } from "./sidebar";

describe("the sidebar's space (UX-10, w3-ux 4)", () => {
  it("is 240 px expanded, 56 px collapsed, and wider with error messages beside the icons", () => {
    expect(sidebarSpace(false, false)).toBe(240);
    expect(sidebarSpace(true, false)).toBe(56);
    expect(sidebarSpace(true, true)).toBe(304);
  });

  it("is nothing while the Lyre tab is open, so Lyre gets the window's width", () => {
    expect(sidebarSpace(false, false, true)).toBe(0);
    expect(sidebarSpace(true, false, true)).toBe(0);
  });

  it("comes back on the Lyre tab while there are error messages to read", () => {
    expect(sidebarSpace(true, true, true)).toBe(304);
    expect(sidebarSpace(false, true, true)).toBe(240);
  });
});
