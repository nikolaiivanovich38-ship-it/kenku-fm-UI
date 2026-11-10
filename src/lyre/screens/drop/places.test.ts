import { describe, expect, it } from "vitest";
import { prototypeSeed } from "../../../common/lyre/seed";
import { draggedName, dropTargets } from "./places";

const seed = prototypeSeed(Date.UTC(2026, 10, 5, 12));
const track = (id: string) => seed.tracks.find((t) => t.id === id)!;

describe("where dragged tracks can go (r7org.js places)", () => {
  it("music goes to the other manual music playlists, the campaign's first, then Up next and the next session's scenes", () => {
    const crown = seed.campaigns.find((c) => c.id === "crown")!;
    const s14 = crown.sessions.find((s) => s.id === "s14")!;
    const places = dropTargets([track("t13")], "p-abbess", { playlists: seed.playlists, boards: seed.boards, rooms: [], campaign: crown, session: s14 });
    const playlists = places.filter((p) => p.group === "Playlists");
    expect(playlists.every((p) => p.key !== "pl:p-abbess")).toBe(true);
    expect(playlists.map((p) => p.key.slice(3)).slice(0, crown.playlistIds.filter((id) => playlists.some((p) => p.key === `pl:${id}`)).length).every((id) => crown.playlistIds.includes(id))).toBe(true);
    expect(places.some((p) => p.group === "Pad boards")).toBe(false);
    expect(places.find((p) => p.group === "Up next")?.name).toBe("Up next in Table");
    expect(places.find((p) => p.key === "sc:crown:s14:sc3")?.label).toBe("Session 14 › The abbey ruins");
  });

  it("a sting can become a new pad on a board", () => {
    const places = dropTargets([track("t39")], null, { playlists: seed.playlists, boards: seed.boards, rooms: [{ roomId: "b1", name: "Side room" }], campaign: null, session: null });
    expect(places.some((p) => p.group === "Pad boards")).toBe(true);
    expect(places.filter((p) => p.group === "Up next").map((p) => p.name)).toEqual(["Up next in Side room"]);
  });

  it("names what is dragged", () => {
    expect(draggedName([{ title: "Ashes" }])).toBe("Ashes");
    expect(draggedName([{ title: "a" }, { title: "b" }])).toBe("2 tracks");
  });
});
