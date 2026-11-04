import path from "path";
import { describe, expect, it } from "vitest";
import { bundledAssetPath } from "./bundledAsset";

describe("bundledAssetPath", () => {
  it("finds an image webpack emitted next to the main bundle", () => {
    // webpack's asset/resource gives the main process a bare file name, which
    // Electron would otherwise look up in the working directory.
    const bundleDir = path.join("/app", "resources", "app.asar", ".webpack", "main");
    expect(bundledAssetPath("5ab15a97efe27addf4c6.png", bundleDir)).toBe(
      path.join(bundleDir, "5ab15a97efe27addf4c6.png"),
    );
  });

  it("leaves an absolute path alone", () => {
    const absolute = path.resolve("/tmp/icon.png");
    expect(bundledAssetPath(absolute, "/elsewhere")).toBe(absolute);
  });
});
