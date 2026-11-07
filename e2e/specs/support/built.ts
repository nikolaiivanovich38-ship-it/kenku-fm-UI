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
 * `expectFailureUntilScreenBuilt("live")` / `("on-air bar")` and is expected to fail until that name is listed here too.
 *
 * Wave 3: when a screen is built, add its name below in the same commit that implements its functions in
 * target.ts.
 */
export const BUILT_SCREENS: readonly string[] = ["library", "playlists", "audio-profile", "pad-boards", "campaigns", "session-planner", "on-air bar", "look", "outputs", "library-files", "live", "help"];

/**
 * 0.5.0 (round 6 and round 7): the build streams. A check of round 6 or 7 names the streams that must build it with
 * `expectFailureUntilBuilt("shell", "prep")` and is expected to fail in the app until every one of them is listed
 * here (e2e/specs/BUILD-LIST.md lists the checks by stream). A stream adds its name once all its checks pass; a check
 * that passes before then shows as "expected to fail, but passed": it needs fewer streams than it names.
 *
 *   shell           the top bar, Back and its history, the trail, the Saved pop-up, the Rooms name, Help, Find and
 *                   play (Ctrl+K), Display, and the kit (UX-6)
 *   live            round 6 part 3's Live and round 7 part 2
 *   rooms-settings  Rooms (Add bot, Kick), Settings, remote control, headphones and speakers, keyboard shortcuts
 *   prep            Library, Tags, Playlists, folders, Pad boards, Campaigns, the planner, Audio profile, steps
 *
 * They are a list of their own because "live" is a screen as well as a stream.
 */
export type Stream = "shell" | "live" | "rooms-settings" | "prep";
export const BUILT_STREAMS: readonly Stream[] = [];
