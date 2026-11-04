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

describe("CaptureTargetRegistry.isCaptureRequest (SEC-3)", () => {
  // Chromium raises tab capture on the captured page, but with the origin of
  // the page that called getUserMedia: the capture window. A website asking
  // for its own screen or desktop audio raises the same request with its own
  // origin (found in the WP1 review).
  const packaged = "file:///C:/Program%20Files/Cue%20Desk/resources/app.asar/.webpack/renderer/audio_capture_window/index.html";

  function registryCapturing(contents: ReturnType<typeof fakeContents>, capturerUrl = packaged) {
    const registry = new CaptureTargetRegistry();
    registry.setCapturer(capturerUrl);
    registry.allow(contents);
    return registry;
  }

  it("accepts the capture window's request for a chosen page", () => {
    const tab = fakeContents(5);
    expect(registryCapturing(tab).isCaptureRequest(tab, "file:///")).toBe(true);
  });

  it("refuses a chosen page asking with its own origin (screen or desktop capture)", () => {
    const tab = fakeContents(5);
    const registry = registryCapturing(tab);
    expect(registry.isCaptureRequest(tab, "https://www.youtube.com/")).toBe(false);
    expect(registry.isCaptureRequest(tab, "http://127.0.0.1:4000/")).toBe(false);
    expect(registry.isCaptureRequest(tab, "")).toBe(false);
    expect(registry.isCaptureRequest(tab, undefined)).toBe(false);
  });

  it("refuses a page the app is not capturing, even with the capture window's origin", () => {
    const registry = registryCapturing(fakeContents(5));
    expect(registry.isCaptureRequest({ id: 6 }, "file:///")).toBe(false);
  });

  it("matches a development capture window served over http", () => {
    const tab = fakeContents(5);
    const registry = registryCapturing(tab, "http://localhost:3000/audio_capture_window");
    expect(registry.isCaptureRequest(tab, "http://localhost:3000/")).toBe(true);
    expect(registry.isCaptureRequest(tab, "http://localhost:3001/")).toBe(false);
  });

  it("refuses everything before the capture window is known", () => {
    const registry = new CaptureTargetRegistry();
    const tab = fakeContents(5);
    registry.allow(tab);
    expect(registry.isCaptureRequest(tab, "file:///")).toBe(false);
  });
});
