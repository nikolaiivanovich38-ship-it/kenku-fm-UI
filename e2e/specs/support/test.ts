/**
 * The `test` every spec file imports. It adds one rule on top of Playwright's: in the `app` project, a spec of a
 * screen that is not in built.ts is expected to fail (see built.ts).
 *
 * A spec file is named after its screen (live.spec.ts is "live") and is marked automatically. sweeps.spec.ts covers
 * every screen, so each of its tests names the screen it belongs to with `expectFailureUntilScreenBuilt`. A check of
 * round 6 or 7 names the streams that build it with `expectFailureUntilBuilt` (support/built.ts). A check of 0.5.1's
 * features, built in the app with no prototype round, calls `appOnly()`.
 *
 * 0.6.0 (Nik, 20 Nov: "We need our prototype to either be what ships or ahead of it"): every stream is built, so no
 * check calls `expectFailureUntilBuilt` or `metByTheAppAlready` any more; both stay for the next release's streams.
 * `appOnly()` is kept only for what a browser page cannot do (real files, audio devices, Discord, the operating system).
 */
import { test as base, expect } from "@playwright/test";
import path from "path";
import { BUILT_SCREENS, BUILT_STREAMS, type Stream } from "./built";
import { withAppPage } from "./target";

export { expect };

/** Mark the running test "expected to fail" in the app project when the screen is not built yet. */
export function expectFailureUntilScreenBuilt(screen: string): void {
  const info = base.info();
  if (info.project.name === "app" && !BUILT_SCREENS.includes(screen)) {
    info.fail(true, `The ${screen} screen is not built in the app yet (wave 3 adds it to support/built.ts)`);
  }
}

/**
 * 0.5.0: mark the running test "expected to fail" in the app project until every stream named has been built
 * (BUILT_STREAMS in support/built.ts). Name each stream that must build something for the check to pass.
 */
export function expectFailureUntilBuilt(...streams: [Stream, ...Stream[]]): void {
  const info = base.info();
  const waiting = streams.filter((s) => !BUILT_STREAMS.includes(s));
  if (info.project.name === "app" && waiting.length > 0) {
    info.fail(true, `Not built in the app yet: the ${waiting.join(" and ")} stream${waiting.length > 1 ? "s" : ""} (support/built.ts)`);
  }
}

/**
 * For a check in a block marked for a later round (its `test.beforeEach` calls expectFailureUntilBuilt) that the app
 * meets already: it is required to pass in the app, so it cannot regress unseen and does not show up as "expected to
 * fail, but passed". Call it first in the test, saying why the app meets it. A screen the app does not have at all
 * still marks the check (the page fixture's mark is kept).
 */
export function metByTheAppAlready(why: string): void {
  const info = base.info();
  if (info.project.name !== "app" || !BUILT_SCREENS.includes(path.basename(info.file).replace(/\.spec\.ts$/, ""))) return;
  for (let i = info.annotations.length - 1; i >= 0; i--) if (info.annotations[i].type === "fail") info.annotations.splice(i, 1);
  info.annotations.push({ type: "met by the app already", description: why });
  info.expectedStatus = "passed";
}

/**
 * A check of something a browser page cannot do: real files on disk, real audio devices, Discord or the operating
 * system. The prototype project skips the check; the app project runs it like any other. Call it first in the test,
 * with a comment saying what the page cannot do. (0.5.1 used it for features built in the app with no prototype round;
 * since 0.6.0 the prototype has those too: AGENT_RULES.md, "The prototype is what ships or ahead of it".)
 */
export function appOnly(): void {
  base.skip(base.info().project.name !== "app", "A browser page cannot do this (real files, audio devices, Discord or the operating system)");
}

export const test = base.extend<{ screenName: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures a function needs from its first argument
  screenName: [async ({}, use, testInfo) => use(path.basename(testInfo.file).replace(/\.spec\.ts$/, "")), { auto: true }],
  page: async ({ page, screenName }, use, testInfo) => {
    if (screenName !== "sweeps") expectFailureUntilScreenBuilt(screenName);
    // The app project works in the Lyre page of the packaged app (support/target.ts); the prototype in a browser page.
    if (testInfo.project.name === "app") await withAppPage(use);
    else await use(page);
  },
});
