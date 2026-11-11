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

describe("clampToWorkArea (FND-16: Nik's 0.5.0 window ran past the taskbar and the screen's right edge)", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it("keeps a window that fits where it was", async () => {
    const { clampToWorkArea } = await import("./bounds");
    expect(clampToWorkArea({ x: 100, y: 50, width: 1200, height: 800 }, area, 800, 600)).toEqual({ x: 100, y: 50, width: 1200, height: 800 });
  });

  it("shrinks a saved size larger than the work area (a bottom taskbar takes 40 px) to fit it exactly", async () => {
    const { clampToWorkArea } = await import("./bounds");
    // The size Windows reports for a maximised window includes its invisible 8 px borders.
    expect(clampToWorkArea({ x: -8, y: -8, width: 1936, height: 1096 }, area, 800, 600)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    // Wider than the screen but short enough: the width is still brought in (until 0.5.1 only one had to fit).
    expect(clampToWorkArea({ x: 0, y: 0, width: 2400, height: 700 }, area, 800, 600)).toEqual({ x: 0, y: 0, width: 1920, height: 700 });
  });

  it("moves a window that hangs off an edge back inside, keeping its size", async () => {
    const { clampToWorkArea } = await import("./bounds");
    expect(clampToWorkArea({ x: 1500, y: 900, width: 1000, height: 700 }, area, 800, 600)).toEqual({ x: 920, y: 340, width: 1000, height: 700 });
    expect(clampToWorkArea({ x: -300, y: -20, width: 1000, height: 700 }, area, 800, 600)).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });

  it("works on a second screen and a work area that does not start at 0 (a taskbar at the top or left)", async () => {
    const { clampToWorkArea } = await import("./bounds");
    const right = { x: 1920, y: 40, width: 1280, height: 680 };
    expect(clampToWorkArea({ x: 1900, y: 0, width: 1400, height: 900 }, right, 800, 600)).toEqual({ x: 1920, y: 40, width: 1280, height: 680 });
  });

  it("never goes below Lyre's smallest size, unless the screen itself is smaller", async () => {
    const { clampToWorkArea } = await import("./bounds");
    expect(clampToWorkArea({ x: 10, y: 10, width: 300, height: 200 }, area, 800, 600)).toEqual({ x: 10, y: 10, width: 800, height: 600 });
    expect(clampToWorkArea({ x: 0, y: 0, width: 300, height: 200 }, { x: 0, y: 0, width: 700, height: 500 }, 800, 600)).toEqual({ x: 0, y: 0, width: 700, height: 500 });
  });

  it("restores saved bounds clamped to the display's work area", async () => {
    const bounds = await import("./bounds");
    mocks.values.set("bounds", { x: -8, y: -8, width: 1936, height: 1096 });
    // The mocked display's work area is 1920×1080.
    expect(bounds.getSavedBounds(800, 600).bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
