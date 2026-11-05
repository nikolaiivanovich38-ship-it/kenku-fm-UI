import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../../test/axe";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { dropNames, go, openAt } from "./testHarness";

const list = () => screen.getByRole("list", { name: "Playlists" });
/** A playlist's row in the list, found by its expander. */
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^(Show|Hide) contents of ${name}$`) }).closest("li") as HTMLElement;
const trackNames = (name = "Tracks in order") =>
  within(screen.getByRole("list", { name }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("a")?.textContent?.trim() ?? "");
const region = (name: string) => screen.getByRole("region", { name });
/** The screen itself (the live region repeats its messages outside it). */
const main = () => within(screen.getByRole("main"));

describe("Playlists: every playlist", () => {
  it("lists each playlist with its kind, lane, track count and length", async () => {
    openAt("playlists");
    expect(await screen.findByText("21 playlists")).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /^The Company themes\s*, Manual, Music/ })).toHaveAttribute("href", "#/playlist/p-company");
    expect(within(list()).getByRole("link", { name: /^Abbey: eerie, low energy\s*, Dynamic, Music/ })).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /^Abbey ambience\s*, Manual, Ambience/ })).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /^Stings and hits\s*, Manual, FX/ })).toBeInTheDocument();
    await waitFor(() => expect(rowOf("The Company themes")).toHaveTextContent("19:26"));
  });

  it("filters by lane, kind, use and words", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    const lane = screen.getByRole("group", { name: "Music, ambience or FX" });
    expect(within(lane).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Music", "Ambience", "FX"]);
    await user.click(within(lane).getByRole("button", { name: "FX" }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Showing 1 of 21" })).toBeInTheDocument();
    await user.click(within(lane).getByRole("button", { name: "All" }));
    await user.click(within(screen.getByRole("group", { name: "Manual or dynamic" })).getByRole("button", { name: "Dynamic" }));
    expect(within(list()).queryAllByRole("link", { name: /, Manual,/ })).toHaveLength(0);
    await user.click(within(screen.getByRole("group", { name: "Manual or dynamic" })).getByRole("button", { name: "All" }));
    await user.click(within(screen.getByRole("group", { name: "Used or not" })).getByRole("button", { name: "Not used yet" }));
    expect(within(list()).queryAllByRole("link", { name: /used in/ })).toHaveLength(0);
    await user.click(within(screen.getByRole("group", { name: "Used or not" })).getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: "Search playlists by name or tag" }), "abbess");
    expect(within(list()).getByRole("link", { name: /^The Abbess/ })).toBeInTheDocument();
    expect(within(list()).queryByRole("link", { name: /^The Company themes/ })).toBeNull();
  });

  it("each row opens in place to show its tracks and where it is used, and starts closed", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    expect(screen.queryByRole("list", { name: "Tracks in The Company themes" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show contents of The Company themes" }));
    expect(within(screen.getByRole("list", { name: "Tracks in The Company themes" })).getAllByRole("listitem")).toHaveLength(6);
    expect(rowOf("The Company themes")).toHaveTextContent("Session 14 › Greyhollow inn");
    await user.click(screen.getByRole("button", { name: "Hide contents of The Company themes" }));
    expect(screen.queryByRole("list", { name: "Tracks in The Company themes" })).toBeNull();
  });

  it("each row has Preview and Play on air; a row's menu has Open and Use in…, no Duplicate", async () => {
    const { audio } = openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    const row = within(rowOf("The Company themes"));
    await user.click(row.getByRole("button", { name: "Preview The Company themes" }));
    expect(audio.calls).toContainEqual(["previewPlaylist", "p-company"]);
    act(() => audio.setNowPlaying({ preview: { key: "pl:p-company", label: "The Company themes" } }));
    expect(row.getByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await user.click(row.getByRole("button", { name: "Play on air: The Company themes" }));
    expect(audio.calls.some(([m, id]) => m === "playPlaylist" && id === "p-company")).toBe(true);
    await user.click(row.getByRole("button", { name: "More for The Company themes" }));
    const menu = screen.getByRole("menu", { name: "More for The Company themes" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open", "Use in…"]);
  });

  it("shows what plays on air in a bar at the foot of the screen", async () => {
    const { audio } = openAt("playlists");
    await screen.findByText("21 playlists");
    act(() =>
      audio.setNowPlaying({
        rooms: [
          {
            roomId: "table",
            name: "Table",
            music: { trackId: "t24", title: "Epic choir hero anthem", origin: "playlist" as never, playlistId: "p-company", position: 0, length: 237, paused: false, loading: false },
            ambience: null,
            upNext: null,
            queued: [],
            effects: [],
          },
        ],
      }),
    );
    expect(screen.getByRole("region", { name: "On air" })).toHaveTextContent("Epic choir hero anthem");
    expect(within(list()).getByRole("link", { name: /^The Company themes/ }).closest("li")).toHaveTextContent("On air");
  });

  it("New playlist offers Manual and Dynamic for each lane; a new manual playlist opens empty, its name ready to type", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New playlist" }));
    const menu = screen.getByRole("menu", { name: "New playlist" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(6);
    await user.click(within(menu).getAllByRole("menuitem", { name: /^Manual\s*Pick tracks and put them in order/ })[0]);
    expect(await screen.findByRole("heading", { name: "New music playlist", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^No tracks yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
  });

  it("files dropped on a row join that playlist and the Library", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    dropNames(rowOf("Coast road travel"), ["01 Harbour dawn.flac", "notes.txt"]);
    expect(await main().findByText(/added to Coast road travel and your Library/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show contents of Coast road travel" }));
    const inside = screen.getByRole("list", { name: "Tracks in Coast road travel" });
    expect(within(inside).getAllByRole("listitem")).toHaveLength(5);
    expect(inside).toHaveTextContent("Harbour dawn");
  });

  it("files dropped beside the list ask which playlist they go to", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    dropNames(screen.getByRole("searchbox", { name: "Search playlists by name or tag" }), ["01 Rain.flac"]);
    const ask = await screen.findByRole("group", { name: "Dropped files" });
    expect(ask).toHaveTextContent("1 audio file dropped");
    await userEvent.setup().click(within(ask).getByRole("button", { name: "Library only" }));
    expect(await main().findByText(/added to your Library/)).toBeInTheDocument();
  });

  it("passes axe", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    await expectNoAxeViolations();
  });
});

describe("Playlists: a manual playlist", () => {
  it("shows its tracks numbered in play order, with Preview, Play on air and Use in…", async () => {
    openAt("playlist/p-abbess");
    expect(await screen.findByRole("heading", { name: "The Abbess", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent(/Manual\s*·\s*Music/);
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    expect(trackNames()[0]).toMatch(/^Ancient sorrow/);
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Play on air" })).toBeEnabled();
  });

  it("is renamed from the pencil, and the heading follows the typing", async () => {
    const { api } = openAt("playlist/p-abbess");
    await screen.findByRole("heading", { name: "The Abbess", level: 1 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Rename this playlist" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toHaveFocus());
    await user.clear(name);
    await user.type(name, "The Abbess, her theme");
    expect(screen.getByRole("heading", { name: "The Abbess, her theme", level: 1 })).toBeInTheDocument();
    await waitFor(async () => expect((await api.playlists.list()).find((p) => p.id === "p-abbess")?.name).toBe("The Abbess, her theme"));
  });

  it("adds a track from the Add tracks box, which searches Music, Ambience or FX", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const add = within(region("Add tracks"));
    expect(within(add.getByRole("group", { name: "Search in" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Music", "Ambience", "FX"]);
    const user = userEvent.setup();
    await user.type(add.getByRole("searchbox", { name: "Search the library by any name or tag" }), "quiet grief");
    expect(add.getByRole("button", { name: /^Preview Quiet grief/ })).toBeInTheDocument();
    expect(add.getByRole("button", { name: /^Play on air: Quiet grief/ })).toBeInTheDocument();
    await user.click(add.getByRole("button", { name: /^Add Quiet grief/ }));
    await waitFor(() => expect(trackNames()).toHaveLength(6));
    expect(trackNames().slice(-1)[0]).toMatch(/^Quiet grief/);
  });

  it("moves a track down from its menu, and back up with Alt+Up", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const first = trackNames()[0];
    const user = userEvent.setup();
    const ordered = () => within(screen.getByRole("list", { name: "Tracks in order" }));
    await user.click(ordered().getByRole("button", { name: /^More for Ancient sorrow/ }));
    expect(screen.getByRole("menuitem", { name: /^Audio profile in this playlist/ })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /^Move down/ }));
    await waitFor(() => expect(trackNames()[1]).toBe(first));
    ordered().getByRole("button", { name: /^More for Ancient sorrow/ }).focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => expect(trackNames()[0]).toBe(first));
  });

  it("takes a track out from its menu; it stays in the Library", async () => {
    const { api } = openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("list", { name: "Tracks in order" })).getByRole("button", { name: /^More for Alien, unknowable/ }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from this playlist" }));
    await waitFor(() => expect(trackNames()).toHaveLength(4));
    expect((await api.library.listTracks()).some((t) => t.id === "t14")).toBe(true);
  });

  it("files dropped on it are added, in order, and to the Library", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    dropNames(region("Tracks"), ["01 Candle smoke.flac", "02 Bell tower.mp3", "readme.txt"]);
    await waitFor(() => expect(trackNames()).toHaveLength(7));
    const names = trackNames();
    expect(names.indexOf("Bell tower")).toBe(names.indexOf("Candle smoke") + 1);
  });

  it("Use in… ticks where it is used, and Save changes it", async () => {
    openAt("playlist/p-abbess");
    await screen.findByRole("heading", { name: "The Abbess", level: 1 });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Use in…" })[0]);
    const sheet = within(screen.getByRole("dialog", { name: /Use "The Abbess" in…/ }));
    expect(sheet.getByRole("checkbox", { name: /^Scene: The abbey ruins/ })).toBeChecked();
    expect(sheet.getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ })).not.toBeChecked();
    await user.click(sheet.getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ }));
    expect(sheet.getByText("3 chosen")).toBeInTheDocument();
    await user.click(sheet.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(region("Used in")).toHaveTextContent("Session 14"));
  });

  it("Use in… folds the campaigns, except those it is used in and the campaign in hand", async () => {
    openAt("campaign/masks");
    go("playlist/p-abbess");
    await screen.findByRole("heading", { name: "The Abbess", level: 1 });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Use in…" })[0]);
    const sheet = within(screen.getByRole("dialog", { name: /Use "The Abbess" in…/ }));
    expect(sheet.getByRole("button", { name: /^The Sunken Crown/ })).toHaveAttribute("aria-expanded", "true");
    expect(sheet.getByRole("button", { name: /^Ash and Masks/ })).toHaveAttribute("aria-expanded", "true");
    const sixth = sheet.getByRole("button", { name: /^The Sixth Year/ });
    expect(sixth).toHaveAttribute("aria-expanded", "false");
    expect(sixth).toHaveTextContent("0 ticked");
    expect(sheet.queryByRole("checkbox", { name: /^The Sixth Year: whole campaign/ })).toBeNull();
    await user.click(sixth);
    expect(sheet.getByRole("checkbox", { name: /^The Sixth Year: whole campaign/ })).not.toBeChecked();
  });

  it("Delete playlist… asks first, and Keep it keeps it", async () => {
    openAt("playlist/p-abbess");
    await screen.findByRole("heading", { name: "The Abbess", level: 1 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete playlist…" }));
    expect(screen.getByRole("dialog", { name: 'Delete "The Abbess"?' })).toHaveTextContent("The tracks stay in your library.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete playlist…" }));
    await user.click(screen.getByRole("button", { name: "Delete playlist" }));
    await waitFor(() => expect(window.location.hash).toBe("#/playlists"));
  });

  it("passes axe", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    await expectNoAxeViolations();
  });
});

describe("Playlists: a dynamic playlist", () => {
  it("shows its rules, the rule in plain words and the matching tracks", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = within(await screen.findByRole("region", { name: "Rules" }));
    expect(screen.getByRole("main")).toHaveTextContent(/Dynamic\s*·\s*Music/);
    expect(within(rules.getByRole("group", { name: "Condition 1" })).getByRole("combobox", { name: "Tag group, condition 1" })).toBeInTheDocument();
    await waitFor(() => expect(region("Rules")).toHaveTextContent(/In plain words: Music tracks with Leitmotif any of Drowned Abbess/));
    expect(region("Matching tracks")).toHaveTextContent("4 tracks");
    expect(within(screen.getByRole("list", { name: "Matching tracks" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("any of to all of rewrites the words and narrows the matches", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = within(await screen.findByRole("region", { name: "Rules" }));
    await waitFor(() => expect(region("Matching tracks")).toHaveTextContent("4 tracks"));
    await userEvent.setup().selectOptions(rules.getByRole("combobox", { name: "How it matches, condition 2" }), "all of");
    await waitFor(() => expect(rules.getAllByText(/Mood all of Eerie, Dread/).length).toBeGreaterThan(0));
    expect(region("Matching tracks")).not.toHaveTextContent("4 tracks");
  });

  it("tags are added from a menu and removed with their X", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = within(await screen.findByRole("region", { name: "Rules" }));
    const user = userEvent.setup();
    await user.click(await rules.findByRole("button", { name: "Remove Dread" }));
    await waitFor(() => expect(rules.getAllByText(/Mood any of Eerie;/).length).toBeGreaterThan(0));
    await user.click(rules.getByRole("button", { name: "Add mood" }));
    await user.click(screen.getByRole("menuitem", { name: "Tense" }));
    await waitFor(() => expect(rules.getAllByText(/Mood any of Eerie, Tense/).length).toBeGreaterThan(0));
  });

  it("conditions are added and removed, stings left out, energy limited", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = within(await screen.findByRole("region", { name: "Rules" }));
    const user = userEvent.setup();
    await user.click(rules.getByRole("button", { name: "Add condition" }));
    expect(await rules.findByRole("group", { name: "Condition 3" })).toBeInTheDocument();
    await user.click(rules.getByRole("button", { name: "Remove condition 3" }));
    await waitFor(() => expect(rules.queryByRole("group", { name: "Condition 3" })).toBeNull());
    await user.click(rules.getByRole("checkbox", { name: "Leave out stings" }));
    await waitFor(() => expect(rules.getAllByText(/not stings/).length).toBeGreaterThan(0));
    await user.selectOptions(rules.getByRole("combobox", { name: "Highest energy" }), "1");
    await waitFor(() => expect(rules.getAllByText(/energy 0 to 1/).length).toBeGreaterThan(0));
  });

  it("Make a manual copy freezes the matches into a manual playlist", async () => {
    openAt("playlist/p-abbey-eerie");
    await waitFor(() => expect(region("Matching tracks")).toHaveTextContent("4 tracks"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Make a manual copy" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent(/Manual\s*·\s*Music/));
    await waitFor(() => expect(trackNames()).toHaveLength(4));
  });

  it("shows where it is used, with each scene's place in its list", async () => {
    openAt("playlist/p-abbey-eerie");
    await waitFor(() => expect(region("Used in")).toHaveTextContent("The abbey ruins"));
    expect(region("Used in")).toHaveTextContent("2 of 4");
  });

  it("passes axe", async () => {
    openAt("playlist/p-abbey-eerie");
    await waitFor(() => expect(region("Matching tracks")).toHaveTextContent("4 tracks"));
    await expectNoAxeViolations();
  });
});
