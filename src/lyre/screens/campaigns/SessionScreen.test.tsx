/** The session planner (e2e/specs/session-planner.spec.ts; prototype views/campaigns.js part 3). */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignInfo, SessionInfo } from "../../../common/lyre/api";
import type { FakeLyreApi } from "../../../common/lyre/fake";
import { getLiveSession, loadInLive } from "../../kit/liveSession";
import { expectNoAxeViolations } from "../../test/axe";
import { go, main, openAt, region } from "./testing";

vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  loadInLive(null);
});

const scenesList = () => screen.getByRole("list", { name: "Scenes in order" });
/** The scene cards (not the rows inside an open scene). */
const sceneCards = () => Array.from(scenesList().children) as HTMLElement[];
const abbey = () => within(screen.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ }));
const musicNames = () =>
  within(abbey().getByRole("list", { name: "Music in order" }))
    .getAllByRole("listitem")
    .map((li) => (li.querySelector("a")?.textContent ?? "").replace(/\s*\((Track|Playlist|FX)[^)]*\)$/, ""));
const boardNames = () =>
  within(abbey().getByRole("list", { name: "Pad boards in order" }))
    .getAllByRole("listitem")
    .map((li) => (li.querySelector("a")?.textContent ?? "").replace(/\s*\(Pad board\)$/, ""));
const crown = async (api: FakeLyreApi) => (await api.campaigns.get("crown")) as CampaignInfo;
const s14 = async (api: FakeLyreApi) => (await crown(api)).sessions.find((s) => s.id === "s14") as SessionInfo;

async function openAbbey() {
  const opened = openAt("session/crown/s14");
  await userEvent.click(await screen.findByRole("button", { name: "Scene 3: The abbey ruins" }));
  return opened;
}

describe("the session page", () => {
  it("lists the scenes in order, each folded with its first music and a count of the rest", async () => {
    openAt("session/crown/s14");
    await screen.findByRole("list", { name: "Scenes in order" });
    expect(main().getByRole("heading", { level: 1, name: "Session 14: The Drowned Abbey" })).toBeInTheDocument();
    expect(main().getByText("Next", { selector: ".cp-status" })).toBeInTheDocument();
    const cards = sceneCards();
    expect(cards).toHaveLength(6);
    expect(cards[1]).toHaveAccessibleName("Scene 2: Greyhollow inn");
    expect(cards[2]).toHaveTextContent("+3 more");
    expect(within(cards[2]).getByRole("link", { name: "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scene 1: Recap and the coast road" })).toHaveAttribute("aria-expanded", "false");
    await expectNoAxeViolations();
  });

  it("Run this session and the Live side of the switch load this session in Live", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Run this session" }));
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s14" });
    expect(window.location.hash).toBe("#/live");
    loadInLive(null);
    go("session/crown/s15");
    await userEvent.click(await screen.findByRole("button", { name: "Live" }));
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s15" });
  });

  it("name, date and status are editable; making a session Next leaves one Next", async () => {
    const { api } = openAt("session/crown/s15");
    const name = await screen.findByRole("textbox", { name: "Session name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Black sails at dawn");
    expect(await screen.findByRole("heading", { level: 1, name: "Session 15: Black sails at dawn" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-26" } });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Next");
    await waitFor(async () => expect((await crown(api)).sessions.map((s) => s.status)).toEqual(["played", "played", "played", "next"]));
    expect((await crown(api)).sessions[3]).toMatchObject({ name: "Black sails at dawn", date: "2026-11-26" });
    expect(await screen.findByText("Session 15 is now Next")).toBeInTheDocument();
  });

  it("session playlists and campaign playlists are listed for the evening, closed, with Preview and Play on air", async () => {
    openAt("session/crown/s14");
    const session = within(await screen.findByRole("region", { name: "Session playlists" }));
    await session.findByRole("link", { name: "Wistful with some warmth" });
    expect(session.queryByRole("list", { name: "Tracks in Wistful with some warmth" })).not.toBeInTheDocument();
    await userEvent.click(session.getByRole("button", { name: "Show contents of Wistful with some warmth" }));
    expect(session.getByRole("list", { name: "Tracks in Wistful with some warmth" })).toBeInTheDocument();
    expect(session.getByRole("button", { name: "Preview Wistful with some warmth" })).toBeInTheDocument();
    expect(session.getByRole("button", { name: "Play on air: Wistful with some warmth" })).toBeInTheDocument();
    const reminder = region("Campaign playlists");
    expect(reminder.getByRole("link", { name: "The Company themes" })).toBeInTheDocument();
    expect(reminder.queryByRole("button", { name: /^More for/ })).not.toBeInTheDocument();
    expect(reminder.getByText("Campaign pad boards: Combat, Weather and places.")).toBeInTheDocument();
  });
});

describe("a scene's music", () => {
  it("shows tracks and playlists in play order, the first starting the scene, with own settings marked", async () => {
    await openAbbey();
    expect(musicNames()).toEqual([
      "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)",
      "Abbey: eerie, low energy",
      "Haunted sea shanty, grey and slow - the drowned bells",
      "The Abbess",
    ]);
    const rows = within(abbey().getByRole("list", { name: "Music in order" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Starts the scene");
    expect(rows[0]).toHaveTextContent("Own audio settings in this scene");
    expect(rows[1]).toHaveTextContent("Playlist · Dynamic");
    expect(rows[2]).toHaveTextContent("(Track)");
    await expectNoAxeViolations();
  });

  it("moves an item up, makes one start the scene and removes one from its menu", async () => {
    const { api } = await openAbbey();
    await userEvent.click(abbey().getByRole("button", { name: "More for The Abbess" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    await waitFor(() => expect(musicNames().slice(2)).toEqual(["The Abbess", "Haunted sea shanty, grey and slow - the drowned bells"]));
    expect(await screen.findByText("The Abbess moved to position 3 of 4")).toBeInTheDocument();
    await userEvent.click(abbey().getByRole("button", { name: "More for The Abbess" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Start the scene with it" }));
    await waitFor(() => expect(musicNames()[0]).toBe("The Abbess"));
    await userEvent.click(abbey().getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this scene" }));
    await waitFor(() => expect(musicNames()).toHaveLength(3));
    expect((await s14(api)).scenes[2].music.map((m) => m.id)).toEqual(["p-abbess", "t13", "p-abbey-eerie"]);
  });

  it("a playlist in the scene opens to show its tracks", async () => {
    await openAbbey();
    const list = within(abbey().getByRole("list", { name: "Music in order" }));
    await userEvent.click(list.getByRole("button", { name: "Show contents of The Abbess" }));
    expect(within(list.getByRole("list", { name: "Tracks in The Abbess" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("Add tracks or playlists… adds ticked items in the order ticked; the picker filters and searches", async () => {
    const { api } = await openAbbey();
    await userEvent.click(abbey().getByRole("button", { name: "Add tracks or playlists…" }));
    const sheet = within(screen.getByRole("dialog", { name: 'Music for "The abbey ruins"' }));
    const show = within(sheet.getByRole("group", { name: "Show" }));
    expect(show.getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Playlists", "Tracks", "FX"]);
    await userEvent.click(show.getByRole("button", { name: "Tracks" }));
    expect(sheet.queryByRole("checkbox", { name: /^Coast road travel/ })).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("checkbox", { name: /^Quiet grief, solo voice/ }));
    await userEvent.click(show.getByRole("button", { name: "Playlists" }));
    expect(sheet.getByRole("button", { name: "Preview Coast road travel" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("checkbox", { name: /^Coast road travel/ }));
    await userEvent.type(sheet.getByRole("searchbox", { name: "Search the list" }), "Aftermath");
    expect(sheet.queryByRole("checkbox", { name: /^Coast road travel/ })).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(musicNames()).toHaveLength(6));
    expect(musicNames().slice(-2)).toEqual(["Quiet grief, solo voice - a fallen companion", "Coast road travel"]);
    const grief = (await api.library.listTracks()).find((t) => t.title.startsWith("Quiet grief"));
    expect((await s14(api)).scenes[2].music.slice(-2)).toEqual([
      { kind: "track", id: grief?.id },
      { kind: "playlist", id: "p-coast" },
    ]);
  });

  it("Cancel in the picker changes nothing", async () => {
    await openAbbey();
    await userEvent.click(abbey().getByRole("button", { name: "Add tracks or playlists…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: /^Coast road travel/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(musicNames()).toHaveLength(4);
  });

  it("audio files dropped on the music are added to the Library and placed in the scene; other files are left out", async () => {
    const { api } = await openAbbey();
    const box = abbey().getByRole("group", { name: "Music" }).querySelector(".cp-box") as HTMLElement;
    const files = ["01 New theme.flac", "notes.txt", "02 Second.mp3"].map((n) => new File(["x"], n));
    const dataTransfer = { types: ["Files"], files, dropEffect: "none" };
    expect(fireEvent.dragOver(box, { dataTransfer })).toBe(false);
    fireEvent.drop(box, { dataTransfer, clientY: 99999 });
    await waitFor(() => expect(musicNames()).toHaveLength(6));
    expect(musicNames().slice(-2)).toEqual(["New theme", "Second"]);
    expect(await screen.findByText(/^2 new tracks added to the Library\. 2 tracks placed in the music of "The abbey ruins" at position 5\.$/)).toBeInTheDocument();
    expect((await api.library.listTracks()).filter((t) => /New theme|Second/.test(t.metaTitle))).toHaveLength(2);
  });

  it("a drag that carries no files is left alone", async () => {
    await openAbbey();
    const box = abbey().getByRole("group", { name: "Music" }).querySelector(".cp-box") as HTMLElement;
    expect(fireEvent.dragOver(box, { dataTransfer: { types: ["text/plain"] } })).toBe(true);
  });
});

describe("a scene's ambience and pad boards", () => {
  it("ambience is changed through a picker of ambience tracks and playlists", async () => {
    const { api } = await openAbbey();
    const ambience = within(abbey().getByRole("group", { name: "Ambience" }));
    expect(ambience.getByRole("link", { name: "Abbey ambience" })).toBeInTheDocument();
    expect(ambience.getByRole("button", { name: "Preview Abbey ambience" })).toBeInTheDocument();
    expect(ambience.getByRole("button", { name: "Play on air: Abbey ambience" })).toBeInTheDocument();
    await userEvent.click(ambience.getByRole("button", { name: "Change…" }));
    const sheet = within(screen.getByRole("dialog", { name: 'Ambience for "The abbey ruins"' }));
    expect(sheet.getByRole("radio", { name: /^Abbey ambience/ })).toBeChecked();
    await userEvent.click(sheet.getByRole("button", { name: "Show contents of Inn and hearth" }));
    expect(sheet.getByRole("list", { name: "Tracks in Inn and hearth" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("radio", { name: /^Wind over open moor, gusting/ }));
    await userEvent.click(sheet.getByRole("button", { name: "Done" }));
    expect(await ambience.findByRole("link", { name: /Wind over open moor, gusting/ })).toBeInTheDocument();
    expect((await s14(api)).scenes[2].ambience?.id).toMatch(/^b/);
    await userEvent.click(ambience.getByRole("button", { name: /^More for Wind over open moor/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this scene" }));
    expect(await ambience.findByText("No ambience")).toBeInTheDocument();
  });

  it("a scene has several pad boards in order, the first shown first; more are added and reordered", async () => {
    const { api } = await openAbbey();
    expect(boardNames()).toEqual(["Drowned Abbey", "Weather and places"]);
    const group = within(abbey().getByRole("group", { name: "Pad boards" }));
    expect(group.getByRole("button", { name: "Preview the first pad of Drowned Abbey" })).toBeInTheDocument();
    await userEvent.click(group.getByRole("button", { name: "Add pad boards…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: /^Combat/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(boardNames()).toEqual(["Drowned Abbey", "Weather and places", "Combat"]));
    await userEvent.click(group.getByRole("button", { name: "More for Drowned Abbey" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(boardNames()).toEqual(["Weather and places", "Drowned Abbey", "Combat"]));
    expect(within(abbey().getByRole("list", { name: "Pad boards in order" })).getAllByRole("listitem")[0]).toHaveTextContent("Shown first");
    expect((await s14(api)).scenes[2].boardIds).toEqual(["weather", "abbey", "combat"]);
  });
});

describe("scenes", () => {
  it("an open scene shows its name, Starts when and notes; a new name renames the card", async () => {
    await openAbbey();
    expect(abbey().getByRole("textbox", { name: "Starts when" })).toHaveValue("They crest the cliff path");
    expect(abbey().getByRole("textbox", { name: "Notes" })).toHaveValue("Rain all the way. Bells ring if anyone touches the altar.");
    const name = abbey().getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "The abbey in the rain");
    expect(await screen.findByRole("listitem", { name: "Scene 3: The abbey in the rain" })).toBeInTheDocument();
  });

  it("moves down from its menu", async () => {
    const { api } = openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "More for The abbey ruins" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(sceneCards()[3]).toHaveAccessibleName("Scene 4: The abbey ruins"));
    expect(sceneCards()[2]).toHaveAccessibleName("Scene 3: Crypt ambush");
    expect((await s14(api)).scenes.map((s) => s.id)).toEqual(["sc1", "sc2", "sc4", "sc3", "sc5", "sc6"]);
  });

  it("Add scene adds a scene after the one last worked on and puts the cursor in its name", async () => {
    const { api } = await openAbbey();
    await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    const field = screen.getByDisplayValue("New scene");
    expect(field).toHaveFocus();
    await userEvent.keyboard("Bells at midnight");
    expect(await screen.findByRole("listitem", { name: "Scene 4: Bells at midnight" })).toBeInTheDocument();
    await waitFor(async () => expect((await s14(api)).scenes[3].name).toBe("Bells at midnight"));
  });

  it("duplicates a scene after itself", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "More for The Abbess" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    expect(sceneCards()[5]).toHaveAccessibleName("Scene 6: The Abbess (copy)");
  });

  it("deleting asks first; Keep it changes nothing; Delete scene deletes it", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "More for Aftermath" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const sheet = screen.getByRole("dialog", { name: "Delete this scene?" });
    expect(sheet).toHaveTextContent("Delete scene 6, Aftermath, and its notes? Its tracks, playlists and pad boards stay in your library.");
    await userEvent.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(sceneCards()).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "More for Aftermath" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(5));
    expect(await screen.findByText('Deleted scene "Aftermath"')).toBeInTheDocument();
  });

  it("Open all scenes opens every scene, and folds them again", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Open all scenes" }));
    expect(screen.getAllByRole("list", { name: "Music in order" })).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "Fold all scenes" }));
    expect(screen.queryByRole("list", { name: "Music in order" })).not.toBeInTheDocument();
  });

  it("an unknown session says so with a way back", async () => {
    openAt("session/crown/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Session not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Campaigns" })).toHaveAttribute("href", "#/campaigns");
  });
});
