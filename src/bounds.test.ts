import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructed: 0,
  values: new Map<string, unknown>(),
}));

vi.mock("electron", () => ({
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));
vi.mock("electron-store", () => ({
  default: class {
    constructor() {
      mocks.constructed += 1;
    }
    get(key: string) {
      return mocks.values.get(key);
    }
    set(key: string, value: unknown) {
      mocks.values.set(key, value);
    }
  },
}));

describe("window position store (FND-1)", () => {
  it("does not open config.json when the module is imported, so the data carry-over runs first", async () => {
    const bounds = await import("./bounds");
    expect(mocks.constructed).toBe(0);

    mocks.values.set("bounds", { x: 10, y: 20, width: 900, height: 700 });
    expect(bounds.getSavedBounds(800, 600)).toEqual({
      bounds: { x: 10, y: 20, width: 900, height: 700 },
      maximized: undefined,
    });
    expect(mocks.constructed).toBe(1);

    bounds.getSavedBounds(800, 600);
    expect(mocks.constructed).toBe(1);
  });
});
