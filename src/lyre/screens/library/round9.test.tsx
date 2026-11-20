/**
 * Round 9 (ROUND9.md §7, items 25, 26, 27, 34): the Track library's Columns beside Sort, kept on this computer, header
 * sorting for every column, filter chips that show or hide, folders that do the same, and the order of the chips.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "./testHarness";
import { COLUMNS_KEY, FILTER_ORDER_KEY, inFilterOrder, rereadListPrefs, setColumns, setFilterOrder } from "./listPrefs";
import { chipState, cycleChip, cycleFolder, DEFAULT_FILTER, filterCount, filterSummary, inColumnOrder, USUAL_COLUMNS, visibleTracks } from "./model";
import type { LibraryTrack } from "../../../common/lyre/api";

const grid = () => screen.getByRole("grid", { name: "Tracks" });
const filters = () => screen.getByRole("region", { name: "Filters" });
const headers = () => within(grid()).getAllByRole("columnheader").map((h) => h.textContent?.trim() ?? "");
const shown = () => within(grid()).queryAllByRole("checkbox", { name: /^Select (?!all)/ }).length;
async function loaded() {
  await screen.findByRole("checkbox", { name: "Select Ashes" });
}

afterEach(() => {
  setColumns(USUAL_COLUMNS);
  setFilterOrder("vocab");
});

describe("the rules", () => {
  it("a chip goes off → Show → Hide → off, and a folder the same way", () => {
    let lists = cycleChip<string>([], [], "Grief");
    expect([lists.shown, lists.hidden, lists.now]).toEqual([["Grief"], [], "show"]);
    lists = cycleChip(lists.shown, lists.hidden, "Grief");
    expect([lists.shown, lists.hidden, lists.now]).toEqual([[], ["Grief"], "hide"]);
    expect(chipState(lists.shown, lists.hidden, "Grief")).toBe("hide");
    lists = cycleChip(lists.shown, lists.hidden, "Grief");
    expect([lists.shown, lists.hidden, lists.now]).toEqual([[], [], "off"]);
    let f = { ...DEFAULT_FILTER, ...cycleFolder(DEFAULT_FILTER, "H:\\Fx") };
    expect([f.folder, f.hideFolders]).toEqual(["H:\\Fx", []]);
    f = { ...f, ...cycleFolder(f, "H:\\Fx") };
    expect([f.folder, f.hideFolders]).toEqual(["", ["H:\\Fx"]]);
    f = { ...f, ...cycleFolder(f, "H:\\Fx") };
    expect([f.folder, f.hideFolders]).toEqual(["", []]);
  });

  it("hidden values leave their tracks out, Hide wins over Show, and the summary says not", () => {
    const t = (id: string, mood: string[], folder = "H:\\Music"): LibraryTrack => ({ id, kind: "music", title: id, metaTitle: "", fileName: "", durationMs: 1000, role: null, loop: null, energy: null, tags: { mood }, folder }) as unknown as LibraryTrack;
    const tracks = [t("a", ["Tense"]), t("b", ["Tense", "Grief"]), t("c", ["Grief"], "H:\\Fx\\Bangs")];
    const f = { ...DEFAULT_FILTER, tags: { mood: ["Tense"] }, hide: { mood: ["Grief"] } };
    expect(visibleTracks(tracks, f, "", "title").map((x) => x.id)).toEqual(["a"]);
    expect(filterCount(f)).toBe(2);
    expect(filterSummary(f, [{ id: "mood", name: "Mood", values: ["Tense", "Grief"] }] as never)).toBe("Tense · not Grief");
    expect(visibleTracks(tracks, { ...DEFAULT_FILTER, hideFolders: ["H:\\Fx"] }, "", "title").map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("columns keep the list's order; filter chips sort A to Z, Z to A or by most tracks", () => {
    expect(inColumnOrder(["length", "artist", "nonsense", "tags"])).toEqual(["artist", "tags", "length"]);
    const chips = [["Tense", 3], ["Eerie", 9], ["Grief", 3]] as const;
    expect(inFilterOrder(chips, "vocab").map((c) => c[0])).toEqual(["Tense", "Eerie", "Grief"]);
    expect(inFilterOrder(chips, "az").map((c) => c[0])).toEqual(["Eerie", "Grief", "Tense"]);
    expect(inFilterOrder(chips, "za").map((c) => c[0])).toEqual(["Tense", "Grief", "Eerie"]);
    expect(inFilterOrder(chips, "count").map((c) => c[0])).toEqual(["Eerie", "Grief", "Tense"]);
  });

  it("the choices are kept in the page's storage, and a storage that says nothing gives the usual ones", () => {
    setColumns(["artist", "length"]);
    setFilterOrder("count");
    expect(JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null")).toEqual(["artist", "length"]);
    expect(localStorage.getItem(FILTER_ORDER_KEY)).toBe("count");
    localStorage.setItem(COLUMNS_KEY, "not json");
    localStorage.removeItem(FILTER_ORDER_KEY);
    rereadListPrefs();
    setColumns(USUAL_COLUMNS);
    expect(JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null")).toEqual(["tags", "energy", "length"]);
  });
});

describe("Columns beside Sort", () => {
  it("shows Title always and the usual three; a ticked column appears, the menu stays open, Put back the usual columns", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    expect(headers().slice(1, 5)).toEqual(["Title", "Tags", "Energy", "Length"]);
    await user.click(screen.getByRole("button", { name: "Columns" }));
    const menu = within(screen.getByRole("menu", { name: "Columns" }));
    expect(menu.getAllByRole("menuitemcheckbox").map((m) => m.textContent?.replace(/\u00a0.*/, ""))).toEqual(["Title (always)", "Artist", "Album", "Type", "Use it for", "Tags", "Shape", "Energy", "Length", "Plays for", "Added", "Folder"]);
    await user.click(menu.getByRole("menuitemcheckbox", { name: "Use it for" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Energy" }));
    expect(headers().slice(1, 5)).toEqual(["Title", "Use it for", "Tags", "Length"]);
    expect(within(grid()).getByRole("row", { name: /^Select Very short heroic moment/ })).toHaveTextContent("Short cue");
    await user.click(screen.getByRole("menuitem", { name: "Put back the usual columns" }));
    expect(headers().slice(1, 5)).toEqual(["Title", "Tags", "Energy", "Length"]);
  });

  it("a column's header sorts by it, A to Z then Z to A, and the Sort box says By a column", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    setColumns(["album", ...USUAL_COLUMNS]);
    const album = await within(grid()).findByRole("columnheader", { name: /^Album/ });
    await user.click(within(album).getByRole("button"));
    expect(album).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("combobox", { name: "Sort tracks" })).toHaveDisplayValue("By a column");
    await user.click(within(album).getByRole("button"));
    expect(album).toHaveAttribute("aria-sort", "descending");
  });
});

describe("filters that show or hide", () => {
  it("a chip once shows only those tracks, again hides them (read out as hidden), again clears; Clear all clears both", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const all = shown();
    const grief = () => within(within(filters()).getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ });
    expect(grief()).toHaveAccessibleDescription("Click a filter once to show only those tracks, and again to hide them.");
    await user.click(grief());
    expect(grief()).toHaveAttribute("aria-pressed", "true");
    const only = shown();
    await user.click(grief());
    expect(grief()).toHaveAttribute("aria-pressed", "false");
    expect(grief()).toHaveAccessibleName(/hidden/);
    expect(shown()).toBe(all - only);
    expect(filters()).toHaveTextContent("not Grief");
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(grief()).not.toHaveAccessibleName(/hidden/);
    expect(shown()).toBe(all);
  });

  it("the order button lists the four orders and sorts the chips", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const words = () => within(within(filters()).getByRole("group", { name: "Mood" })).getAllByRole("button").map((b) => b.querySelector(".r9-c3-w")?.textContent ?? "").filter(Boolean);
    await user.click(screen.getByRole("button", { name: "Order the filters" }));
    const menu = within(screen.getByRole("menu", { name: "Order the filters" }));
    expect(menu.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["Tag list order", "A to Z", "Z to A", "Most tracks first"]);
    await user.click(menu.getByRole("menuitemradio", { name: "Z to A" }));
    const za = words();
    expect(za).toEqual([...za].sort((a, b) => b.localeCompare(a)));
  });
});
