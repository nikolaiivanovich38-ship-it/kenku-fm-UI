import { beforeEach, describe, expect, it, vi } from "vitest";

const kenku = vi.hoisted(() => {
  const api = { platform: "win32", createBrowserView: vi.fn(), openLocalFile: vi.fn() };
  Object.assign(window, { kenku: api });
  return api;
});

vi.mock("./getBounds", () => ({
  getBounds: () => ({ x: 240, y: 80, width: 800, height: 600 }),
}));

import { isCreatedViewId, openBrowserView, openLocalFileView } from "./openBrowserView";

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

  it("asks for the player view by kind", async () => {
    kenku.createBrowserView.mockResolvedValue(3);
    await openBrowserView("player.html", "player");
    expect(kenku.createBrowserView).toHaveBeenLastCalledWith(
      "player.html",
      240,
      80,
      800,
      600,
      "player",
    );
  });

  it("returns undefined when the main process refused the view", async () => {
    // -1 is also the player's "not created yet" id, so it must never be stored.
    kenku.createBrowserView.mockResolvedValue(-1);
    await expect(openBrowserView("https://example.com/")).resolves.toBeUndefined();
  });
});

describe("openLocalFileView (SEC-15)", () => {
  it("asks the main process for a file tab at the content bounds", async () => {
    kenku.openLocalFile.mockResolvedValue(12);
    await expect(openLocalFileView("file:///C:/Maps/index.html")).resolves.toBe(12);
    expect(kenku.openLocalFile).toHaveBeenCalledWith("file:///C:/Maps/index.html", 240, 80, 800, 600);
  });

  it("returns undefined, without logging an error, when the user said no", async () => {
    kenku.openLocalFile.mockResolvedValue(-1);
    await expect(openLocalFileView("file:///C:/Maps/index.html")).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });
});
