import { describe, expect, it, vi } from "vitest";
import type { CarryOverResult } from "./migration/carryOver";
import {
  confirmStartAfterCarryOver,
  startApp,
  type CarryOverPrompt,
  type StartupSteps,
} from "./startup";

function carryOver(status: CarryOverResult["status"], errorItems: string[] = []): CarryOverResult {
  return {
    status,
    sourceDir: "/appData/Kenku FM",
    sourceApp: "Kenku FM",
    destDir: "/appData/lyre",
    copiedItems: [],
    skippedItems: [],
    fileCount: 0,
    errors: errorItems.map((item) => ({ item, message: "EBUSY" })),
  };
}

/** Records the order in which start-up steps run. */
function fakeSteps({ squirrelEvent = false, gotLock = true } = {}) {
  const calls: string[] = [];
  const steps: StartupSteps = {
    handleSquirrelEvent: vi.fn(() => {
      calls.push("squirrel");
      return squirrelEvent;
    }),
    requestSingleInstanceLock: vi.fn(() => {
      calls.push("lock");
      return gotLock;
    }),
    runDataCarryOver: vi.fn(() => {
      calls.push("carry-over");
      return carryOver("copied");
    }),
    quit: vi.fn(() => {
      calls.push("quit");
    }),
  };
  return { steps, calls };
}

describe("startApp (FND-1 start-up order)", () => {
  it("copies the Kenku FM library only after the installer check and the single-instance lock", () => {
    const { steps, calls } = fakeSteps();
    expect(startApp(steps)).toBe("run");
    expect(calls).toEqual(["squirrel", "lock", "carry-over"]);
  });

  it("does not copy anything while the Windows installer runs the app (--squirrel-install)", () => {
    const { steps, calls } = fakeSteps({ squirrelEvent: true });
    expect(startApp(steps)).toBe("squirrel-event");
    expect(calls).toEqual(["squirrel", "quit"]);
  });

  it("does not copy anything in a second copy of the app; it just quits", () => {
    const { steps, calls } = fakeSteps({ gotLock: false });
    expect(startApp(steps)).toBe("second-instance");
    expect(calls).toEqual(["squirrel", "lock", "quit"]);
  });
});

describe("confirmStartAfterCarryOver (FND-1 retry on the next start)", () => {
  const quitChoice = (options: CarryOverPrompt) => options.buttons.indexOf("Quit");
  const startChoice = (options: CarryOverPrompt) => options.buttons.indexOf("Start with an empty library");

  it("starts without asking when nothing went wrong", () => {
    const ask = vi.fn();
    for (const status of ["copied", "no-old-data", "already-done", "destination-has-data"] as const) {
      expect(confirmStartAfterCarryOver(carryOver(status), ask)).toBe(true);
    }
    expect(confirmStartAfterCarryOver(null, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not ask when only the window position or session data failed to copy", () => {
    const ask = vi.fn();
    expect(confirmStartAfterCarryOver(carryOver("failed", ["config.json", "Session Storage"]), ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the user to close Kenku FM, and quits by default so the copy can run next start", () => {
    const ask = vi.fn(quitChoice);
    expect(confirmStartAfterCarryOver(carryOver("legacy-app-running"), ask)).toBe(false);
    const [options] = ask.mock.calls[0];
    expect(options.message).toBe(
      "Kenku FM is still running. Close it and restart Lyre to bring your library across.",
    );
    expect(options.buttons[options.defaultId]).toBe("Quit");
    expect(options.cancelId).toBe(options.defaultId);
    expect(options.detail).toContain("will not be copied later");
  });

  it("offers to quit and try again when the library itself was not copied", () => {
    const ask = vi.fn(quitChoice);
    expect(confirmStartAfterCarryOver(carryOver("failed", ["Local Storage"]), ask)).toBe(false);
    expect(ask.mock.calls[0][0].message).toBe("Your Kenku FM library could not be copied.");
    expect(ask.mock.calls[0][0].detail).toContain("start Lyre again");
  });

  it("names Cue Desk when its library is the one being copied", () => {
    const ask = vi.fn(quitChoice);
    const cueDeskRunning = {
      ...carryOver("legacy-app-running"),
      sourceApp: "Cue Desk",
      reason: "Cue Desk is still running. Close it and restart Lyre to bring your library across.",
    };
    confirmStartAfterCarryOver(cueDeskRunning, ask);
    const [options] = ask.mock.calls[0];
    expect(options.title).toBe("Lyre");
    expect(options.message).toBe(cueDeskRunning.reason);
    expect(options.detail).toContain("Choose Quit, close Cue Desk, then start Lyre again.");
    expect(options.detail).toContain("your Cue Desk library will not be copied later");
  });

  it("also asks when the data folder could not be prepared", () => {
    expect(confirmStartAfterCarryOver(carryOver("failed", ["(setup)"]), quitChoice)).toBe(false);
  });

  it("starts anyway when the user chooses an empty library", () => {
    expect(confirmStartAfterCarryOver(carryOver("legacy-app-running"), startChoice)).toBe(true);
    expect(confirmStartAfterCarryOver(carryOver("failed", ["Local Storage"]), startChoice)).toBe(true);
  });
});
