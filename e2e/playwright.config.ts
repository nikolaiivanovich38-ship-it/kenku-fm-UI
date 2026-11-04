/**
 * FND-4: Playwright configuration for end-to-end tests of the packaged app.
 * Build the app first: `CUE_DESK_E2E_BUILD=1 yarn package` (see docs/DEVELOPING.md > End-to-end tests).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // Each test starts its own copy of the app; run them one at a time so they
  // do not compete for audio devices or the remote-control port.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "../test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
