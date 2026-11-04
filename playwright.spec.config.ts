/**
 * FND-15: configuration for the acceptance specs in e2e/specs.
 *
 * The specs describe what Nik approved in the design prototype, in his words, and select everything by role,
 * accessible name and visible text. Two projects run the same files:
 *
 *   prototype  the clickable prototype (design/prototype/lyre-prototype.html). All specs must pass.
 *   app        the real app. A screen listed in e2e/specs/support/built.ts is required to pass; every other
 *              screen is "expected to fail" (it is not built yet), so this project stays green until wave 3
 *              builds the screen and adds it to the list.
 *
 * Run (see docs/testing.md > Specs):
 *   npx playwright test -c playwright.spec.config.ts --project=prototype
 *
 * The existing end-to-end suite (`yarn e2e`, e2e/playwright.config.ts) ignores e2e/specs.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/specs",
  testMatch: "**/*.spec.ts",
  // Every test opens its own page, so the specs can run side by side.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-specs" }]] : "list",
  outputDir: "test-results/specs",
  use: {
    viewport: { width: 960, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Only for machines whose browser download differs from the one Playwright expects.
    launchOptions: process.env.LYRE_SPEC_CHROMIUM ? { executablePath: process.env.LYRE_SPEC_CHROMIUM } : {},
  },
  projects: [{ name: "prototype" }, { name: "app" }],
});
