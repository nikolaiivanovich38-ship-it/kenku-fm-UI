/** Lyre 0.5.2 (Nik's play test of 14 Nov, list of 18 Nov): the Library's fixes and small features, by item number. */
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "./testHarness";
import { expectNoAxeViolations } from "../../test/axe";

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
      // A row in sight at that place: rows are 30 px high here, so the 36th is at 1050 px.
      const id = (grid().querySelectorAll("tbody tr[data-tid]")[35] as HTMLElement).dataset.tid as string;
      await user.click(rowOf(id).querySelector("td.lb-c-title") as HTMLElement);
      await waitFor(() => expect(window.location.hash).toBe(`#/library/${id}`));
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

describe("items 20 and 40: a library folder's ⋯ in the Filters box", () => {
  it("item 40: says what kind its new tracks are; a new file there gets that kind, with Undo", async () => {
    const { api } = openAt("library", { folderFiles: { "H:\\Audio\\Scores\\New": ["drums.flac"] } });
    await loaded();
    const user = userEvent.setup();
    const f = within(filters());
    await user.click(f.getByRole("button", { name: "More for the folder H:\\Audio\\Scores" }));
    expect(screen.getByRole("menuitemradio", { name: "Guessed from the folder name" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Always FX" }));
    await waitFor(async () => expect((await api.library.listFolders()).find((x) => x.path === "H:\\Audio\\Scores")?.newKind).toBe("fx"));
    expect(await screen.findAllByText("New tracks in Scores are FX.")).not.toHaveLength(0);
    const added = await api.import.start({ from: "paths", paths: ["H:\\Audio\\Scores\\New"] });
    const id = added.ok ? added.value.added[0] : "";
    expect((await api.library.listTracks()).find((t) => t.id === id)?.kind).toBe("fx");
  });

  it("item 20: Remove folder… keeps its tracks unless ticked; ticked, it names where they are used, and Undo puts them back", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    const f = within(filters());
    const before = (await api.library.listTracks()).length;
    await user.click(f.getByRole("button", { name: "More for the folder H:\\Audio\\Ambience" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove folder…" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Ambience?" });
    expect(dialog).toHaveTextContent("Nothing is deleted from your computer.");
    const tick = within(dialog).getByRole("checkbox", { name: /^Also remove its \d+ tracks from the library$/ });
    expect(tick).not.toBeChecked();
    await user.click(tick);
    expect(within(dialog).getByRole("note")).toHaveTextContent(/Scenes: /);
    await user.click(within(dialog).getByRole("button", { name: "Remove folder" }));
    await waitFor(async () => expect((await api.library.listTracks()).length).toBeLessThan(before));
    expect(f.queryByRole("button", { name: "More for the folder H:\\Audio\\Ambience" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await api.library.listTracks()).length).toBe(before));
  });

  it("item 20: without the tick the folder goes and its tracks stay", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    const before = (await api.library.listTracks()).length;
    await user.click(within(filters()).getByRole("button", { name: "More for the folder H:\\Audio\\Effects" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove folder…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove folder" }));
    await waitFor(async () => expect((await api.library.listFolders()).map((x) => x.path)).not.toContain("H:\\Audio\\Effects"));
    expect((await api.library.listTracks()).length).toBe(before);
  });
});

describe("items 1 and 50: Remove from library, Delete file from disk…, Remove all shown…", () => {
  it("a row's ⋯ › Remove from library names where it is used, removes it, leaves its file, and Undo brings it back", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from library" }));
    const dialog = screen.getByRole("dialog", { name: /^Remove “Eerie dread.*” from the library\?$/ });
    expect(dialog).toHaveTextContent("Its file stays on your computer");
    expect(within(dialog).getByRole("note")).toHaveTextContent("It is used in:Scenes: The abbey ruins (Session 14)");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(rowOf("t13")).toBeNull());
    expect(api.trashedFiles()).toEqual([]);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(rowOf("t13")).not.toBeNull());
  });

  it("the selection's ⋯ removes every ticked track in one step", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Ashes" }));
    await user.click(within(rowOf("t13")).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "More for the selected tracks" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from library" }));
    await user.click(within(screen.getByRole("dialog", { name: "Remove 2 tracks from the library?" })).getByRole("button", { name: "Remove 2 tracks" }));
    await waitFor(async () => expect((await api.library.listTracks()).map((t) => t.id)).not.toContain("t44"));
    expect(screen.queryByRole("toolbar", { name: "Selected tracks" })).toBeNull();
    expect((await api.history.state()).undoLabel).toBe("Remove 2 tracks from the library");
  });

  it("Delete file from disk… names the file, says it can't be undone, and sends it to the Recycle Bin", async () => {
    const { api } = openAt("library/t13");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Delete file from disk…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete its file from disk?" });
    expect(dialog).toHaveTextContent("06 Bridge of Death.flac");
    expect(dialog).toHaveTextContent("This can't be undone in Lyre");
    expect(dialog).toHaveTextContent("Recycle Bin");
    // Cancel does nothing.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.trashedFiles()).toEqual([]);
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Delete file from disk…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(api.trashedFiles()).toEqual(["H:\\Audio\\Scores\\Hildur Gudnadottir\\Chernobyl\\06 Bridge of Death.flac"]));
    await waitFor(() => expect(rowOf("t13")).toBeNull());
    // The open track was it: Details closes.
    await waitFor(() => expect(window.location.hash).toBe("#/library"));
  });

  it("item 50: Remove all shown… removes what a filter shows, with the count in the confirmation; it is offered only with a filter on", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    const more = () => screen.getByRole("button", { name: "More for the library" });
    await user.click(more());
    expect(screen.queryByRole("menuitem", { name: /^Remove all shown/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(within(within(filters()).getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ }));
    const shown = shownTitles().length;
    await user.click(more());
    await user.click(screen.getByRole("menuitem", { name: `Remove all shown (${shown})…` }));
    const dialog = screen.getByRole("dialog", { name: `Remove all ${shown} shown tracks from the library?` });
    const before = (await api.library.listTracks()).length;
    await user.click(within(dialog).getByRole("button", { name: `Remove ${shown} tracks` }));
    await waitFor(async () => expect((await api.library.listTracks()).length).toBe(before - shown));
  });
});

describe("items 4, 12 and 39: a track's Type, for one track or the selection", () => {
  it("Details › How it plays › Type changes it at once when nothing is affected", async () => {
    const { api } = openAt("library/t44");
    await loaded();
    const user = userEvent.setup();
    const type = within(screen.getByRole("region", { name: "Details" })).getByRole("group", { name: "Type" });
    expect(within(type).getAllByRole("button").map((b) => b.textContent)).toEqual(["Music", "Ambience", "FX"]);
    expect(within(type).getByRole("button", { name: "Music" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(type).getByRole("button", { name: "FX" }));
    await waitFor(() => expect(within(type).getByRole("button", { name: "FX" })).toHaveAttribute("aria-pressed", "true"));
    expect((await api.library.listTracks()).find((t) => t.id === "t44")).toMatchObject({ kind: "fx", role: "effect" });
    expect(within(rowOf("t44")).getByText("FX")).toBeInTheDocument();
  });

  it("asks first when the change affects a scene's ambience, naming the scene", async () => {
    const { api } = openAt("library");
    const scenes = (await api.campaigns.list()).flatMap((c) => c.sessions.flatMap((s) => s.scenes.map((sc) => ({ sc, n: s.number }))));
    const used = scenes.find(({ sc }) => sc.ambience?.kind === "track");
    if (!used || used.sc.ambience?.kind !== "track") throw new Error("the sample has a scene with an ambience track");
    const id = used.sc.ambience.id;
    window.location.hash = `#/library/${id}`;
    await loaded();
    const user = userEvent.setup();
    const type = await within(await screen.findByRole("region", { name: "Details" })).findByRole("group", { name: "Type" });
    await user.click(within(type).getByRole("button", { name: "Music" }));
    const dialog = screen.getByRole("dialog", { name: /Music\?$/ });
    expect(dialog).toHaveTextContent(`is the ambience of ${used.sc.name} (Session ${used.n})`);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect((await api.library.listTracks()).find((t) => t.id === id)?.kind).toBe("amb");
    await user.click(within(type).getByRole("button", { name: "Music" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Make Music" }));
    await waitFor(async () => expect((await api.library.listTracks()).find((t) => t.id === id)?.kind).toBe("music"));
  });

  it("the selection's ⋯ › Type changes every ticked track in one step, naming a playlist of another type, with Undo", async () => {
    const { api } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    const manual = (await api.playlists.list()).find((p) => p.kind === "manual" && p.lane === "music" && p.trackIds.length > 0);
    if (!manual || manual.kind !== "manual") throw new Error("the sample has a manual music playlist");
    const inIt = manual.trackIds[0];
    await user.click(within(rowOf(inIt)).getByRole("checkbox"));
    await user.click(screen.getByRole("checkbox", { name: "Select Ashes" }));
    await user.click(screen.getByRole("button", { name: "More for the selected tracks" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Ambience" }));
    const dialog = screen.getByRole("dialog", { name: "Make 2 tracks Ambience?" });
    expect(dialog).toHaveTextContent(`in ${manual.name}, a Music playlist.`);
    await user.click(within(dialog).getByRole("button", { name: "Make Ambience" }));
    await waitFor(async () => expect((await api.library.listTracks()).filter((t) => [inIt, "t44"].includes(t.id)).map((t) => t.kind)).toEqual(["amb", "amb"]));
    expect((await api.history.state()).undoLabel).toBe("Type Ambience for 2 tracks");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await api.library.listTracks()).find((t) => t.id === "t44")?.kind).toBe("music"));
  });
});

describe("0.5.2: the new confirmations have no accessibility failures", () => {
  it("Remove from library, Delete file from disk… and Remove folder…", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from library" }));
    await expectNoAxeViolations(screen.getByRole("dialog"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Delete file from disk…" }));
    await expectNoAxeViolations(screen.getByRole("dialog"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(within(filters()).getByRole("button", { name: "More for the folder H:\\Audio\\Ambience" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove folder…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox"));
    await expectNoAxeViolations(screen.getByRole("dialog"));
    // Three axe runs: more time than one screen's check on a busy machine.
  }, 60_000);
});

describe("round 8 click-through findings for the Library (lead, 18 Nov)", () => {
  it("#2: Pick up where it stopped has the whole row, not the narrow label column", async () => {
    openAt("library/t02");
    await loaded();
    const sw = await within(screen.getByRole("region", { name: "Details" })).findByRole("switch", { name: "Pick up where it stopped" });
    expect(sw.closest(".lb-tg")).toHaveClass("lb-tg-wide");
  });

  it("#4: Follow with's line under the list is the list's description, spaced clear of its focus ring", async () => {
    openAt("library/t02");
    await loaded();
    const user = userEvent.setup();
    await user.click(await within(screen.getByRole("region", { name: "Details" })).findByRole("button", { name: "Follow with…" }));
    const select = within(screen.getByRole("dialog")).getByRole("combobox", { name: "When it ends, play" });
    expect(select).toHaveAccessibleDescription("Unless something is waiting in Play next.");
    expect(screen.getByText("Unless something is waiting in Play next.")).toHaveClass("lb-follow-hint");
  });

  it("#5: opened at a track from elsewhere (a playlist's track title), the list scrolls the open row into view", async () => {
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
      // The last track by title is far below the first screenful.
      const { api } = openAt("playlists");
      const titles = (await api.library.listTracks()).map((t) => ({ id: t.id, title: t.title || t.metaTitle || t.fileName }));
      const last = titles.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true })).slice(-1)[0];
      window.location.hash = `#/library/${last.id}`;
      await loaded();
      const box = () => grid().closest(".lb-scroll") as HTMLElement;
      await waitFor(() => expect(box().scrollTop).toBeGreaterThan(0));
      expect(rowOf(last.id)).toHaveAttribute("aria-current", "true");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
