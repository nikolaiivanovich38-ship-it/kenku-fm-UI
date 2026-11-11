/**
 * Test builds only (loaded by deviceSource.ts behind __CUE_DESK_TEST_BUILD__, so a release build does not contain
 * it): the design prototype's stand-in sound devices, because the e2e machine has none and settings.spec chooses
 * "Headset (Arctis 7)". Choosing a stand-in saves the choice like any device; playing on it falls back to the default
 * device, and the preview's device status says so (OutputDeviceChooser).
 */
import type { DeviceSource, OutputDeviceInfo } from "../../engine/preview/outputDevices";

/** design/prototype/src/views/settings.js DEVICES, after its "System default" (the screen's own first choice). */
export const STAND_IN_DEVICES: readonly OutputDeviceInfo[] = Object.freeze([
  { deviceId: "test-build-realtek", label: "Speakers (Realtek Audio)" },
  { deviceId: "test-build-arctis-7", label: "Headset (Arctis 7)" },
  { deviceId: "test-build-focusrite", label: "USB audio (Focusrite)" },
]);

/** The real devices, then each stand-in no real device already has the name of. */
export function withStandInDevices(source: DeviceSource): DeviceSource {
  return {
    list: async () => {
      const real = await source.list();
      return [...real, ...STAND_IN_DEVICES.filter((s) => !real.some((d) => d.label === s.label)).map((s) => ({ ...s }))];
    },
    onChange: (listener) => source.onChange(listener),
  };
}
