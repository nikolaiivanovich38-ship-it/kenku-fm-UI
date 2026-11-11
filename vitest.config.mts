import { defineConfig, type Plugin } from "vitest/config";

/**
 * Webpack's `?asset` imports (a file the bundle copies and imports as its address, e.g. the audio worklet) become
 * the file's name in tests, so any component that reaches the audio host can be rendered without a mock.
 */
const webpackAssets: Plugin = {
  name: "webpack-asset-imports",
  enforce: "pre",
  resolveId: (id) => (id.endsWith("?asset") ? `\0asset:${id.slice(0, -"?asset".length)}` : null),
  load: (id) => (id.startsWith("\0asset:") ? `export default ${JSON.stringify(id.split("/").pop())};` : null),
};

/**
 * Test configuration.
 * - "main": main-process and pure logic tests, run in Node.
 * - "ui": the Lyre page's React components and hooks (src/lyre) and the engine it hosts, run in jsdom.
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
          include: ["src/main/**/*.test.ts", "src/*.test.ts", "src/common/**/*.test.ts", "src/preload/**/*.test.ts"],
        },
      },
      {
        plugins: [webpackAssets],
        test: {
          name: "ui",
          environment: "jsdom",
          include: [
            "src/engine/**/*.test.{ts,tsx}",
            "src/lyre/**/*.test.{ts,tsx}",
          ],
          setupFiles: ["src/test/setupUi.ts"],
          // A whole screen's axe check can pass 5 s on a busy shared runner (GitHub, with coverage on).
          testTimeout: 15_000,
        },
      },
    ],
  },
});
