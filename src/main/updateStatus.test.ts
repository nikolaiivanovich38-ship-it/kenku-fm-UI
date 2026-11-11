import { describe, expect, it, vi } from "vitest";

import { UpdateStatus, isNoPublishedUpdate, plainUpdateError } from "./updateStatus";

/** How Electron reports Squirrel's Update.exe exiting with an error: the exit code, then what it wrote. */
const SQUIRREL_FAILED = "Command failed: 4294967295\nSystem.AggregateException: One or more errors occurred. ---> ";

describe("update errors in plain words (SEC-14)", () => {
  it.each([
    [new Error("net::ERR_INTERNET_DISCONNECTED"), /seems to be offline/],
    [new Error("getaddrinfo ENOTFOUND update.electronjs.org"), /seems to be offline/],
    [new Error("net::ERR_NAME_NOT_RESOLVED"), /seems to be offline/],
    [new Error("net::ERR_CONNECTION_TIMED_OUT"), /did not answer/],
    [new Error("HTTP Status 503: Service Unavailable"), /did not answer/],
    [new Error("Update.exe not found"), /installer/],
    [new Error("spawn C:\\Users\\nik\\AppData\\Local\\lyre\\Update.exe ENOENT"), /updater is missing/],
    [new Error("spawn C:\\Users\\nik\\AppData\\Local\\lyre\\Update.exe EACCES"), /Windows could not run Lyre's updater/],
    [new Error("spawn UNKNOWN"), /Windows could not run Lyre's updater/],
    // Squirrel's Update.exe ran and failed: its own .NET errors arrive after "Command failed: <exit code>".
    [new Error(`${SQUIRREL_FAILED}System.Net.WebException: The remote name could not be resolved: 'update.electronjs.org'`), /seems to be offline/],
    [new Error(`${SQUIRREL_FAILED}System.Net.WebException: Unable to connect to the remote server`), /did not answer/],
    [new Error(`${SQUIRREL_FAILED}System.Net.WebException: The operation has timed out`), /did not answer/],
    [new Error(`${SQUIRREL_FAILED}System.Net.WebException: The remote server returned an error: (502) Bad Gateway.`), /did not answer/],
  ])("explains %s", (error, expected) => {
    expect(plainUpdateError(error)).toMatch(expected);
  });

  it("never says Windows could not run the updater when the updater ran and stopped with an error", () => {
    const words = plainUpdateError(new Error("Command failed: 4294967295\nSystem.InvalidOperationException: something inside Squirrel"));
    expect(words).not.toMatch(/Windows could not run|Restart the computer/);
    expect(words).toBe("Lyre could not check for updates: Lyre's updater stopped with an error (code 4294967295).");
  });

  it("says what it does not recognise in a short, single line without the user's folders", () => {
    const words = plainUpdateError(new Error(`Something odd at C:\\Users\\nik\\x\n${"stack ".repeat(100)}`));
    expect(words).toMatch(/^Lyre could not check for updates \(Something odd at …\\x\)\.$/);
    expect(words).not.toContain("nik");
    expect(words).not.toContain("\n");
    expect(plainUpdateError("just text")).toBe("Lyre could not check for updates (just text).");
  });
});

describe("no update published yet (w51-fix2)", () => {
  it("knows the feed's 404, which is what a Releases page with only drafts gives, from a fault", () => {
    expect(isNoPublishedUpdate(new Error(`${SQUIRREL_FAILED}System.Net.WebException: The remote server returned an error: (404) Not Found.`))).toBe(true);
    expect(isNoPublishedUpdate(new Error("HTTP Status 404"))).toBe(true);
    expect(isNoPublishedUpdate(new Error(`${SQUIRREL_FAILED}System.Net.WebException: The remote server returned an error: (502) Bad Gateway.`))).toBe(false);
    expect(isNoPublishedUpdate(new Error("spawn UNKNOWN"))).toBe(false);
  });
});

describe("UpdateStatus (SEC-14)", () => {
  it("starts off, saying why", () => {
    expect(new UpdateStatus().state()).toEqual({ kind: "off", message: "Automatic updates are off in this build." });
  });

  it("records each step and tells its listeners", () => {
    const status = new UpdateStatus(() => 1000);
    const heard = vi.fn();
    status.onChange(heard);
    status.checking();
    expect(status.state()).toEqual({ kind: "checking" });
    status.upToDate();
    expect(status.state()).toEqual({ kind: "up-to-date", checkedAt: 1000 });
    status.downloaded();
    expect(status.state()).toEqual({ kind: "ready", message: "A new version of Lyre is ready. Restart Lyre to use it." });
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("asks to tell the game master about the first failure only, until a check works again", () => {
    const status = new UpdateStatus(() => 5);
    expect(status.failed(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(true);
    expect(status.state()).toEqual({
      kind: "error",
      message:
        "Lyre could not check for updates: this computer seems to be offline. It tries again every 15 minutes; this version keeps working.",
      failedAt: 5,
    });
    expect(status.failed(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
    status.upToDate();
    expect(status.failed(new Error("HTTP Status 500"))).toBe(true);
  });

  it("stops telling a listener that has gone", () => {
    const status = new UpdateStatus();
    const heard = vi.fn();
    const stop = status.onChange(heard);
    stop();
    status.checking();
    expect(heard).not.toHaveBeenCalled();
  });
});
