import { describe, expect, it } from "vitest";
import { buildUpdateFeedUrl } from "./updateFeed";
import { GITHUB_REPO, isGithubRepoConfigured, readmeUrl } from "./appIdentity";

const repo = { owner: "nikolaiivanovich38-ship-it", repo: "kenku-fm-UI" };

describe("buildUpdateFeedUrl (SEC-14)", () => {
  it("builds the update.electronjs.org feed address for Windows", () => {
    expect(buildUpdateFeedUrl({ repo, platform: "win32", arch: "x64", version: "0.1.0" })).toBe(
      "https://update.electronjs.org/nikolaiivanovich38-ship-it/kenku-fm-UI/win32-x64/0.1.0",
    );
  });

  it("supports arm64 Windows and pre-release versions", () => {
    expect(buildUpdateFeedUrl({ repo, platform: "win32", arch: "arm64", version: "0.2.0-beta.1" })).toBe(
      "https://update.electronjs.org/nikolaiivanovich38-ship-it/kenku-fm-UI/win32-arm64/0.2.0-beta.1",
    );
  });

  it.each([
    ["no repository", undefined],
    ["placeholder owner", { owner: "TODO-your-github-account", repo: "cue-desk" }],
    ["placeholder repo", { owner: "someone", repo: "CHANGEME" }],
    ["empty owner", { owner: "", repo: "cue-desk" }],
    ["owner with a slash", { owner: "evil/../x", repo: "cue-desk" }],
    ["repo with a slash", { owner: "someone", repo: "a/b" }],
    ["repo of dots", { owner: "someone", repo: ".." }],
  ])("is off when the repository is not configured: %s", (_label, badRepo) => {
    expect(buildUpdateFeedUrl({ repo: badRepo, platform: "win32", arch: "x64", version: "0.1.0" })).toBeNull();
  });

  it.each(["darwin", "linux", "freebsd"])("is off on %s", (platform) => {
    expect(buildUpdateFeedUrl({ repo, platform, arch: "x64", version: "0.1.0" })).toBeNull();
  });

  it("is off for an unknown architecture or a non-SemVer version", () => {
    expect(buildUpdateFeedUrl({ repo, platform: "win32", arch: "mips", version: "0.1.0" })).toBeNull();
    expect(buildUpdateFeedUrl({ repo, platform: "win32", arch: "x64", version: "1.0" })).toBeNull();
    expect(buildUpdateFeedUrl({ repo, platform: "win32", arch: "x64", version: "0.1.0/../x" })).toBeNull();
  });
});

describe("app identity (FND-1)", () => {
  it("names the product owner's fork", () => {
    expect(isGithubRepoConfigured(GITHUB_REPO)).toBe(true);
    expect(readmeUrl()).toBe("https://github.com/nikolaiivanovich38-ship-it/kenku-fm-UI#readme");
  });

  it("has no README link while the repository is a placeholder", () => {
    expect(readmeUrl({ owner: "TODO", repo: "x" })).toBeNull();
  });
});
