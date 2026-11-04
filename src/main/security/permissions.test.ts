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
  tab: ["fullscreen"],
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

  describe("pages the app is capturing (tab capture for Discord)", () => {
    // Chromium raises tab capture as a "media" request on the captured page,
    // with no media types (W1 finding, confirmed in e2e/capture.spec.ts).
    it.each([null, "player-view"] as const)("lets the capture open a %s page", (role) => {
      expect(
        isPermissionAllowed({ role, permission: "media", mediaTypes: [], isCaptureTarget: true }),
      ).toBe(true);
    });

    it("refuses the same request for a page the app is not capturing", () => {
      for (const role of [null, "player-view"] as const) {
        expect(isPermissionAllowed({ role, permission: "media", mediaTypes: [] })).toBe(false);
      }
    });

    it("still refuses a captured page its microphone or camera", () => {
      for (const mediaTypes of [["audio"], ["video"], ["audio", "video"]]) {
        expect(
          isPermissionAllowed({ role: null, permission: "media", mediaTypes, isCaptureTarget: true }),
        ).toBe(false);
      }
    });

    it("refuses an embedded frame of a captured page", () => {
      expect(
        isPermissionAllowed({
          role: null,
          permission: "media",
          mediaTypes: [],
          isCaptureTarget: true,
          isMainFrame: false,
        }),
      ).toBe(false);
    });

    it("refuses a permission check that names no media types", () => {
      expect(
        isPermissionAllowed({ role: null, permission: "media", isCaptureTarget: true }),
      ).toBe(false);
    });

    it("grants nothing else to a captured page", () => {
      expect(
        isPermissionAllowed({ role: null, permission: "notifications", isCaptureTarget: true }),
      ).toBe(false);
    });
  });

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

  it("refuses app pages a media request that names no media types (SEC-16: screen recording)", () => {
    // Probe on Electron 44 (WP2): getUserMedia for an input device, with or
    // without a deviceId constraint, arrives as ["audio"]; screen or desktop
    // capture (chromeMediaSource "desktop", getDisplayMedia) arrives as [].
    for (const role of ["main-window", "audio-capture"] as const) {
      expect(isPermissionAllowed({ role, permission: "media", mediaTypes: [] })).toBe(false);
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
