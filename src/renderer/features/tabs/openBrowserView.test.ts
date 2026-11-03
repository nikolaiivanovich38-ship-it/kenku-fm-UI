import { beforeEach, describe, expect, it, vi } from "vitest";

const kenku = vi.hoisted(() => {
  const api = { platform: "win32", createBrowserView: vi.fn() };
  Object.assign(window, { kenku: api });
  return api;
});

vi.mock("./getBounds", () => ({
  getBounds: () => ({ x: 240, y: 80, width: 800, height: 600 }),
}));

import { isCreatedViewId, openBrowserView } from "./openBrowserView";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("isCreatedViewId", () => {
  it.each<[unknown, boolean]>([
    [1, true],
    [42, true],
    [-1, false],
    [0, false],
    [1.5, false],
    [undefined, false],
    ["3", false],
  ])("%j -> %j", (id, expected) => {
    expect(isCreatedViewId(id)).toBe(expected);
  });
});

describe("openBrowserView", () => {
  it("creates a view at the content bounds and returns its id", async () => {
    kenku.createBrowserView.mockResolvedValue(7);
    await expect(openBrowserView("https://example.com/")).resolves.toBe(7);
    expect(kenku.createBrowserView).toHaveBeenCalledWith(
      "https://example.com/",
      240,
      80,
      800,
      600,
      undefined,
    );
  });

  it("passes the preload for the player view", async () => {
    kenku.createBrowserView.mockResolvedValue(3);
    await openBrowserView("player.html", "preload.js");
    expect(kenku.createBrowserView).toHaveBeenLastCalledWith(
      "player.html",
      240,
      80,
      800,
      600,
      "preload.js",
    );
  });

  it("returns undefined when the main process refused the view", async () => {
    // -1 is also the player's "not created yet" id, so it must never be stored.
    kenku.createBrowserView.mockResolvedValue(-1);
    await expect(openBrowserView("https://example.com/")).resolves.toBeUndefined();
  });
});
