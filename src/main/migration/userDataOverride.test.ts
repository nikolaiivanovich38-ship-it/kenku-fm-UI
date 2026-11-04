import path from "path";
import { describe, expect, it } from "vitest";
import { USER_DATA_DIR_ENV, skippedCarryOver, userDataOverride } from "./userDataOverride";

describe("userDataOverride (FND-4)", () => {
  it("is off when the variable is not set or empty", () => {
    expect(userDataOverride({})).toBeNull();
    expect(userDataOverride({ [USER_DATA_DIR_ENV]: "" })).toBeNull();
    expect(userDataOverride({ [USER_DATA_DIR_ENV]: "   " })).toBeNull();
  });

  it("uses an absolute folder as given (normalised)", () => {
    const dir = path.resolve("/tmp/cue-desk-e2e/../cue-desk-e2e/run-1");
    expect(userDataOverride({ [USER_DATA_DIR_ENV]: dir })).toBe(path.normalize(dir));
  });

  it("ignores a relative folder, which would depend on where the app was started", () => {
    expect(userDataOverride({ [USER_DATA_DIR_ENV]: "relative/dir" })).toBeNull();
  });
});

describe("skippedCarryOver (FND-4)", () => {
  it("reports that nothing was copied into the test folder", () => {
    expect(skippedCarryOver("/tmp/x")).toEqual({
      status: "no-old-data",
      sourceDir: "",
      destDir: "/tmp/x",
      copiedItems: [],
      skippedItems: [{ item: "*", reason: `${USER_DATA_DIR_ENV} is set` }],
      fileCount: 0,
      errors: [],
    });
  });
});
