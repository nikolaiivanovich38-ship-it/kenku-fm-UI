/**
 * FND-1: the app's identity, read from `appIdentity.json`.
 *
 * `forge.config.js` reads the same JSON file, so the data folder, app ID and
 * GitHub repository are each written down once. The display name is
 * `productName` in package.json; the data folder is deliberately separate so
 * renaming the app never moves anyone's library.
 */
import identity from "./appIdentity.json";

export type GithubRepo = { owner: string; repo: string };

/** Folder name under the OS app-data directory that holds our user data. */
export const DATA_FOLDER_NAME: string = identity.dataFolderName;

/**
 * An earlier app whose library the first start may copy. `kind` says which
 * files it keeps: "kenku-fm" (upstream) or "cue-desk" (Lyre's 0.1 drafts).
 */
export type EarlierAppIdentity = { name: string; dataFolderName: string; kind: "cue-desk" | "kenku-fm" };

/**
 * Earlier apps, newest first: Cue Desk (`<appData>/cue-desk`), then upstream
 * Kenku FM (`<appData>/Kenku FM`; Electron names that folder after its productName).
 */
export const EARLIER_APPS = identity.earlierApps as EarlierAppIdentity[];

/** The fork's GitHub repository, used for releases, updates and help links. */
export const GITHUB_REPO: GithubRepo = identity.github;

// GitHub owner names: letters, digits and single hyphens, not at either end.
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const PLACEHOLDER_PATTERN = /^(?:TODO|CHANGE[-_]?ME|YOUR[-_]|OWNER$|REPO$)/i;

/**
 * True when `repo` names a real-looking GitHub repository. Placeholder or
 * malformed values return false, which turns auto-update and release links off
 * instead of sending people to a wrong address.
 */
export function isGithubRepoConfigured(repo: Partial<GithubRepo> | undefined): repo is GithubRepo {
  if (!repo || typeof repo.owner !== "string" || typeof repo.repo !== "string") {
    return false;
  }
  if (PLACEHOLDER_PATTERN.test(repo.owner) || PLACEHOLDER_PATTERN.test(repo.repo)) {
    return false;
  }
  if (repo.repo === "." || repo.repo === "..") {
    return false;
  }
  return OWNER_PATTERN.test(repo.owner) && REPO_PATTERN.test(repo.repo);
}

/** Web address of the repository home page, or null when not configured. */
export function repoHomepageUrl(repo: Partial<GithubRepo> | undefined = GITHUB_REPO): string | null {
  return isGithubRepoConfigured(repo) ? `https://github.com/${repo.owner}/${repo.repo}` : null;
}

/** Address the Help > Learn More menu opens: the fork's README. */
export function readmeUrl(repo: Partial<GithubRepo> | undefined = GITHUB_REPO): string | null {
  const home = repoHomepageUrl(repo);
  return home ? `${home}#readme` : null;
}
