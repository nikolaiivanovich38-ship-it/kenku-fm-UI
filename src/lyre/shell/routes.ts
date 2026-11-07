/**
 * The new interface's screens and their addresses (UX-9), exactly as the design prototype writes them:
 * "campaigns", "campaign/crown", "session/crown/s14", "library", "library/t44", "playlists", "playlist/p-abbess",
 * "profile/t13", "profile/t13/sc:crown:s14:sc3", "boards", "board/weather", "live", "outputs", "look", and (round 5)
 * "backup", "moved", "relink" (Back up, move or share; What came across from Kenku FM; Find missing files).
 *
 * The page address is "#/" + the route ("#/session/crown/s14"). The prototype's own page form ("#session--crown--s14",
 * which its artifact host needed) is read too.
 */

export type RouteName =
  | "campaigns"
  | "campaign"
  | "session"
  | "library"
  | "playlists"
  | "playlist"
  | "profile"
  | "boards"
  | "board"
  | "live"
  | "outputs"
  | "look"
  | "backup"
  | "moved"
  | "relink"
  | "settings";

/** The rail's sections; every screen lights one of them. */
export type Section = "campaigns" | "library" | "playlists" | "boards" | "live" | "outputs" | "settings" | "look";

export interface Route {
  name: RouteName;
  /** The ids in the address: cid (campaign), sid (session), tid (track), pid (playlist), bid (board), ctx (place). */
  params: Record<string, string>;
  /** The address as written, without "#/". */
  path: string;
}

/** Opened when the address names no screen. */
export const DEFAULT_ROUTE = "campaigns";

/** Route patterns, in the prototype's order (core.js ROUTES). An id is letters, digits, "_" and "-". */
const ROUTES: [RegExp, RouteName, string[]][] = [
  [/^campaigns$/, "campaigns", []],
  [/^campaign\/([\w-]+)$/, "campaign", ["cid"]],
  [/^session\/([\w-]+)\/([\w-]+)$/, "session", ["cid", "sid"]],
  [/^library(?:\/([\w-]+))?$/, "library", ["tid"]],
  [/^playlists$/, "playlists", []],
  [/^playlist\/([\w-]+)$/, "playlist", ["pid"]],
  // A place is "pl:<playlist>" or "sc:<campaign>:<session>:<scene>".
  [/^profile\/([\w-]+)(?:\/([\w:-]+))?$/, "profile", ["tid", "ctx"]],
  [/^boards$/, "boards", []],
  [/^board\/([\w-]+)$/, "board", ["bid"]],
  [/^live$/, "live", []],
  [/^outputs$/, "outputs", []],
  [/^look$/, "look", []],
  [/^backup$/, "backup", []],
  [/^moved$/, "moved", []],
  [/^relink$/, "relink", []],
  // Round 6 (OUT-8): Settings in Lyre. The Rooms and Settings stream builds its screen.
  [/^settings$/, "settings", []],
];

const SECTION: Record<RouteName, Section> = {
  campaigns: "campaigns",
  campaign: "campaigns",
  session: "campaigns",
  library: "library",
  profile: "library",
  playlists: "playlists",
  playlist: "playlists",
  boards: "boards",
  board: "boards",
  live: "live",
  outputs: "outputs",
  look: "look",
  backup: "library",
  moved: "library",
  relink: "library",
  settings: "settings",
};

/** The screen for a route such as "session/crown/s14". An unknown address opens Live, as in the prototype. */
export function parseRoute(path: string): Route {
  for (const [pattern, name, keys] of ROUTES) {
    const match = path.match(pattern);
    if (match) {
      const params: Record<string, string> = {};
      keys.forEach((key, index) => {
        if (match[index + 1] !== undefined) {
          params[key] = match[index + 1];
        }
      });
      return { name, params, path };
    }
  }
  return { name: "live", params: {}, path };
}

/** The route in a page address: "#/session/crown/s14" or the prototype's "#session--crown--s14". */
export function routeFromHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (raw === "") {
    return parseRoute(DEFAULT_ROUTE);
  }
  return parseRoute(raw.includes("/") ? raw : raw.split("--").join("/"));
}

/** The page address for a route. */
export function hashOf(path: string): string {
  return `#/${path}`;
}

/** The rail section a screen belongs to (the Audio profile is part of the Library). */
export function sectionOf(route: Route): Section {
  return SECTION[route.name];
}
