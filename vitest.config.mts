import { defineConfig } from "vitest/config";

/**
 * Test configuration.
 * - "main": main-process and pure logic tests, run in Node.
 * - "ui": React components and hooks for the player and main window, run in jsdom.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/test/**"],
      reporter: ["text-summary", "html", "lcov"],
    },
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts", "src/*.test.ts", "src/common/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "ui",
          environment: "jsdom",
          include: [
            "src/player/**/*.test.{ts,tsx}",
            "src/renderer/**/*.test.{ts,tsx}",
          ],
          setupFiles: ["src/test/setupUi.ts"],
        },
      },
    ],
  },
});
