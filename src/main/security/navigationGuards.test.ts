import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import {
  guardTabNavigation,
  isSameDocumentNavigation,
  lockAppPage,
} from "./navigationGuards";
import { TrustedContentsRegistry } from "./trustedContents";

type WindowOpenHandler = (details: { url: string }) => { action: "deny" | "allow" };

function fakeContents(id: number, url: string) {
  const emitter = new EventEmitter();
  let windowOpenHandler: WindowOpenHandler | undefined;
  return Object.assign(emitter, {
    id,
    getURL: () => url,
    setWindowOpenHandler: (handler: WindowOpenHandler) => {
      windowOpenHandler = handler;
    },
    openWindow: (url: string) => windowOpenHandler?.({ url }),
  });
}

function navEvent(url: string, isMainFrame = true) {
  return { url, isMainFrame, isSameDocument: false, preventDefault: vi.fn() };
}

describe("isSameDocumentNavigation (SEC-7)", () => {
  const page = "file:///app/.webpack/renderer/main_window/index.html";
  it.each([
    [page, page + "#settings", true],
    [page + "#a", page + "#b", true],
    [page, page, true],
    [page, "file:///etc/passwd", false],
    [page, "https://evil.example/", false],
    [page, page + "?x=1", false],
    ["http://localhost:3000/main_window", "http://localhost:3000/other", false],
    ["not a url", page, false],
    [page, "not a url", false],
  ])("%s -> %s = %s", (current, target, expected) => {
    expect(isSameDocumentNavigation(current, target)).toBe(expected);
  });
});

describe("lockAppPage (SEC-7)", () => {
  const page = "http://localhost:3000/player_window/index.html";

  it("registers the page as trusted with its role", () => {
    const registry = new TrustedContentsRegistry();
    const contents = fakeContents(5, page);
    lockAppPage(contents, "player-view", { registry });
    expect(registry.roleOf(contents)).toBe("player-view");
  });

  it("cancels navigation away from the page", () => {
    const contents = fakeContents(5, page);
    lockAppPage(contents, "audio-capture", { registry: new TrustedContentsRegistry() });
    for (const url of ["https://evil.example/", "file:///etc/passwd", "about:blank"]) {
      const event = navEvent(url);
      contents.emit("will-navigate", event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it("allows a hash change on the same page", () => {
    const contents = fakeContents(5, page);
    lockAppPage(contents, "main-window", { registry: new TrustedContentsRegistry() });
    const event = navEvent(page + "#x");
    contents.emit("will-navigate", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("denies new windows by default", () => {
    const contents = fakeContents(5, page);
    lockAppPage(contents, "audio-capture", { registry: new TrustedContentsRegistry() });
    expect(contents.openWindow("https://example.com/")).toEqual({ action: "deny" });
  });

  it("uses a custom new-window handler when given one, but always denies", () => {
    const contents = fakeContents(5, page);
    const onWindowOpen = vi.fn();
    lockAppPage(contents, "player-view", {
      registry: new TrustedContentsRegistry(),
      onWindowOpen,
    });
    expect(contents.openWindow("https://kenku.fm/")).toEqual({ action: "deny" });
    expect(onWindowOpen).toHaveBeenCalledWith("https://kenku.fm/");
  });
});

describe("guardTabNavigation (SEC-6)", () => {
  it.each(["will-navigate", "will-redirect"])(
    "%s: cancels main-frame navigation to a refused address",
    (eventName) => {
      const contents = fakeContents(9, "https://example.com/");
      guardTabNavigation(contents);
      for (const url of [
        "file:///etc/passwd",
        "chrome://gpu",
        "javascript:alert(1)",
        "steam://run/1",
        "https://user:pw@example.com/",
      ]) {
        const event = navEvent(url);
        contents.emit(eventName, event);
        expect(event.preventDefault).toHaveBeenCalled();
      }
    },
  );

  it.each(["will-navigate", "will-redirect"])(
    "%s: lets ordinary web navigation through",
    (eventName) => {
      const contents = fakeContents(9, "https://example.com/");
      guardTabNavigation(contents);
      for (const url of ["https://www.youtube.com/", "http://example.com/"]) {
        const event = navEvent(url);
        contents.emit(eventName, event);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
    },
  );

  it("leaves sub-frame redirects to Chromium's own rules", () => {
    const contents = fakeContents(9, "https://example.com/");
    guardTabNavigation(contents);
    const event = navEvent("data:text/html,x", false);
    contents.emit("will-redirect", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
