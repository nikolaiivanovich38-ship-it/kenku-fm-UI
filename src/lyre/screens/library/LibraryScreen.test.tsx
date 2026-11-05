import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../../test/axe";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { dropNames, go, openAt } from "./testHarness";

const grid = () => screen.getByRole("grid", { name: "Tracks" });
/** A row by its title, read from its selection box ("Select <title>"). */
const row = (title: string) => screen.getByRole("checkbox", { name: `Select ${title}` }).closest("tr") as HTMLElement;
const shownTitles = () =>
  within(grid())
    .queryAllByRole("checkbox")
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((n) => n.startsWith("Select ") && !n.startsWith("Select all"))
    .map((n) => n.slice(7));
const filters = () => screen.getByRole("region", { name: "Filters" });
const details = () => screen.getByRole("region", { name: "Details" });
/** The Tracks box, where the message line after an action is (the live region says the same words elsewhere). */
const tracksBox = () => within(screen.getByRole("region", { name: "Tracks" }));
async function loaded() {
  await screen.findByRole("checkbox", { name: "Select Ashes" });
}

describe("Library: finding tracks", () => {
  it("shows how many tracks there are, each row with Preview, Play on air and More", async () => {
    openAt("library");
    await loaded();
    expect(screen.getByText("69 tracks")).toBeInTheDocument();
    const r = within(row("Abbess screams"));
    expect(r.getByRole("button", { name: "Preview Abbess screams" })).toHaveAttribute("tabindex", "-1");
    expect(r.getByRole("button", { name: "Play on air: Abbess screams" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "More for Abbess screams" })).toBeInTheDocument();
  });

  it("filters by kind: FX shows effects and stings, Ambience only ambience", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    const kinds = within(filters()).getByRole("group", { name: "Kind of track" });
    expect(within(kinds).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Music", "Ambience", "FX"]);
    await user.click(within(kinds).getByRole("button", { name: "FX" }));
    expect(within(kinds).getByRole("button", { name: "FX" })).toHaveAttribute("aria-pressed", "true");
    expect(shownTitles()).toContain("Heavy door slams");
    expect(shownTitles()).not.toContain("Ashes");
    expect(screen.getByRole("region", { name: "Filters" })).toHaveTextContent("1 filter on");
    await user.click(within(kinds).getByRole("button", { name: "Ambience" }));
    expect(shownTitles()).toContain("Busy tavern crowd, mugs, laughter");
  });

  it("a tag narrows the list and the box says what is shown; Clear all brings everything back", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    expect(filters()).toHaveTextContent("None: showing every track");
    await user.click(within(within(filters()).getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ }));
    expect(shownTitles()).toHaveLength(5);
    expect(filters()).not.toHaveTextContent("None: showing every track");
    // The box's count says filters, not a selection like the Tracks box's "3 selected" (w3-ux 13).
    expect(filters()).toHaveTextContent("1 filter on");
    expect(filters()).not.toHaveTextContent("1 selected");
    await user.click(within(filters()).getByRole("button", { name: "Clear all" }));
    expect(shownTitles().length).toBeGreaterThan(5);
  });

  it("New, not tagged yet shows the tracks just added", async () => {
    openAt("library");
    await loaded();
    await userEvent.setup().click(within(filters()).getByRole("button", { name: /^New, not tagged yet/ }));
    expect(shownTitles()).toHaveLength(3);
    expect(shownTitles()).toEqual(expect.arrayContaining(["Ashes", "Memories of Mother"]));
  });

  it("search narrows the list; sorting puts the longest first", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search tracks" }), "tavern");
    expect(shownTitles()).toContain("Busy tavern crowd, mugs, laughter");
    expect(shownTitles().length).toBeLessThan(10);
    expect(screen.getByRole("region", { name: "Tracks" })).toHaveTextContent(/of 69/);
    await user.clear(screen.getByRole("searchbox", { name: "Search tracks" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort tracks" }), "Longest first");
    expect(shownTitles()[0]).toMatch(/^Brutal battle/);
  });

  it("keys: the list is one Tab stop, Down moves, Space selects, Enter opens the details, P previews, A plays on air", async () => {
    const { audio } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    screen.getByRole("searchbox", { name: "Search tracks" }).focus();
    await user.tab(); // sort
    await user.tab(); // select all
    await user.tab(); // first row
    const first = document.activeElement as HTMLElement;
    expect(first.tagName).toBe("TR");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.tagName).toBe("TR");
    await user.keyboard(" ");
    expect(screen.getByRole("toolbar", { name: "Selected tracks" })).toHaveTextContent("1 selected");
    await user.keyboard("p");
    expect(audio.calls.some(([m]) => m === "previewTrack")).toBe(true);
    await user.keyboard("a");
    expect(audio.calls.some(([m]) => m === "playTrack")).toBe(true);
    await user.keyboard("{Enter}");
    expect(await within(details()).findByRole("textbox", { name: "Your title" })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/library\/t/);
  });
});

describe("Library: a track's details", () => {
  it("shows your title, the title in the file, the file name and the folder together", async () => {
    openAt("library");
    await loaded();
    await userEvent.setup().click(row("Ashes").querySelectorAll("td")[1]);
    const d = within(details());
    expect(await d.findByRole("textbox", { name: "Your title" })).toHaveValue("");
    expect(d.getAllByRole("term").map((t) => t.textContent)).toEqual(expect.arrayContaining(["Title in the file", "File name", "Folder"]));
    expect(d.getByText("Title in the file")).toBeInTheDocument();
    expect(d.getByText("13 Ashes.flac")).toBeInTheDocument();
    expect(d.getByText("H:\\Audio\\Scores\\Bear McCreary\\God of War")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Show in folder" })).toBeInTheDocument();
    expect(d.getByText("Today")).toBeInTheDocument();
  });

  it("Use the title in the file fills Your title; typing changes the list at once", async () => {
    openAt("library/t44");
    const title = await within(details()).findByRole("textbox", { name: "Your title" });
    const user = userEvent.setup();
    await user.click(within(details()).getByRole("button", { name: "Use the title in the file" }));
    expect(title).toHaveValue("Ashes");
    await user.clear(title);
    await user.type(title, "Grief and ash");
    expect(row("Grief and ash")).toBeInTheDocument();
  });

  it("has Preview, Play on air and a link to the Audio profile", async () => {
    const { audio } = openAt("library/t44");
    const d = within(details());
    const user = userEvent.setup();
    await user.click(await d.findByRole("button", { name: "Preview" }));
    expect(audio.calls).toContainEqual(["previewTrack", "t44", { from: "the Library" }]);
    act(() => audio.setNowPlaying({ preview: { key: "t44", label: "Ashes" } }));
    expect(d.getByRole("button", { name: "Stop preview" })).toHaveAttribute("aria-pressed", "true");
    await user.click(d.getByRole("button", { name: "Play on air" }));
    expect(audio.calls.some(([m, id]) => m === "playTrack" && id === "t44")).toBe(true);
    expect(d.getByRole("link", { name: "Audio profile" })).toHaveAttribute("href", "#/profile/t44");
  });

  it("adds a mood by typing: arrows pick a match, Enter adds it or creates a new one, focus stays in the box", async () => {
    const { api } = openAt("library/t44");
    const box = await within(details()).findByRole("combobox", { name: "Add a mood tag" });
    const user = userEvent.setup();
    await user.click(box);
    await user.keyboard("me");
    expect(box).toHaveAttribute("aria-expanded", "true");
    const options = within(screen.getByRole("listbox", { name: "Mood values" })).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Melancholy");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(await within(details()).findByRole("button", { name: "Remove Melancholy from Mood" })).toBeInTheDocument();
    await user.keyboard("Frostbitten");
    expect(within(screen.getByRole("listbox", { name: "Mood values" })).getAllByRole("option")[0]).toHaveTextContent("Create Frostbitten in Mood");
    await user.keyboard("{Enter}");
    expect(await within(details()).findByRole("button", { name: "Remove Frostbitten from Mood" })).toBeInTheDocument();
    expect(within(details()).getByRole("combobox", { name: "Add a mood tag" })).toHaveFocus();
    const t44 = (await api.library.listTracks()).find((t) => t.id === "t44");
    expect(t44.tags.mood).toEqual(["Melancholy", "Frostbitten"]);
    await user.click(within(details()).getByRole("button", { name: "Remove Melancholy from Mood" }));
    await waitFor(() => expect(within(details()).queryByRole("button", { name: "Remove Melancholy from Mood" })).toBeNull());
  });

  it("Tab adds what was typed (creating a new tag) or the suggestion chosen, and moves on; an empty box adds nothing (BUG-15)", async () => {
    const { api } = openAt("library/t44");
    const box = await within(details()).findByRole("combobox", { name: "Add a mood tag" });
    const user = userEvent.setup();
    const t44 = async () => (await api.library.listTracks()).find((t) => t.id === "t44");
    const before = (await t44()).tags.mood ?? [];
    // A tag that does not exist yet: Tab creates it, adds it, and focus moves on.
    await user.click(box);
    await user.keyboard("Frostbitten");
    await user.tab();
    expect(await within(details()).findByRole("button", { name: "Remove Frostbitten from Mood" })).toBeInTheDocument();
    expect(within(details()).getByRole("combobox", { name: "Add a mood tag" })).not.toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    await waitFor(async () => expect((await t44()).tags.mood).toEqual([...before, "Frostbitten"]));
    expect((await api.tags.listGroups()).find((g) => g.id === "mood")?.values).toContain("Frostbitten");
    // A suggestion chosen with the arrows: Tab adds it.
    await user.click(within(details()).getByRole("combobox", { name: "Add a mood tag" }));
    await user.keyboard("{ArrowDown}");
    const second = within(screen.getByRole("listbox", { name: "Mood values" })).getAllByRole("option")[1];
    const chosen = second.textContent ?? "";
    expect(second).toHaveAttribute("aria-selected", "true");
    await user.tab();
    expect(await within(details()).findByRole("button", { name: `Remove ${chosen} from Mood` })).toBeInTheDocument();
    // Typing part of a tag: Tab adds the first suggestion, as Enter does.
    await user.click(within(details()).getByRole("combobox", { name: "Add a mood tag" }));
    await user.keyboard("me");
    await user.tab();
    expect(await within(details()).findByRole("button", { name: "Remove Melancholy from Mood" })).toBeInTheDocument();
    // An empty box: Tab only moves on.
    const now = (await t44()).tags.mood;
    await user.click(within(details()).getByRole("combobox", { name: "Add a mood tag" }));
    await user.tab();
    expect(within(details()).getByRole("combobox", { name: "Add a mood tag" })).not.toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await t44()).tags.mood).toEqual(now);
  });

  it("Esc closes the suggestions", async () => {
    openAt("library/t44");
    const box = await within(details()).findByRole("combobox", { name: "Add a mood tag" });
    const user = userEvent.setup();
    await user.click(box);
    await user.keyboard("Ee");
    expect(box).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("energy, role and looping are chosen with buttons and saved", async () => {
    const { api } = openAt("library/t44");
    const d = within(details());
    const user = userEvent.setup();
    const energy = await d.findByRole("group", { name: "Energy, 1 calm to 5 intense" });
    await user.click(within(energy).getByRole("button", { name: "4" }));
    await waitFor(() => expect(within(energy).getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true"));
    await user.click(within(d.getByRole("group", { name: "Role" })).getByRole("button", { name: "Loop bed" }));
    await user.click(within(d.getByRole("group", { name: "Loop advice" })).getByRole("button", { name: "Crossfade the loop" }));
    await waitFor(async () => {
      const t = (await api.library.listTracks()).find((x) => x.id === "t44");
      expect([t.energy, t.role, t.loop]).toEqual([4, "loop_bed", "crossfade"]);
    });
    expect(within(d.getByRole("group", { name: "Role" })).getByRole("button", { name: "Loop bed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists the playlists it is in and the scenes that use it, directly or through a playlist", async () => {
    openAt("library/t13");
    const d = within(details());
    expect(await d.findByRole("region", { name: "In playlists" })).toBeInTheDocument();
    await waitFor(() => expect(d.getByRole("region", { name: "Used in" })).toHaveTextContent(/abbey ruins/i));
    expect(d.getByRole("region", { name: "Used in" })).toHaveTextContent(/Through/);
  });

  it("Close details goes back to the list and keeps the filters", async () => {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search tracks" }), "ashes");
    await user.click(row("Ashes").querySelectorAll("td")[1]);
    await within(details()).findByRole("textbox", { name: "Your title" });
    expect(screen.getByRole("searchbox", { name: "Search tracks" })).toHaveValue("ashes");
    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(window.location.hash).toBe("#/library");
    expect(screen.getByRole("searchbox", { name: "Search tracks" })).toHaveValue("ashes");
  });
});

describe("Library: adding tracks", () => {
  it("Add tracks offers files, a folder or a watched folder, and says files can be dropped", async () => {
    openAt("library");
    await loaded();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Add tracks/ }));
    const menu = screen.getByRole("menu", { name: "Add tracks" });
    expect(within(menu).getByRole("menuitem", { name: /^Add files…/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Add a folder…/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Watch a folder…/ })).toBeInTheDocument();
    expect(within(menu).getByText(/drop files and folders anywhere on this page/i)).toBeInTheDocument();
  });

  it("Add files… adds what was chosen, selected and shown as New", async () => {
    openAt("library", { choose: { files: () => ["H:\\Audio\\Scores\\Hans Zimmer\\Dune\\02 Leaving Caladan.flac"] } });
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Add tracks/ }));
    await user.click(screen.getByRole("menuitem", { name: /^Add files…/ }));
    expect(await screen.findByText("70 tracks")).toBeInTheDocument();
    expect(shownTitles()).toContain("Leaving Caladan");
    expect(screen.getByRole("toolbar", { name: "Selected tracks" })).toHaveTextContent("1 selected");
    expect(tracksBox().getByText(/1 track added/)).toBeInTheDocument();
  });

  it("a file already in the Library is named as such, nothing counts as added, and it is selected (UX review 6)", async () => {
    openAt("library", { choose: { files: () => ["H:\\Audio\\Scores\\Hans Zimmer\\Dune\\02 Leaving Caladan.flac"] } });
    await loaded();
    const user = userEvent.setup();
    const addFiles = async () => {
      await user.click(screen.getByRole("button", { name: /^Add tracks/ }));
      await user.click(screen.getByRole("menuitem", { name: /^Add files…/ }));
    };
    await addFiles();
    expect(await screen.findByText("70 tracks")).toBeInTheDocument();
    await addFiles();
    expect(await tracksBox().findByText(/Leaving Caladan is already in your Library/)).toBeInTheDocument();
    expect(tracksBox().queryByText(/added/)).toBeNull();
    expect(screen.getByText("70 tracks")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Selected tracks" })).toHaveTextContent("1 selected");
    expect(shownTitles()).toContain("Leaving Caladan");
  });

  it("names a file that could not be added by its name, not its full path (UX review 12)", async () => {
    openAt("library", { choose: { files: () => ["H:\\Audio\\In\\01 Wolf Moon.flac", "H:\\Audio\\In\\notes.txt"] } });
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Add tracks/ }));
    await user.click(screen.getByRole("menuitem", { name: /^Add files…/ }));
    expect(await tracksBox().findByText(/could not be added: notes\.txt:/)).toBeInTheDocument();
    expect(tracksBox().queryByText(/H:\\Audio/)).toBeNull();
  });

  it("dropped files join the Library, selected; other files are ignored", async () => {
    openAt("library");
    await loaded();
    dropNames(screen.getByRole("main"), ["01 Wolf Moon.flac", "02 Ember.mp3", "notes.txt"]);
    expect(await screen.findByText("71 tracks")).toBeInTheDocument();
    expect(shownTitles()).toEqual(expect.arrayContaining(["Wolf Moon", "Ember"]));
    expect(screen.getByRole("toolbar", { name: "Selected tracks" })).toHaveTextContent("2 selected");
  });

  it("Watch a folder… says it is watching, and files arriving there are offered as new tracks", async () => {
    const { api } = openAt("library", { choose: { folder: () => "H:\\Audio\\Incoming" } });
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Add tracks/ }));
    await user.click(screen.getByRole("menuitem", { name: /^Watch a folder…/ }));
    expect(await tracksBox().findByText(/Audio files you put there will appear here by themselves/)).toBeInTheDocument();
    await act(async () => void (await api.arrive("H:\\Audio\\Incoming", ["06 The Path.flac"])));
    expect(await tracksBox().findByText(/1 new file appeared/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show new tracks" }));
    expect(shownTitles()).toContain("The Path");
  });
});

describe("Library: many tracks at once", () => {
  async function selectTwoNew() {
    openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(row("Ashes")).getByRole("checkbox"));
    await user.click(within(row("Memories of Mother")).getByRole("checkbox"));
    return user;
  }

  it("ticking rows shows a bar with Tag…, Add to playlist…, New playlist from these and Clear selection", async () => {
    const user = await selectTwoNew();
    const bar = screen.getByRole("toolbar", { name: "Selected tracks" });
    expect(bar).toHaveTextContent("2 selected");
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Tag…", "Add to playlist…", "New playlist from these", "Clear selection"]);
    await user.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("toolbar", { name: "Selected tracks" })).toBeNull();
  });

  it("Tag… adds the ticked tags to every selected track, creating new values", async () => {
    const user = await selectTwoNew();
    await user.click(screen.getByRole("button", { name: "Tag…" }));
    const sheet = within(screen.getByRole("dialog", { name: "Tag 2 tracks" }));
    // No tag has a count yet, so the line about counts is not shown (w3-ux 17).
    expect(sheet.getByText("None of the 2 selected tracks has a tag yet.")).toBeInTheDocument();
    expect(sheet.queryByText(/how many of the/)).toBeNull();
    expect(sheet.getByRole("button", { name: "Tick a tag first" })).toBeDisabled();
    await user.click(sheet.getByRole("button", { name: "Grief, none have it" }));
    await user.type(sheet.getByRole("textbox", { name: "New Scene type value" }), "funeral{Enter}");
    expect(sheet.getByRole("button", { name: /^Funeral/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(sheet.getByRole("button", { name: "Add 2 tags to 2 tracks" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await tracksBox().findByText(/Added Grief, Funeral to 2 tracks\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tag…" }));
    expect(within(screen.getByRole("dialog", { name: "Tag 2 tracks" })).getByText(/how many of the 2 selected tracks have it already/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(within(filters()).getByRole("group", { name: "Mood" })).getByRole("button", { name: /^Grief/ }));
    expect(shownTitles()).toEqual(expect.arrayContaining(["Ashes", "Memories of Mother"]));
  });

  it("Tag… can remove tags", async () => {
    const user = await selectTwoNew();
    await user.click(screen.getByRole("button", { name: "Tag…" }));
    const sheet = within(screen.getByRole("dialog", { name: "Tag 2 tracks" }));
    await user.click(within(sheet.getByRole("group", { name: "Add or remove" })).getByRole("button", { name: "Remove tags" }));
    expect(within(sheet.getByRole("group", { name: "Add or remove" })).getByRole("button", { name: "Remove tags" })).toHaveAttribute("aria-pressed", "true");
    expect(sheet.getByRole("button", { name: "Grief, none have it" })).toBeDisabled();
  });

  it("Add to playlist… puts the selected tracks into the manual playlists ticked", async () => {
    const user = await selectTwoNew();
    await user.click(screen.getByRole("button", { name: "Add to playlist…" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add 2 tracks to playlists" }));
    expect(sheet.getByText(/Only manual playlists are listed/)).toBeInTheDocument();
    await user.click(sheet.getByRole("checkbox", { name: /^The Abbess/ }));
    await user.click(sheet.getByRole("button", { name: "Add" }));
    expect(await tracksBox().findByText(/Added 2 tracks to/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The Abbess" })).toHaveAttribute("href", "#/playlist/p-abbess");
  });

  it("New playlist from these makes a manual playlist and offers to open it", async () => {
    const user = await selectTwoNew();
    await user.click(screen.getByRole("button", { name: "New playlist from these" }));
    expect(await tracksBox().findByText(/made with 2 tracks/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open it" }).getAttribute("href")).toMatch(/^#\/playlist\//);
  });
});

describe("Library: accessibility", () => {
  it("passes axe with the list, and with a track open", async () => {
    openAt("library");
    await loaded();
    await expectNoAxeViolations();
    go("library/t44");
    await within(details()).findByRole("textbox", { name: "Your title" });
    await expectNoAxeViolations();
  });
});
