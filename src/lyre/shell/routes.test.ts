import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, hashOf, parseRoute, routeFromHash, sectionOf } from "./routes";

describe("routes: the addresses the prototype writes (UX-9)", () => {
  it.each([
    ["campaigns", "campaigns", {}],
    ["campaign/crown", "campaign", { cid: "crown" }],
    ["session/crown/s14", "session", { cid: "crown", sid: "s14" }],
    ["library", "library", {}],
    ["library/t44", "library", { tid: "t44" }],
    ["playlists", "playlists", {}],
    ["playlist/p-abbess", "playlist", { pid: "p-abbess" }],
    ["profile/t13", "profile", { tid: "t13" }],
    ["profile/t13/sc:crown:s14:sc3", "profile", { tid: "t13", ctx: "sc:crown:s14:sc3" }],
    ["profile/t13/pl:p-abbess", "profile", { tid: "t13", ctx: "pl:p-abbess" }],
    ["boards", "boards", {}],
    ["board/weather", "board", { bid: "weather" }],
    ["live", "live", {}],
    ["outputs", "outputs", {}],
    ["look", "look", {}],
  ])("%s opens the %s screen", (path, name, params) => {
    expect(parseRoute(path)).toEqual({ name, params, path });
  });

  it("opens Campaigns when no address is given, as the prototype does", () => {
    expect(DEFAULT_ROUTE).toBe("campaigns");
    expect(routeFromHash("").name).toBe("campaigns");
    expect(routeFromHash("#").name).toBe("campaigns");
    expect(routeFromHash("#/").name).toBe("campaigns");
  });

  it("falls back to Live for an address it does not know, as the prototype does", () => {
    expect(parseRoute("nowhere/at/all").name).toBe("live");
    expect(parseRoute("campaign/<script>").name).toBe("live");
  });

  it("reads the page address in the app's form (#/a/b) and the prototype's (#a--b)", () => {
    expect(routeFromHash("#/session/crown/s14")).toEqual(parseRoute("session/crown/s14"));
    expect(routeFromHash("#session--crown--s14")).toEqual(parseRoute("session/crown/s14"));
    expect(hashOf("profile/t13/sc:crown:s14:sc3")).toBe("#/profile/t13/sc:crown:s14:sc3");
  });

  it("lights the rail's section for every screen under it", () => {
    const section = (path: string) => sectionOf(parseRoute(path));
    expect(["campaigns", "campaign/crown", "session/crown/s14"].map(section)).toEqual(["campaigns", "campaigns", "campaigns"]);
    expect(["library", "library/t44", "profile/t13"].map(section)).toEqual(["library", "library", "library"]);
    expect(["playlists", "playlist/p1"].map(section)).toEqual(["playlists", "playlists"]);
    expect(["boards", "board/weather"].map(section)).toEqual(["boards", "boards"]);
    expect(["live", "outputs", "look"].map(section)).toEqual(["live", "outputs", "look"]);
  });
});
