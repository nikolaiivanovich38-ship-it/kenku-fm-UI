/**
 * SEC-14: where the app looks for updates.
 *
 * Upstream Kenku FM polled https://download.kenku.fm, which would replace this
 * fork with upstream's app. Updates now come from the fork's own GitHub
 * releases through the free update.electronjs.org service, whose feed format is
 * https://update.electronjs.org/OWNER/REPO/PLATFORM-ARCH/VERSION.
 */
import { GithubRepo, isGithubRepoConfigured } from "./appIdentity";

export const UPDATE_SERVER = "https://update.electronjs.org";

/**
 * Platforms that receive automatic updates. Only Windows for now: macOS
 * updates through update.electronjs.org need a code-signed build, which this
 * fork does not produce yet.
 */
export const UPDATE_PLATFORMS: readonly string[] = ["win32"];

const ARCHES = ["x64", "ia32", "arm64"];
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export type UpdateFeedInput = {
  repo: Partial<GithubRepo> | undefined;
  platform: string;
  arch: string;
  version: string;
};

/**
 * Build the update feed address, or return null when updates must stay off:
 * repository not configured, platform without update support, unknown
 * architecture or a version that is not SemVer.
 */
export function buildUpdateFeedUrl({ repo, platform, arch, version }: UpdateFeedInput): string | null {
  if (!isGithubRepoConfigured(repo)) return null;
  if (!UPDATE_PLATFORMS.includes(platform)) return null;
  if (!ARCHES.includes(arch)) return null;
  if (!SEMVER_PATTERN.test(version)) return null;
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.repo);
  return `${UPDATE_SERVER}/${owner}/${name}/${platform}-${arch}/${version}`;
}

/** Fetch as Electron's net.fetch does (the main process passes it; tests pass a fake). */
export type FetchFeed = (url: string) => Promise<Response>;

/**
 * w51-fix2: whether the feed has a release to compare with, asked before Squirrel's Update.exe runs.
 * update.electronjs.org skips drafts and answers 404 for RELEASES when every release is a draft (Lyre's Releases page
 * until a release is published); Update.exe then stops with an error, which Lyre showed as a fault. So: false for that
 * 404 (nothing published, this copy is up to date), true for a RELEASES file, null when the feed could not be asked
 * or failed otherwise (the updater runs and reports what went wrong).
 */
export async function hasPublishedRelease(feedUrl: string, fetchFeed: FetchFeed): Promise<boolean | null> {
  try {
    const response = await fetchFeed(`${feedUrl}/RELEASES`);
    if (response.status === 404) return false;
    return response.ok ? true : null;
  } catch {
    return null;
  }
}
