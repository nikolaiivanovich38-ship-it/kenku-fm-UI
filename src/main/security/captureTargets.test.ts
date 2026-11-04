import { describe, expect, it } from "vitest";
import { CaptureTargetRegistry } from "./captureTargets";

function fakeContents(id: number) {
  const listeners: (() => void)[] = [];
  return {
    id,
    once: (_event: "destroyed", listener: () => void) => listeners.push(listener),
    destroy: () => listeners.forEach((listener) => listener()),
  };
}

describe("CaptureTargetRegistry (SEC-3)", () => {
  it("knows a page only after the app chose to capture it", () => {
    const registry = new CaptureTargetRegistry();
    const player = fakeContents(3);
    expect(registry.has(player)).toBe(false);
    registry.allow(player);
    expect(registry.has(player)).toBe(true);
    expect(registry.has({ id: 4 })).toBe(false);
  });

  it("forgets a page when its capture stops", () => {
    const registry = new CaptureTargetRegistry();
    const tab = fakeContents(7);
    registry.allow(tab);
    registry.revoke(tab);
    expect(registry.has(tab)).toBe(false);
  });

  it("forgets every page when all captures stop", () => {
    const registry = new CaptureTargetRegistry();
    const a = fakeContents(7);
    const b = fakeContents(8);
    registry.allow(a);
    registry.allow(b);
    registry.revokeAll();
    expect(registry.has(a) || registry.has(b)).toBe(false);
  });

  it("forgets a page when it is destroyed, so a reused id is not trusted", () => {
    const registry = new CaptureTargetRegistry();
    const tab = fakeContents(9);
    registry.allow(tab);
    tab.destroy();
    expect(registry.has({ id: 9 })).toBe(false);
  });

  it("does not answer for missing contents", () => {
    expect(new CaptureTargetRegistry().has(null)).toBe(false);
  });
});
