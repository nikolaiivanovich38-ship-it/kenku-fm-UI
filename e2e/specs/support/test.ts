/**
 * The `test` every spec file imports. It adds one rule on top of Playwright's: in the `app` project, a spec of a
 * screen that is not in built.ts is expected to fail (see built.ts).
 *
 * A spec file is named after its screen (live.spec.ts is "live") and is marked automatically. sweeps.spec.ts covers
 * every screen, so each of its tests names the screen it belongs to with `expectFailureUntilBuilt`.
 */
import { test as base, expect } from "@playwright/test";
import path from "path";
import { BUILT_SCREENS } from "./built";
import { withAppPage } from "./target";

export { expect };

/** Mark the running test "expected to fail" in the app project when the screen is not built yet. */
export function expectFailureUntilBuilt(screen: string): void {
  const info = base.info();
  if (info.project.name === "app" && !BUILT_SCREENS.includes(screen)) {
    info.fail(true, `The ${screen} screen is not built in the app yet (wave 3 adds it to support/built.ts)`);
  }
}

export const test = base.extend<{ screenName: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures a function needs from its first argument
  screenName: [async ({}, use, testInfo) => use(path.basename(testInfo.file).replace(/\.spec\.ts$/, "")), { auto: true }],
  page: async ({ page, screenName }, use, testInfo) => {
    if (screenName !== "sweeps") expectFailureUntilBuilt(screenName);
    // The app project works in the Lyre page of the packaged app (support/target.ts); the prototype in a browser page.
    if (testInfo.project.name === "app") await withAppPage(use);
    else await use(page);
  },
});
