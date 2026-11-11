import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../../test/axe";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { dropNames, go, openAt } from "./testHarness";
import { expectPlayAirIcons } from "../../test/playAirIcon";

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
    expect(audio.calls).toContainEqual(["previewPlaylist", "p-company", { from: "Playlists" }]);
    act(() => audio.setNowPlaying({ preview: { key: "pl:p-company", label: "The Company themes" } }));
    expect(row.getByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await user.click(row.getByRole("button", { name: "Play on air: The Company themes" }));
    expect(audio.calls.some(([m, id]) => m === "playPlaylist" && id === "p-company")).toBe(true);
    await user.click(row.getByRole("button", { name: "More for The Company themes" }));
    const menu = screen.getByRole("menu", { name: "More for The Company themes" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open", "Use in…", "Move to folder…"]);
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
    expect(screen.getByRole("region", { name: "Now playing" })).toHaveTextContent("Epic choir hero anthem");
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

  it("UX-R8: Play on air shows the play triangle sounding out, in the header and on the rows", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    expectPlayAirIcons();
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
    // UX-R5: the Saved pop-up, as in the prototype ("Saved: <playlist> · added <track>").
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent(/^Saved: The Abbess · added Quiet grief/));
  });

  it("UX-R7: the Add tracks count is read out once typing pauses, not on every key", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const add = within(region("Add tracks"));
    const live = document.getElementById("lyre-live")!;
    const heard: string[] = [];
    const watch = new MutationObserver(() => live.textContent && heard.push(live.textContent));
    watch.observe(live, { childList: true, characterData: true, subtree: true });
    await userEvent.setup().type(add.getByRole("searchbox", { name: "Search the library by any name or tag" }), "abbey");
    expect(add.getByText(/\d+ match/).closest("[aria-live]")).toBeNull();
    await waitFor(() => expect(heard.some((h) => /^\d+ match(es)?$/.test(h))).toBe(true), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 700));
    watch.disconnect();
    expect(heard.filter((h) => /match/.test(h))).toHaveLength(1);
  });

  it("UX-R3 (round 6 cuts): a manual playlist's boxes say each fact once, and how-tos are hover text or read out", async () => {
    openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const head = (name: string) => screen.getByRole("region", { name }).querySelector("header")!;
    // Add tracks' search box says what to type.
    expect(head("Add tracks")).not.toHaveTextContent("Search the library, or drop files here");
    // The kind and lane are in the page header, not again in Details.
    expect(screen.getByRole("region", { name: "Details" }).querySelector(".pl-facts")).toBeNull();
    // Used in: the levels are its description and Use in…'s hover text.
    const used = screen.getByRole("region", { name: "Used in" });
    expect(used.querySelector(".pane-body")).not.toHaveTextContent("Campaign: every session");
    expect(used).toHaveAccessibleDescription(/^Campaign: every session\. Session: that evening\./);
    // The reorder how-to shows only while the keyboard is in the list.
    expect(screen.getByText("Drag rows, or press Alt+Up / Alt+Down, to change the order.")).toHaveClass("keys-on-focus");
  });

  it("UX-R3 (round 6 cuts): a dynamic playlist's Rules say the rule once, with Any shape and Energy 0 as hover text", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = await screen.findByRole("region", { name: "Rules" });
    expect(rules.querySelector(".pane-summary")).toBeEmptyDOMElement();
    expect(rules).toHaveTextContent("In plain words:");
    expect(rules).not.toHaveTextContent("Any shape");
    expect(within(rules).getByRole("group", { name: "Shape: how the track moves" })).toHaveAttribute("title", "None pressed: any shape");
    expect(within(rules).getByText("Energy 0 means a track with no energy set.")).toHaveClass("sr-only");
    expect(within(rules).getByRole("combobox", { name: "Lowest energy" })).toHaveAccessibleDescription("Energy 0 means a track with no energy set.");
  });

  it("UX-R3 (round 6 cuts): the list of playlists says how to drop files in its hover text, not in its header", async () => {
    openAt("playlists");
    const list = await screen.findByRole("list", { name: "Playlists" });
    expect(screen.getByRole("region", { name: "All playlists" }).querySelector("header")).not.toHaveTextContent("Drop audio files");
    expect(list).toHaveAttribute("title", "Drop audio files on a row to add them");
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

  it("says what energy 0 means beside the energy limits (w3-ux 18)", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = within(await screen.findByRole("region", { name: "Rules" }));
    expect(rules.getByText("Energy 0 means a track with no energy set.")).toBeInTheDocument();
    expect(rules.getByRole("combobox", { name: "Lowest energy" })).toHaveAccessibleDescription("Energy 0 means a track with no energy set.");
    expect(rules.getByRole("combobox", { name: "Highest energy" })).toHaveAccessibleDescription("Energy 0 means a track with no energy set.");
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

describe("Playlists: round 5", () => {
  it("PLY-13: every row shows its own play order, and its menu changes it", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    expect(await within(rowOf("Combat: big and loopable")).findByRole("button", { name: "Play order of Combat: big and loopable: Shuffle, repeat all" })).toBeInTheDocument();
    const order = within(rowOf("The Company themes")).getByRole("button", { name: /^Play order of The Company themes: / });
    expect(order).toHaveAccessibleName("Play order of The Company themes: In order, repeat all");
    const user = userEvent.setup();
    await user.click(order);
    const menu = screen.getByRole("menu", { name: "Play order" });
    expect(menu).toHaveTextContent("Play order of this playlist");
    await user.click(within(menu).getByRole("menuitemradio", { name: /^No repeat/ }));
    await waitFor(() => expect(order).toHaveAccessibleName("Play order of The Company themes: In order, no repeat"));
  });

  it("PLY-13: a playlist's page has its play order beside Play on air", async () => {
    openAt("playlist/p-abbess");
    const user = userEvent.setup();
    const order = await screen.findByRole("button", { name: /^Play order of The Abbess: / });
    expect(order.previousElementSibling).toHaveTextContent("Play on air");
    await user.click(order);
    await user.click(screen.getByRole("menuitemradio", { name: /^Repeat one/ }));
    expect(await screen.findByRole("button", { name: "Play order of The Abbess: In order, repeat one" })).toBeInTheDocument();
  });

  it("EDT-8: a dynamic playlist's Details sit folded at the top of the main column, with the rules; Used in is on the side", async () => {
    openAt("playlist/p-abbey-eerie");
    const rules = await screen.findByRole("region", { name: "Rules" });
    const details = region("Details");
    expect(details.parentElement).toBe(rules.parentElement);
    expect(details.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region("Used in").parentElement).not.toBe(rules.parentElement);
    const toggle = within(details).getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(toggle);
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Abbey: eerie, low energy");
  });

  it("EDT-8: a manual playlist keeps Details on the side, open", async () => {
    openAt("playlist/p-abbess");
    const used = await screen.findByRole("region", { name: "Used in" });
    expect(region("Details").parentElement).toBe(used.parentElement);
    expect(within(region("Details")).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  });

  it("DAT-13: a dynamic playlist's rules can ask for shapes; none pressed means any shape", async () => {
    const { api } = openAt("playlist/p-gothic");
    const shapes = await screen.findByRole("group", { name: "Shape: how the track moves" });
    expect(within(shapes).getAllByRole("button").map((b) => b.textContent)).toEqual(["Steady", "Builds", "Falls away", "Peaks then falls", "Rises and falls"]);
    // UX-R3: "Any shape" is the group's hover text, not a word on screen.
    expect(shapes).toHaveAttribute("title", "None pressed: any shape");
    const matches = () => within(screen.getByRole("list", { name: "Matching tracks" })).getAllByRole("listitem").length;
    await waitFor(() => expect(matches()).toBeGreaterThan(0));
    const before = matches();
    const user = userEvent.setup();
    await user.click(within(shapes).getByRole("button", { name: "Builds" }));
    await waitFor(() => expect(within(shapes).getByRole("button", { name: "Builds" })).toHaveAttribute("aria-pressed", "true"));
    expect(region("Rules")).toHaveTextContent("shape builds");
    await waitFor(() => expect(matches()).toBeLessThan(before));
    const saved = (await api.playlists.list()).find((p) => p.id === "p-gothic");
    expect(saved?.kind === "dynamic" && saved.rule.shapes).toEqual(["builds"]);
    // Another rule change keeps the shapes.
    await user.click(within(region("Rules")).getByRole("checkbox", { name: "Leave out stings" }));
    await waitFor(async () => {
      const p = (await api.playlists.list()).find((x) => x.id === "p-gothic");
      expect(p?.kind === "dynamic" && [p.rule.shapes, p.rule.leaveOutStings]).toEqual([["builds"], true]);
    });
  });

  it("ORG-12 and ORG-11: a track row shows its tags, and its menu has Use in…", async () => {
    openAt("playlist/p-abbess");
    const first = (await within(await screen.findByRole("list", { name: "Tracks in order" })).findAllByRole("listitem"))[0];
    expect(within(first).getByText(/^Tags: /)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(first).getByRole("button", { name: /^More for / }));
    await user.click(screen.getByRole("menuitem", { name: "Use in…" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: /^Use ".+" in…$/ })).toBeInTheDocument();
  });

  it("ORG-11: a row's contents show each track's tags", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    await userEvent.setup().click(screen.getByRole("button", { name: "Show contents of The Company themes" }));
    const items = within(screen.getByRole("list", { name: "Tracks in The Company themes" })).getAllByRole("listitem");
    expect(within(items[0]).getByText(/^Tags: /)).toBeInTheDocument();
  });

  it("UX-16: a playlist row and its page say On air while it plays, and a track row Only you while it is previewed", async () => {
    const { audio } = openAt("playlists");
    await screen.findByText("21 playlists");
    const lane = { trackId: "t24", title: "x", origin: { kind: "playlist" as const, playlistId: "p-company", at: 0 }, playlistId: "p-company", position: 0, length: 100, paused: false, loading: false };
    act(() => audio.setNowPlaying({ rooms: [{ roomId: "table", name: "Table", music: lane, ambience: null, upNext: null, queued: [], effects: [] }] }));
    expect(within(rowOf("The Company themes")).getByText("On air")).toBeInTheDocument();
    go("playlist/p-abbess");
    const first = (await within(await screen.findByRole("list", { name: "Tracks in order" })).findAllByRole("listitem"))[0];
    act(() => audio.setNowPlaying({ rooms: [], preview: { key: first.dataset.tid as string, label: "x" } }));
    expect(within(first).getByText("Only you")).toBeInTheDocument();
  });
});

describe("Playlists: volume normalisation (PLY-15)", () => {
  it("a playlist's Details choose Normalise volume after the name and before Notes; a track's own choice comes first", async () => {
    const { api } = openAt("playlist/p-ashen");
    const details = await screen.findByRole("region", { name: "Details" });
    const norm = await within(details).findByRole("group", { name: "Normalise volume" });
    expect(within(norm).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(norm).toHaveAccessibleDescription("Its tracks get -2.2 dB to +2.7 dB here; 1 plays as it is"));
    expect(within(details).getByTitle("A track's own choice still comes first.")).toBeInTheDocument();
    // UX-R3: no kind line in Details (the page header shows it), so Normalise follows the name.
    const facts = within(details).getByRole("textbox", { name: "Name" });
    const notes = within(details).getByRole("textbox", { name: "Notes" });
    expect(facts.compareDocumentPosition(norm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(norm.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.setup().click(within(norm).getByRole("button", { name: "Library setting" }));
    await waitFor(() => expect(norm).toHaveAccessibleDescription("Its tracks play as they are"));
    expect((await api.playlists.list()).find((p) => p.id === "p-ashen")?.normalise).toBeNull();
  });

  it("a track previewed from a playlist's page plays with that playlist's choice", async () => {
    const { audio } = openAt("playlist/p-abbess");
    const first = (await within(await screen.findByRole("list", { name: "Tracks in order" })).findAllByRole("listitem"))[0];
    await userEvent.setup().click(within(first).getByRole("button", { name: /^Preview / }));
    expect(audio.calls.find(([m]) => m === "previewTrack")?.[2]).toMatchObject({ playlistId: "p-abbess" });
  });
});

describe("round 7: folders (ORG-4, r7org.js)", () => {
  it("Move to folder… › New folder… makes a folder holding the playlist; folding hides it; deleting moves it up a level", async () => {
    const user = userEvent.setup();
    openAt("playlists");
    await user.click(await screen.findByRole("button", { name: "More for The Abbess" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "New folder…" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "The abbey");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add folder" }));
    const inside = await screen.findByRole("list", { name: "In The abbey" });
    expect(within(inside).getByRole("link", { name: /^The Abbess\b/ })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /^Folder The abbey/ });
    expect(toggle).toHaveAccessibleName("Folder The abbey, 1 playlist");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /^The Abbess\b/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "More for the folder The abbey" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    expect(await screen.findByRole("link", { name: /^The Abbess\b/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Folder The abbey/ })).toBeNull();
  });
});

describe("round 7: dividers inside a playlist (ORG-4)", () => {
  it("a divider goes above a track, names a section, and is not a track", async () => {
    const { api } = openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const user = userEvent.setup();
    const ordered = () => within(screen.getByRole("list", { name: "Tracks in order" }));
    await user.click(ordered().getByRole("button", { name: /^More for Lullaby, sad/ }));
    await user.click(screen.getByRole("menuitem", { name: "Add a divider above" }));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Name" }), "After the font");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add divider" }));
    await waitFor(() => expect(ordered().getAllByRole("listitem")[3]).toHaveAccessibleName("Divider: After the font"));
    expect(ordered().getAllByRole("listitem")[4]).toHaveTextContent("Lullaby, sad");
    expect(screen.getByRole("region", { name: "Tracks" })).toHaveAccessibleDescription(/5 tracks/);
    expect((await api.playlists.list()).find((p) => p.id === "p-abbess")?.dividers).toEqual([expect.objectContaining({ name: "After the font", at: 3 })]);
  });
});

describe("round 7: adding to other lists (ORG-5)", () => {
  it("Add to… puts a track in a scene of the next session, with the Saved pop-up naming the place", async () => {
    const { api } = openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("list", { name: "Tracks in order" })).getByRole("button", { name: /^More for Alien, unknowable/ }));
    await user.click(screen.getByRole("menuitem", { name: "Add to…" }));
    const d = within(screen.getByRole("dialog", { name: /^Add .* to$/ }));
    expect(d.getByRole("radio", { name: "Up next in Table" })).toBeInTheDocument();
    await user.click(d.getByRole("radio", { name: "Session 14 › The abbey ruins" }));
    await user.click(d.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent(/^Saved: The abbey ruins music · Alien, unknowable/));
    const crown = (await api.campaigns.list()).find((c) => c.id === "crown")!;
    const sc3 = crown.sessions.find((s) => s.id === "s14")!.scenes.find((x) => x.id === "sc3")!;
    const alien = (await api.library.listTracks()).find((t) => (t.title || t.metaTitle).startsWith("Alien, unknowable"))!;
    expect(sc3.music).toContainEqual({ kind: "track", id: alien.id });
  });

  it("Add to… with Move it out of… moves a track to another playlist", async () => {
    const { api } = openAt("playlist/p-abbess");
    await waitFor(() => expect(trackNames()).toHaveLength(5));
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("list", { name: "Tracks in order" })).getByRole("button", { name: /^More for Alien, unknowable/ }));
    await user.click(screen.getByRole("menuitem", { name: "Add to…" }));
    const d = within(screen.getByRole("dialog"));
    await user.click(d.getByRole("radio", { name: "Ashen King" }));
    await user.click(d.getByRole("switch", { name: "Move it out of The Abbess" }));
    await user.click(d.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent(/Moved to Ashen King/));
    await waitFor(() => expect(trackNames()).toHaveLength(4));
    expect(((await api.playlists.list()).find((p) => p.id === "p-ashen") as { trackIds?: string[] } | undefined)?.trackIds?.length).toBeGreaterThan(0);
  });
});
