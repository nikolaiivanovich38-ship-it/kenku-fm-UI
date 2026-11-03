import { describe, expect, it } from "vitest";
import { AppPageRole, isPermissionAllowed } from "./permissions";

const ALL_PERMISSIONS = [
  "clipboard-read",
  "clipboard-sanitized-write",
  "deprecated-sync-clipboard-read",
  "display-capture",
  "fileSystem",
  "fullscreen",
  "geolocation",
  "hid",
  "idle-detection",
  "keyboardLock",
  "media",
  "mediaKeySystem",
  "midi",
  "midiSysex",
  "notifications",
  "openExternal",
  "pointerLock",
  "serial",
  "speaker-selection",
  "storage-access",
  "top-level-storage-access",
  "unknown",
  "usb",
  "window-management",
  "something-new-in-a-future-electron",
];

/** Expected allow-list per caller; every other permission must be denied. */
const EXPECTED: Record<AppPageRole | "tab", string[]> = {
  "main-window": ["media"],
  "audio-capture": ["media"],
  "player-view": ["clipboard-sanitized-write"],
  tab: ["fullscreen", "mediaKeySystem"],
};

describe("isPermissionAllowed (SEC-3)", () => {
  for (const [caller, allowed] of Object.entries(EXPECTED)) {
    const role = caller === "tab" ? null : (caller as AppPageRole);
    describe(caller, () => {
      it.each(ALL_PERMISSIONS)("%s", (permission) => {
        const mediaTypes = permission === "media" ? ["audio"] : undefined;
        expect(isPermissionAllowed({ role, permission, mediaTypes })).toBe(
          allowed.includes(permission),
        );
      });
    });
  }

  it("never lets a tab use the microphone or camera", () => {
    for (const mediaTypes of [["audio"], ["video"], ["audio", "video"], []]) {
      expect(
        isPermissionAllowed({ role: null, permission: "media", mediaTypes }),
      ).toBe(false);
    }
  });

  it("lets app pages capture audio but not video", () => {
    for (const role of ["main-window", "audio-capture"] as const) {
      expect(
        isPermissionAllowed({ role, permission: "media", mediaTypes: ["audio"] }),
      ).toBe(true);
      expect(
        isPermissionAllowed({ role, permission: "media", mediaTypes: ["video"] }),
      ).toBe(false);
      expect(
        isPermissionAllowed({
          role,
          permission: "media",
          mediaTypes: ["audio", "video"],
        }),
      ).toBe(false);
    }
  });

  it("allows audio permission checks that do not name a media type", () => {
    // Device enumeration runs a check with mediaType "unknown" or none.
    expect(
      isPermissionAllowed({
        role: "main-window",
        permission: "media",
        mediaTypes: ["unknown"],
      }),
    ).toBe(true);
    expect(
      isPermissionAllowed({ role: "audio-capture", permission: "media" }),
    ).toBe(true);
  });

  it("denies app-page permissions to embedded frames", () => {
    expect(
      isPermissionAllowed({
        role: "audio-capture",
        permission: "media",
        mediaTypes: ["audio"],
        isMainFrame: false,
      }),
    ).toBe(false);
    expect(
      isPermissionAllowed({
        role: "player-view",
        permission: "clipboard-sanitized-write",
        isMainFrame: false,
      }),
    ).toBe(false);
  });

  it("denies the player view any media access", () => {
    expect(
      isPermissionAllowed({
        role: "player-view",
        permission: "media",
        mediaTypes: ["audio"],
      }),
    ).toBe(false);
  });
});
