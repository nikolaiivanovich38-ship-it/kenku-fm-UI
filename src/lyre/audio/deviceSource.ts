/**
 * The sound devices the preview can play on: the computer's own. Packages built with CUE_DESK_E2E_BUILD=1 (the
 * __CUE_DESK_TEST_BUILD__ define, webpack.renderer.config.js) add the design prototype's stand-ins
 * (standInDevices.ts), because the e2e machine has none and settings.spec chooses "Headset (Arctis 7)". As with the
 * player's test hooks (src/player/renderer.ts), a release build compiles the branch, and the module, out.
 */
import { browserDeviceSource, type DeviceSource } from "../../player/engine/preview/outputDevices";

declare const __CUE_DESK_TEST_BUILD__: boolean;

export function outputDeviceSource(mediaDevices: MediaDevices): DeviceSource {
  const real = browserDeviceSource(mediaDevices);
  if (typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./standInDevices") as typeof import("./standInDevices")).withStandInDevices(real);
  }
  return real;
}
