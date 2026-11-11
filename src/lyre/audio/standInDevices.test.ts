/**
 * Test builds only (settings.spec, Headphones and speakers): the e2e machine has no sound devices of its own, so a
 * test build adds the prototype's stand-ins to the list. A normal build lists the computer's own devices only.
 */
import { describe, expect, it } from "vitest";

import { browserDeviceSource } from "../../engine/preview/outputDevices";
import { outputDeviceSource } from "./deviceSource";
import { STAND_IN_DEVICES, withStandInDevices } from "./standInDevices";

function fakeMediaDevices(devices: { kind: string; deviceId: string; label: string }[]) {
  return {
    enumerateDevices: async () => devices,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  } as unknown as MediaDevices;
}

const REAL = [
  { kind: "audiooutput", deviceId: "default", label: "Default" },
  { kind: "audiooutput", deviceId: "abc123", label: "Speakers (USB DAC)" },
  { kind: "audioinput", deviceId: "mic1", label: "Microphone" },
];

describe("stand-in sound devices for test builds", () => {
  it("a normal build (no test-build define, as here) lists only the computer's own output devices", async () => {
    expect(await outputDeviceSource(fakeMediaDevices(REAL)).list()).toEqual([
      { deviceId: "default", label: "Default" },
      { deviceId: "abc123", label: "Speakers (USB DAC)" },
    ]);
  });

  it("a test build adds the prototype's devices after the real ones (System default is the screen's own first choice)", async () => {
    expect(STAND_IN_DEVICES.map((d) => d.label)).toEqual(["Speakers (Realtek Audio)", "Headset (Arctis 7)", "USB audio (Focusrite)"]);
    expect(await withStandInDevices(browserDeviceSource(fakeMediaDevices(REAL))).list()).toEqual([
      { deviceId: "default", label: "Default" },
      { deviceId: "abc123", label: "Speakers (USB DAC)" },
      ...STAND_IN_DEVICES,
    ]);
  });

  it("does not list a stand-in twice when a real device has its name", async () => {
    const source = withStandInDevices({ list: async () => [{ deviceId: "real-arctis", label: "Headset (Arctis 7)" }], onChange: () => () => undefined });
    expect((await source.list()).map((d) => d.label)).toEqual(["Headset (Arctis 7)", "Speakers (Realtek Audio)", "USB audio (Focusrite)"]);
  });
});
