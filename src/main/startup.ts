/**
 * FND-1: start-up order around the Kenku FM data carry-over.
 *
 * The copy must only run in the one real copy of the app: not while the
 * Windows installer runs the app with `--squirrel-install` and friends, and
 * not in a second copy that is about to hand over to the first. It must also
 * run before any window, session or settings file writes to the data folder.
 * The steps are passed in so the order can be tested without Electron.
 */
import packageJson from "../../package.json";
import { appRunningMessage, CarryOverResult } from "./migration/carryOver";

const APP_NAME: string = packageJson.productName;

export type StartupSteps = {
  /** True when the Windows installer started the app to install, update or uninstall it. */
  handleSquirrelEvent: () => boolean;
  /** True when this is the only running copy of the app. */
  requestSingleInstanceLock: () => boolean;
  runDataCarryOver: () => CarryOverResult;
  quit: () => void;
};

export type StartupOutcome = "run" | "squirrel-event" | "second-instance";

/**
 * Run the installer check, then the single-instance lock, then the carry-over.
 * Returns "run" when the caller should go on to create the main window;
 * otherwise the app has been asked to quit.
 */
export function startApp(steps: StartupSteps): StartupOutcome {
  if (steps.handleSquirrelEvent()) {
    steps.quit();
    return "squirrel-event";
  }
  if (!steps.requestSingleInstanceLock()) {
    steps.quit();
    return "second-instance";
  }
  steps.runDataCarryOver();
  return "run";
}

/** The question shown when the library could not be copied; matches Electron's message box options. */
export type CarryOverPrompt = {
  type: "warning";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
};

const QUIT_BUTTON = "Quit";
const START_EMPTY_BUTTON = "Start with an empty library";

/** Items whose loss means the user's playlists, soundboards or settings are missing. */
const LIBRARY_ITEMS = new Set(["Local Storage", "(setup)"]);

function needsUserDecision(result: CarryOverResult): boolean {
  if (result.status === "legacy-app-running") return true;
  return result.status === "failed" && result.errors.some((error) => LIBRARY_ITEMS.has(error.item));
}

/**
 * FND-1: when the earlier app (Cue Desk or Kenku FM) was still running, or its library could not be copied,
 * ask whether to quit (the default) so the copy runs again on the next start.
 * Starting anyway creates an empty library, and an existing library is never
 * overwritten, so the old one would not come across later. Returns true when
 * the app should go on starting. `ask` shows the prompt and returns the
 * index of the chosen button.
 */
export function confirmStartAfterCarryOver(
  result: CarryOverResult | null,
  ask: (prompt: CarryOverPrompt) => number,
): boolean {
  if (!result || !needsUserDecision(result)) return true;
  const buttons = [QUIT_BUTTON, START_EMPTY_BUTTON];
  const quitIndex = buttons.indexOf(QUIT_BUTTON);
  const isRunning = result.status === "legacy-app-running";
  const source = result.sourceApp ?? "Kenku FM";
  const prompt: CarryOverPrompt = {
    type: "warning",
    title: APP_NAME,
    message: isRunning ? (result.reason ?? appRunningMessage(source)) : `Your ${source} library could not be copied.`,
    detail: [
      isRunning
        ? `Choose Quit, close ${source}, then start ${APP_NAME} again.`
        : `Choose Quit, close ${source} if it is open, then start ${APP_NAME} again to retry.`,
      `If you start with an empty library instead, your ${source} library will not be copied later. ${source} itself is not changed either way.`,
    ].join("\n\n"),
    buttons,
    defaultId: quitIndex,
    cancelId: quitIndex,
    noLink: true,
  };
  return ask(prompt) !== quitIndex;
}
