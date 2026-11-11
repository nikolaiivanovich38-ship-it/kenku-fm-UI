/**
 * UX-18 (round 6 part 7, Nik, 6 Nov 22:04): Back is one history of places across the whole app. Every move counts:
 * the menu, a link, a button or a typed address, between screens and within one (another track in the Library). Each
 * press of Back goes one step back to where Nik was, as he left it: the screen and what was selected in it (the page
 * address), the scroll positions, the control last used there and the scene open in the planner.
 *
 * This file holds the list itself (no DOM): the shell (TopBar.tsx) records a place when the address changes and
 * restores it on Back. The prototype's L.route, L.back and L.backButton (design/prototype/src/core.js).
 */

/** How many places are kept (Nik asked for at least five). The oldest goes first. */
export const HISTORY_MAX = 50;

/** One place Nik left, as he left it. */
export interface Place {
  /** The route, as in the address without "#/": "session/crown/s14". */
  path: string;
  /** What Back calls it: "Back to <label>" ("Session 14", "Library: Ashes"). */
  label: string;
  /** Scroll positions of the work area's scrolling boxes, by their key (see shell/restore.ts). */
  scrolls: Record<string, number>;
  /** The control last used in the work area (see shell/restore.ts), so it gets the focus again. */
  focus: string;
  /**
   * What to open there again, when Nik left from inside it (a scene in the planner): the `data-back-open` of the
   * part of the screen the link was in; the screen takes it with `takeBackOpen`.
   */
  open?: string;
}

/** Whether a place still exists: a board, playlist, campaign, session or track may have been deleted since. */
export type PlaceExists = (path: string) => boolean;

export class PlaceHistory {
  private steps: Place[] = [];

  constructor(private readonly max = HISTORY_MAX) {}

  /** Nik left `left` for another place: it goes on top. Leaving a place for itself records nothing. */
  leave(left: Place, to: string): void {
    if (left.path === to) return;
    this.steps.push(left);
    if (this.steps.length > this.max) this.steps.splice(0, this.steps.length - this.max);
  }

  /**
   * Where Back goes from `here` now, without going: the newest place that still exists and is not this one (the ones
   * that are gone, or are where Nik already is, are dropped). Null at the very start of the history.
   */
  peek(here: string, exists: PlaceExists = () => true): Place | null {
    this.prune(here, exists);
    return this.steps[this.steps.length - 1] ?? null;
  }

  /** Go back: takes the place Back goes to off the list (null when there is none). */
  back(here: string, exists: PlaceExists = () => true): Place | null {
    this.prune(here, exists);
    return this.steps.pop() ?? null;
  }

  /** How many places are kept now (tests). */
  get size(): number {
    return this.steps.length;
  }

  private prune(here: string, exists: PlaceExists): void {
    while (this.steps.length > 0) {
      const top = this.steps[this.steps.length - 1];
      if (top.path !== here && exists(top.path)) return;
      this.steps.pop();
    }
  }
}

/** Names of the screens with no name of their own, for Back ("Back to Pad boards"). The prototype's ROUTE_WORDS. */
const SCREEN_WORDS: Record<string, string> = {
  campaigns: "Campaigns",
  library: "Library",
  playlists: "Playlists",
  boards: "Pad boards",
  profile: "Audio profile",
  live: "Live",
  outputs: "Rooms",
  look: "Look and feel",
  tags: "Tags",
  backup: "Back up, move or share",
  moved: "What came across",
  relink: "Find missing files",
  settings: "Settings",
};

/**
 * The names of things in the library, for a place's label and its trail. Each answers null for one that does not
 * exist (deleted, or not loaded yet: then `loaded` is false and nothing counts as gone).
 */
export interface PlaceNames {
  loaded: boolean;
  campaign(id: string): string | null;
  /** The session's number, or null. */
  session(campaignId: string, sessionId: string): number | null;
  playlist(id: string): string | null;
  board(id: string): string | null;
  track(id: string): string | null;
}

/** The parts of a path: "session/crown/s14" → ["session", "crown", "s14"]. */
function partsOf(path: string): string[] {
  return path.replace(/^#?\/?/, "").split("/");
}

/** What Back calls a place: the campaign's name, "Session 14", a playlist's or board's name, "Library: <track>". */
export function placeLabel(path: string, names?: PlaceNames): string {
  const [screen, a, b] = partsOf(path);
  if (screen === "campaign") return names?.campaign(a) ?? "Campaign";
  if (screen === "session") {
    const n = names?.session(a, b);
    return n != null ? `Session ${n}` : "Session";
  }
  if (screen === "playlist") return names?.playlist(a) ?? "Playlist";
  if (screen === "board") return names?.board(a) ?? "Pad board";
  if (screen === "library" && a) {
    const t = names?.track(a);
    return t ? `Library: ${t}` : "Library";
  }
  if (screen === "profile") {
    const t = names?.track(a);
    return t ? `Audio profile: ${t}` : "Audio profile";
  }
  return SCREEN_WORDS[screen] ?? "the last screen";
}

/** Whether a place still exists. Until the library has answered, every place does. */
export function placeExists(path: string, names?: PlaceNames): boolean {
  if (!names?.loaded) return true;
  const [screen, a, b] = partsOf(path);
  if (screen === "campaign") return names.campaign(a) !== null;
  if (screen === "session") return names.session(a, b) !== null;
  if (screen === "playlist") return names.playlist(a) !== null;
  if (screen === "board") return names.board(a) !== null;
  if (screen === "profile" || (screen === "library" && a)) return names.track(a) !== null;
  return true;
}

/** One parent in a screen's trail. */
export interface Crumb {
  href: string;
  label: string;
}

/**
 * The trail (round 6 part 6): a screen's parents, each a link. The screen's own title (its h1) follows as the last
 * part. Screens at the top of the menu (Campaigns, Library, Playlists, Pad boards, Rooms, Settings, Look and feel,
 * Live) have none.
 */
export function trailOf(path: string, names?: PlaceNames): Crumb[] {
  const [screen, a] = partsOf(path);
  switch (screen) {
    case "campaign":
      return [{ href: "#/campaigns", label: "Campaigns" }];
    case "session":
      return [
        { href: "#/campaigns", label: "Campaigns" },
        { href: `#/campaign/${a}`, label: names?.campaign(a) ?? "Campaign" },
      ];
    case "playlist":
      return [{ href: "#/playlists", label: "Playlists" }];
    case "board":
      return [{ href: "#/boards", label: "Pad boards" }];
    case "profile":
      // The Library with the track open, as the prototype's profile.js crumbs.
      return [{ href: `#/library/${a}`, label: "Library" }];
    case "backup":
    case "moved":
    case "relink":
      return [{ href: "#/library", label: "Library" }];
    default:
      return [];
  }
}
