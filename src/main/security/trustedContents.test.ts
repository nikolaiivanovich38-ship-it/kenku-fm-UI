import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { TrustedContentsRegistry } from "./trustedContents";

function fakeContents(id: number) {
  return Object.assign(new EventEmitter(), { id });
}

describe("TrustedContentsRegistry (SEC-3)", () => {
  it("returns null for unknown or missing web contents", () => {
    const registry = new TrustedContentsRegistry();
    expect(registry.roleOf(fakeContents(1))).toBeNull();
    expect(registry.roleOf(null)).toBeNull();
    expect(registry.roleOf(undefined)).toBeNull();
  });

  it("remembers the role of a trusted page", () => {
    const registry = new TrustedContentsRegistry();
    const contents = fakeContents(7);
    registry.trust(contents, "player-view");
    expect(registry.roleOf(contents)).toBe("player-view");
    expect(registry.roleOf(fakeContents(8))).toBeNull();
  });

  it("forgets a page once it is destroyed so its id cannot be reused", () => {
    const registry = new TrustedContentsRegistry();
    const contents = fakeContents(3);
    registry.trust(contents, "main-window");
    contents.emit("destroyed");
    expect(registry.roleOf(fakeContents(3))).toBeNull();
  });

  it("can forget a page explicitly", () => {
    const registry = new TrustedContentsRegistry();
    const contents = fakeContents(4);
    registry.trust(contents, "audio-capture");
    registry.forget(contents);
    expect(registry.roleOf(contents)).toBeNull();
  });
});
