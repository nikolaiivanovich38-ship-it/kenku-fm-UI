/**
 * Round 9 (ROUND9.md §8, items 38 and 42) and round 10 fixes (R10-FIX §1, §2): the Playlists list's Sort and Your
 * order, → Open, Delete playlist… in line with Undo, and a manual playlist's tracks unfolded with their dividers, a ⋯
 * with Remove from this playlist (Undo) and Delete on a focused row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "./testHarness";
import { dividersBefore } from "./PlaylistTrackList";
import { moveIndex, setPlaylistSort, sortPlaylists } from "./playlistOrder";
import type { PlaylistInfo } from "../../../common/lyre/api";
import { valueOf } from "../../../common/lyre/contract";

const names = () => screen.getAllByRole("button", { name: /^(Show|Hide) contents of / }).map((b) => (b.getAttribute("aria-label") ?? "").replace(/^(Show|Hide) contents of /, ""));
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^(Show|Hide) contents of ${name}$`) }).closest("li") as HTMLElement;

afterEach(() => setPlaylistSort("own"));

const pl = (id: string, over: Partial<PlaylistInfo> = {}): PlaylistInfo =>
  ({ id, name: id, lane: "music", kind: "manual", trackIds: [], order: null, normalise: null, notes: "", folderId: null, dividers: [], ...over }) as PlaylistInfo;

describe("the rules", () => {
  it("sorts by name, tracks, length, uses and newest; Your order keeps the list's order", () => {
    const rows = [pl("b", { createdAt: 1 }), pl("a", { createdAt: 3 }), pl("c", { createdAt: 2 })];
    const facts = { count: (p: PlaylistInfo) => ({ a: 1, b: 3, c: 2 })[p.id] ?? 0, length: (p: PlaylistInfo) => ({ a: 9, b: 1, c: 5 })[p.id] ?? 0, uses: () => 0 };
    expect(sortPlaylists(rows, "own", facts).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(sortPlaylists(rows, "az", facts).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(sortPlaylists(rows, "za", facts).map((p) => p.id)).toEqual(["c", "b", "a"]);
    expect(sortPlaylists(rows, "tracks", facts).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(sortPlaylists(rows, "long", facts).map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(sortPlaylists(rows, "used", facts).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(sortPlaylists(rows, "new", facts).map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("moves among the playlists of the same folder, and lands exactly where a drop's line was", () => {
    const all = [pl("a"), pl("x", { folderId: "f" }), pl("b"), pl("c"), pl("d")];
    expect(moveIndex(all, "a", "up")).toBeNull();
    expect(moveIndex(all, "a", "down")).toBe(1);
    expect(moveIndex(all, "c", "top")).toBe(0);
    expect(moveIndex(all, "d", { before: "b" })).toBe(1);
    expect(moveIndex(all, "a", { after: "c" })).toBe(2);
    expect(moveIndex(all, "a", { before: "b" })).toBeNull();
    expect(moveIndex(all, "a", { before: "x" })).toBeNull();
  });

  it("a divider heads the track under it; one below the last track heads nothing", () => {
    const p = pl("p", { trackIds: ["t1", "t2", "t3"], dividers: [{ id: "d1", name: "Calm", at: 0 }, { id: "d2", name: "Fight", at: 2 }, { id: "d3", name: "After", at: 3 }] });
    expect([...dividersBefore(p)]).toEqual([
      ["t1", ["Calm"]],
      ["t3", ["Fight"]],
    ]);
    expect(dividersBefore({ ...p, kind: "dynamic" } as never).size).toBe(0);
  });
});

describe("the Playlists list's order", () => {
  it("Sort lists seven sorts; Name Z to A sorts the list and the button says so", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Your order" }));
    const menu = within(screen.getByRole("menu", { name: "Sort the playlists" }));
    expect(menu.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["Your order", "Name A to Z", "Name Z to A", "Most tracks", "Longest", "Most used", "Newest"]);
    await user.click(menu.getByRole("menuitemradio", { name: "Name Z to A" }));
    const za = names();
    expect(za).toEqual([...za].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: "base", numeric: true })));
    expect(screen.getByRole("button", { name: "Name Z to A" })).toBeInTheDocument();
  });

  it("Move down, Move to the top and Alt+Up keep Your order; moving while sorted goes back to Your order", async () => {
    const { api } = openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    const before = names();
    await user.click(within(rowOf(before[0])).getByRole("button", { name: `More for ${before[0]}` }));
    await user.click(screen.getByRole("menuitem", { name: /^Move down/ }));
    await waitFor(() => expect(names().slice(0, 2)).toEqual([before[1], before[0]]));
    expect(document.getElementById("lyre-toast")).toHaveTextContent(/order of the playlists/);
    await user.click(within(rowOf("The Abbess")).getByRole("button", { name: "More for The Abbess" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to the top" }));
    await waitFor(() => expect(names()[0]).toBe("The Abbess"));
    within(rowOf(before[0])).getByRole("button", { name: `More for ${before[0]}` }).focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => expect(names().indexOf(before[0])).toBe(1));
    within(rowOf("The Abbess")).getByRole("button", { name: "More for The Abbess" }).focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => expect(names().indexOf("The Abbess")).toBe(1));
    setPlaylistSort("az");
    await user.click(await within(rowOf("Aftermath")).findByRole("button", { name: "More for Aftermath" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to the top" }));
    await waitFor(() => expect(names()[0]).toBe("Aftermath"));
    expect(screen.getByRole("button", { name: "Your order" })).toBeInTheDocument();
    expect((await api.playlists.list())[0].id).toBe("p-after");
  });

  it("every row has → Open to its page", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    expect(within(rowOf("The Abbess")).getByRole("link", { name: "Open The Abbess" })).toHaveAttribute("href", "#/playlist/p-abbess");
  });
});

describe("taking things out in line", () => {
  it("Delete playlist… in a row's ⋯ names where it is used, deletes it, stays on Playlists, and Undo brings it back", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    await user.click(within(rowOf("The Abbess")).getByRole("button", { name: "More for The Abbess" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete playlist…" }));
    const dialog = screen.getByRole("dialog", { name: 'Delete "The Abbess"?' });
    expect(dialog).toHaveTextContent("The abbey ruins");
    await user.click(within(dialog).getByRole("button", { name: "Delete playlist" }));
    await waitFor(() => expect(names()).not.toContain("The Abbess"));
    expect(window.location.hash).toBe("#/playlists");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(names()).toContain("The Abbess"));
  });

  it("Delete on a focused playlist row asks the same", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    within(rowOf("The Abbess")).getByRole("button", { name: "More for The Abbess" }).focus();
    await user.keyboard("{Delete}");
    expect(screen.getByRole("dialog", { name: 'Delete "The Abbess"?' })).toBeInTheDocument();
  });

  it("a manual playlist unfolded shows its dividers; a track's ⋯ removes it from the playlist, Delete too, with Undo", async () => {
    const { api } = openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    valueOf(await api.playlists.addDivider("p-abbess", "After the font", 3));
    await user.click(screen.getByRole("button", { name: "Show contents of The Abbess" }));
    const tracks = await screen.findByRole("list", { name: "Tracks in The Abbess" });
    await waitFor(() => expect(within(tracks).getByRole("listitem", { name: "Divider: After the font" })).toBeInTheDocument());
    const items = within(tracks).getAllByRole("listitem");
    const at = items.findIndex((li) => li.getAttribute("aria-label") === "Divider: After the font");
    expect(items[at + 1]).toHaveTextContent(/^4/);
    const rows = () => within(screen.getByRole("list", { name: "Tracks in The Abbess" })).getAllByRole("listitem").filter((li) => li.dataset.tid);
    expect(rows()).toHaveLength(5);
    await user.click(within(rows()[0]).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from this playlist" }));
    await waitFor(() => expect(rows()).toHaveLength(4));
    within(rows()[0]).getByRole("button", { name: /^More for / }).focus();
    await user.keyboard("{Delete}");
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(rows()).toHaveLength(4));
  });
});

describe("the playlist's page", () => {
  it("Delete on a focused track row takes it out of the playlist; Undo puts it back where it was", async () => {
    openAt("playlist/p-abbess");
    const user = userEvent.setup();
    const list = () => screen.getByRole("list", { name: "Tracks in order" });
    const names = () => within(list()).getAllByRole("listitem").map((li) => li.querySelector("a")?.textContent?.trim() ?? "");
    await waitFor(() => expect(names().length).toBe(5));
    const before = names();
    within(list()).getByRole("button", { name: /^More for Alien, unknowable/ }).focus();
    await user.keyboard("{Delete}");
    await waitFor(() => expect(names()).toHaveLength(4));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(names()).toEqual(before));
  });
});
