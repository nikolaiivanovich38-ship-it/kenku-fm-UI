/** Lyre 0.5.2 (Nik's play test of 14 Nov, list of 18 Nov): the Library's fixes and small features, by item number. */
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "./testHarness";

const grid = () => screen.getByRole("grid", { name: "Tracks" });
const rowOf = (id: string) => grid().querySelector(`tr[data-tid="${id}"]`) as HTMLElement;
async function loaded() {
  await screen.findByRole("checkbox", { name: "Select Ashes" });
}

describe("item 7: the list shows a track's length, and its length after its Audio profile when that differs", () => {
  it("t13 is 7:21 long and plays 5:18 with its own profile; a track with no profile shows one length", async () => {
    openAt("library");
    await loaded();
    const cut = rowOf("t13").querySelector("td.lb-c-dur") as HTMLElement;
    expect(cut).toHaveTextContent("7:21");
    expect(cut).toHaveTextContent("5:18");
    expect(within(cut).getByTitle("Plays 5:18 with its Audio profile (file 7:21)")).toBeInTheDocument();
    const plain = rowOf("t01").querySelector("td.lb-c-dur") as HTMLElement;
    expect(plain.querySelector(".lb-played")).toBeNull();
  });
});

describe("item 6: either play button on a track's row opens that track's details", () => {
  it("Preview opens the track in Details and previews it; Play on air does the same for another track", async () => {
    const { audio } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^Preview / }));
    await waitFor(() => expect(window.location.hash).toBe("#/library/t13"));
    expect(audio.calls.some((c) => c[0] === "previewTrack" && c[1] === "t13")).toBe(true);
    await user.click(within(rowOf("t01")).getByRole("button", { name: /^Play on air: / }));
    await waitFor(() => expect(window.location.hash).toBe("#/library/t01"));
    expect(rowOf("t01")).toHaveAttribute("aria-current", "true");
    // More only opens its menu.
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    expect(window.location.hash).toBe("#/library/t01");
  });
});

describe("item 35: opening a track keeps the list scrolled where it was", () => {
  it("the list is at the same place after a click on a row far down", async () => {
    const tops = new WeakMap<Element, number>();
    const spies = [
      vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
        return tops.get(this) ?? 0;
      }),
      vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, top: number) {
        tops.set(this, Math.max(0, top));
      }),
    ];
    try {
      openAt("library");
      await loaded();
      const box = () => grid().closest(".lb-scroll") as HTMLElement;
      box().scrollTop = 900;
      box().dispatchEvent(new Event("scroll"));
      const user = userEvent.setup();
      await user.click(rowOf("t40").querySelector("td.lb-c-title") as HTMLElement);
      await waitFor(() => expect(window.location.hash).toBe("#/library/t40"));
      await waitFor(() => expect(box().scrollTop).toBe(900));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("item 23: the Library is the Track library where its name shows", () => {
  it("in the menu and the heading, at the same address", async () => {
    openAt("library");
    await loaded();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Track library");
    expect(within(screen.getByRole("navigation", { name: "Lyre" })).getByRole("link", { name: "Track library" })).toHaveAttribute("href", "#/library");
  });
});

const filters = () => screen.getByRole("region", { name: "Filters" });
const shownTitles = () =>
  within(grid())
    .queryAllByRole("checkbox")
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((n) => n.startsWith("Select ") && !n.startsWith("Select all"))
    .map((n) => n.slice(7));

describe("item 21: Clear in one filter control clears only that control; Clear all filters clears them all", () => {
  it("Clear by Mood takes off the Mood ticks only; the Shape and energy filters stay", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const f = within(filters());
    await user.click(within(f.getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ }));
    await user.click(within(f.getByRole("group", { name: "Shape" })).getByRole("button", { name: /^Builds/ }));
    await user.selectOptions(f.getByRole("combobox", { name: "Highest energy" }), "4");
    expect(filters()).toHaveTextContent("3 filters on");
    // Only a control with something chosen has its Clear.
    expect(f.queryByRole("button", { name: "Clear Leitmotif" })).toBeNull();
    await user.click(f.getByRole("button", { name: "Clear Mood" }));
    expect(filters()).toHaveTextContent("2 filters on");
    expect(within(f.getByRole("group", { name: "Shape" })).getByRole("button", { name: /^Builds/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(f.getByRole("button", { name: "Clear energy" }));
    expect(filters()).toHaveTextContent("1 filter on");
    await user.click(f.getByRole("button", { name: "Clear Shape" }));
    expect(filters()).not.toHaveTextContent("filter on");
  });

  it("Clear all filters clears every control and leaves the search as it is", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const f = within(filters());
    await user.type(screen.getByRole("searchbox", { name: "Search tracks" }), "the");
    await user.click(within(f.getByRole("group", { name: "Kind of track" })).getByRole("button", { name: "Music" }));
    await user.click(within(f.getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ }));
    await user.click(f.getByRole("button", { name: "Clear all filters" }));
    expect(filters()).not.toHaveTextContent("filter on");
    expect(screen.getByRole("searchbox", { name: "Search tracks" })).toHaveValue("the");
  });
});

describe("item 25: a click on a column header sorts by it, ascending then descending, with aria-sort", () => {
  it("Title, then Title again; Length; Energy", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const header = (name: string) => within(grid()).getByRole("columnheader", { name: new RegExp(`^${name}`) });
    expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    const a = shownTitles();
    await user.click(within(header("Title")).getByRole("button", { name: /Title/ }));
    expect(header("Title")).toHaveAttribute("aria-sort", "descending");
    expect(shownTitles()).toEqual([...a].reverse());
    expect(screen.getByRole("combobox", { name: "Sort tracks" })).toHaveValue("title-za");
    await user.click(within(header("Length")).getByRole("button", { name: /Length/ }));
    expect(header("Length")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Title")).not.toHaveAttribute("aria-sort");
    await user.click(within(header("Length")).getByRole("button", { name: /Length/ }));
    expect(header("Length")).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("combobox", { name: "Sort tracks" })).toHaveValue("long");
    await user.click(within(header("Energy")).getByRole("button", { name: /Energy/ }));
    expect(header("Energy")).toHaveAttribute("aria-sort", "ascending");
    // Low energy first; tracks with no energy yet after them, whichever way.
    const energies = [...grid().querySelectorAll("tbody td.lb-c-en [role=img]")].map((e) => Number(/Energy (\d)/.exec(e.getAttribute("aria-label") ?? "")?.[1] ?? 9));
    expect(energies).toEqual([...energies].sort((x, y) => x - y));
    await user.click(within(header("Energy")).getByRole("button", { name: /Energy/ }));
    const down = [...grid().querySelectorAll("tbody td.lb-c-en [role=img]")].map((e) => Number(/Energy (\d)/.exec(e.getAttribute("aria-label") ?? "")?.[1] ?? 0));
    expect(down).toEqual([...down].sort((x, y) => y - x));
  });
});

describe("item 10: a track with a tag the game master added is no longer New", () => {
  it("tagging a New track with no title of its own takes its New mark away", async () => {
    openAt("library/t44");
    await loaded();
    const user = userEvent.setup();
    expect(within(rowOf("t44")).getByText("New")).toBeInTheDocument();
    const details = screen.getByRole("region", { name: "Details" });
    await user.type(within(details).getByRole("combobox", { name: "Add a mood tag" }), "Grief{Enter}");
    await waitFor(() => expect(within(rowOf("t44")).queryByText("New")).toBeNull());
    expect(within(details).queryByText("New")).toBeNull();
  });
});
