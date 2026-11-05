/**
 * Which screens the real app has. A spec file is named after its screen (`live.spec.ts` is "live").
 *
 * In the `app` project, a screen that is NOT listed here is marked "expected to fail": its specs may fail
 * (the screen does not exist yet) and the project stays green; if one of them passes anyway, Playwright
 * reports "expected to fail, but passed", which is the cue to add the screen here.
 * A screen that IS listed is required: any failing spec fails the run.
 *
 * The sweeps (sweeps.spec.ts) belong to the screen they open: Library, Playlists, ... and "look" for the Look and feel page.
 *
 * A test that needs a later screen or part (it ends on Live, or reads the shell's "on-air bar") names it with
 * `expectFailureUntilBuilt("live")` / `("on-air bar")` and is expected to fail until that name is listed here too.
 *
 * Wave 3: when a screen is built, add its name below in the same commit that implements its functions in
 * target.ts.
 */
export const BUILT_SCREENS: readonly string[] = ["library", "playlists", "audio-profile", "pad-boards", "campaigns", "session-planner"];
