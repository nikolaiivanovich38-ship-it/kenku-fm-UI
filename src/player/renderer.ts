import "./index";

/** True only in packages built with CUE_DESK_E2E_BUILD=1 (webpack.renderer.config.js). */
declare const __CUE_DESK_TEST_BUILD__: boolean;

// WP4: test builds expose the new playback engine to the end-to-end tests
// (e2e/engine.spec.ts). Release builds compile this branch, and the module, out.
if (typeof __CUE_DESK_TEST_BUILD__ !== "undefined" && __CUE_DESK_TEST_BUILD__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./engine/testHook").installEngineTestHook(window);
}
