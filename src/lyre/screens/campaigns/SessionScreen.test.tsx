/** The session planner (e2e/specs/session-planner.spec.ts; prototype views/campaigns.js part 3). */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { CampaignInfo, SessionInfo } from "../../../common/lyre/api";
import { createFakeLyreApi, type FakeLyreApi } from "../../../common/lyre/fake";
import { getLiveSession, loadInLive } from "../../kit/liveSession";
import { expectNoAxeViolations } from "../../test/axe";
import { dragFirstOntoLowerHalfOfLast, go, main, openAt, region } from "./testing";

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
    expect(session.queryByRole("list", { name: /^Tracks in Wistful with some warmth(,|$)/ })).not.toBeInTheDocument();
    await userEvent.click(session.getByRole("button", { name: "Show contents of Wistful with some warmth" }));
    expect(session.getByRole("list", { name: /^Tracks in Wistful with some warmth(,|$)/ })).toBeInTheDocument();
    expect(session.getByRole("button", { name: "Preview Wistful with some warmth" })).toBeInTheDocument();
    expect(session.getByRole("button", { name: "Play on air: Wistful with some warmth" })).toBeInTheDocument();
    const reminder = region("Campaign playlists");
    expect(reminder.getByRole("link", { name: "The Company themes" })).toBeInTheDocument();
    expect(reminder.queryByRole("button", { name: /^More for/ })).not.toBeInTheDocument();
    expect(reminder.getByText("Campaign pads: Combat, Weather and places.")).toBeInTheDocument();
    // UX-R3 (round 6 rule 8): Change sits where the other boxes have Add, as an icon link; no line, no open counts.
    expect(reminder.queryByText(/From the campaign/)).toBeNull();
    expect(reminder.getByRole("link", { name: "Change the campaign's playlists" })).toHaveAttribute("href", "#/campaign/crown");
    for (const box of ["Session playlists", "Session pads", "Campaign playlists"]) expect(screen.getByRole("region", { name: box }).querySelector("header")!.textContent).not.toMatch(/\d/);
  });

  it("UX-18: comes back from Back drawn whole, its rows' tags too, so the scenes box is as tall as when it was left", async () => {
    await openAbbey();
    expect(await abbey().findByText(/^Tags: Eerie, Dread/)).toBeInTheDocument();
    go("playlists");
    await screen.findByRole("heading", { level: 1, name: /Playlists/ });
    // The first drawing of the scenes, as Back's scroll position is put back on it.
    let first: string | null = null;
    const watch = new MutationObserver(() => {
      first ??= document.querySelector('#view [aria-label="Scenes in order"]')?.textContent ?? null;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      await userEvent.click(main().getAllByRole("button", { name: /^Back to/ })[0]);
      await screen.findByRole("list", { name: "Scenes in order" });
    } finally {
      watch.disconnect();
    }
    expect(first).toMatch(/Tags: Eerie, Dread/);
  });

  it("UX-R3 (round 6 cuts): the how-to lines under a scene's music and pad boards are the buttons' hover text", async () => {
    await openAbbey();
    const scene = screen.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ });
    expect(scene).not.toHaveTextContent("Plays in order, then loops");
    expect(scene).not.toHaveTextContent("The first is shown when the scene starts");
    expect(within(scene).getByRole("button", { name: "Add tracks or playlists…" })).toHaveAttribute("title", "Plays in order; drop audio files on the box to add them");
    expect(within(scene).getByRole("button", { name: /^Add pad boards… to / })).toHaveAttribute("title", "The first board shows when the scene starts");
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

  it("a change shows at once while the library saves it, and goes back when the library refuses it", async () => {
    const api = createFakeLyreApi();
    let release: (answer: Awaited<ReturnType<typeof api.sessions.setSceneMusic>>) => void = () => undefined;
    api.sessions.setSceneMusic = () => new Promise((resolve) => (release = resolve));
    openAt("session/crown/s14", { api });
    await userEvent.click(await screen.findByRole("button", { name: "Scene 3: The abbey ruins" }));
    await userEvent.click(abbey().getByRole("button", { name: "More for The Abbess" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Start the scene with it" }));
    expect(musicNames()[0]).toBe("The Abbess");
    await act(async () => release({ ok: false, refusal: { code: "not-found", message: "That scene no longer exists." } }));
    await waitFor(() => expect(musicNames()[0]).toBe("Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)"));
    expect(screen.getByText("That scene no longer exists.")).toBeInTheDocument();
  });

  it("a playlist in the scene opens to show its tracks", async () => {
    await openAbbey();
    const list = within(abbey().getByRole("list", { name: "Music in order" }));
    await userEvent.click(list.getByRole("button", { name: "Show contents of The Abbess" }));
    expect(within(list.getByRole("list", { name: /^Tracks in The Abbess(,|$)/ })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("0.5.1: each track of a playlist in the scene has Play on air beside its Preview, as the playlist has", async () => {
    const { audio } = await openAbbey();
    const list = within(abbey().getByRole("list", { name: "Music in order" }));
    expect(list.getByRole("button", { name: "Play on air: The Abbess" })).toBeInTheDocument();
    await userEvent.click(list.getByRole("button", { name: "Show contents of The Abbess" }));
    const rows = within(list.getByRole("list", { name: /^Tracks in The Abbess(,|$)/ })).getAllByRole("listitem");
    for (const row of rows) expect(within(row).getByRole("button", { name: /^Play on air: / })).toBeInTheDocument();
    const first = within(rows[0]).getByRole("button", { name: /^Play on air: / });
    const preview = within(rows[0]).getByRole("button", { name: /^Preview / });
    expect(preview.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first.querySelector("svg")?.outerHTML).toBe(list.getByRole("button", { name: "Play on air: The Abbess" }).querySelector("svg")?.outerHTML);
    await userEvent.click(first);
    expect(audio.calls.filter(([m]) => m === "playTrack")).toHaveLength(1);
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
    expect(sheet.getByRole("list", { name: /^Tracks in Inn and hearth(,|$)/ })).toBeInTheDocument();
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
    // Named for its scene, so it differs from the session's own Add pad boards… (w3-ux 14).
    await userEvent.click(group.getByRole("button", { name: /^Add pad boards… to / }));
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

  it("moves down into the last place from its menu, and the last scene has no Move down (Nik, 0.5.0)", async () => {
    const { api } = openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "More for The Abbess" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(async () => expect((await s14(api)).scenes.map((s) => s.id)).toEqual(["sc1", "sc2", "sc3", "sc4", "sc6", "sc5"]));
    await waitFor(() => expect(sceneCards()[5]).toHaveAccessibleName("Scene 6: The Abbess"));
    await userEvent.click(screen.getByRole("button", { name: "More for The Abbess" }));
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Move down" })).toBeNull();
  });

  it("a scene dragged by its handle below the last one, in the rest of the box, goes last (Nik, 0.5.0)", async () => {
    const { api } = openAt("session/crown/s14");
    await waitFor(() => expect(sceneCards()).toHaveLength(6));
    // jsdom has no layout: each scene card 40 px high from the top of its box, the box 600 px high.
    const cards = sceneCards();
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const i = cards.indexOf(this as HTMLElement);
      const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      if (i >= 0) return box(100 + i * 46, 40);
      if (this.classList.contains("pane-body")) return box(90, 600);
      return original.call(this);
    };
    try {
      const first = cards[0];
      fireEvent.pointerDown(first.querySelector("[title='Drag to reorder']")!);
      fireEvent.dragStart(first, { dataTransfer: { effectAllowed: "", types: ["text/plain"], setData: (): void => undefined } });
      const paneBody = first.closest(".pane-body")!;
      const at = (type: string) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 500 });
        Object.defineProperty(event, "dataTransfer", { value: { types: ["text/plain"], files: [], dropEffect: "" } });
        fireEvent(paneBody, event);
      };
      at("dragover");
      at("drop");
      await waitFor(async () => expect((await s14(api)).scenes.map((s) => s.id)).toEqual(["sc2", "sc3", "sc4", "sc5", "sc6", "sc1"]));
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("a scene dropped on the lower half of the last scene goes last, with the line after it, when the box ends right under it", async () => {
    const { api } = openAt("session/crown/s14");
    await waitFor(() => expect(sceneCards()).toHaveLength(6));
    const cards = sceneCards();
    dragFirstOntoLowerHalfOfLast(cards, () => expect(cards[5]).toHaveClass("cp-drop-after"));
    await waitFor(async () => expect((await s14(api)).scenes.map((s) => s.id)).toEqual(["sc2", "sc3", "sc4", "sc5", "sc6", "sc1"]));
  });

  it("Add scene adds a scene after the one last worked on and puts the cursor in its name", async () => {
    const { api } = await openAbbey();
    await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    const field = screen.getByDisplayValue("Scene 4");
    expect(field).toHaveFocus();
    await userEvent.keyboard("Bells at midnight");
    expect(await screen.findByRole("listitem", { name: "Scene 4: Bells at midnight" })).toBeInTheDocument();
    await waitFor(async () => expect((await s14(api)).scenes[3].name).toBe("Bells at midnight"));
  });

  it("0.5.1: with no scene open or focused, Add scene adds at the end", async () => {
    const { api } = openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    expect(sceneCards()[6]).toHaveAccessibleName("Scene 7: Scene 7");
    expect(screen.getByDisplayValue("Scene 7")).toHaveFocus();
    await waitFor(async () => expect((await s14(api)).scenes).toHaveLength(7));
    expect((await s14(api)).scenes.slice(0, 6).map((x) => x.id)).toEqual(["sc1", "sc2", "sc3", "sc4", "sc5", "sc6"]);
  });

  it("0.5.1: with a scene focused (folded), Add scene adds right after it", async () => {
    openAt("session/crown/s14");
    (await screen.findByRole("button", { name: "Scene 2: Greyhollow inn" })).focus();
    await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    expect(sceneCards()[2]).toHaveAccessibleName("Scene 3: Scene 3");
  });

  it("0.5.1: with a scene open, Add scene adds right after it even once focus has moved on", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Scene 5: The Abbess" }));
    await userEvent.click(main().getByRole("heading", { level: 1 }));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    expect(sceneCards()[5]).toHaveAccessibleName("Scene 6: Scene 6");
  });

  it("0.5.1: a scene worked on, then folded and left, is no longer selected: Add scene adds at the end", async () => {
    openAt("session/crown/s14");
    const abbess = await screen.findByRole("button", { name: "Scene 5: The Abbess" });
    await userEvent.click(abbess);
    await userEvent.click(abbess);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await userEvent.click(main().getByRole("heading", { level: 1 }));
    await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(sceneCards()).toHaveLength(7));
    expect(sceneCards()[6]).toHaveAccessibleName("Scene 7: Scene 7");
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
    expect(await screen.findByText('Deleted scene "Aftermath" and its notes.')).toBeInTheDocument();
  });

  it("Open all scenes opens every scene, and folds them again", async () => {
    openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "Open all scenes" }));
    expect(screen.getAllByRole("list", { name: "Music in order" })).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "Fold all scenes" }));
    expect(screen.queryByRole("list", { name: "Music in order" })).not.toBeInTheDocument();
  });

  it("opening a session from its campaign puts the focus on the session's heading once it is ready", async () => {
    openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("link", { name: "Session 14: The Drowned Abbey" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Session 14: The Drowned Abbey" })).toHaveFocus();
  });

  it("an unknown session says so with a way back", async () => {
    openAt("session/crown/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Session not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Campaigns" })).toHaveAttribute("href", "#/campaigns");
  });
});

describe("renaming a scene in place (EDT-1, BUG-18)", () => {
  const head = (name: string) => screen.getByRole("button", { name: `Scene 2: ${name}` });
  const sceneName = async (api: FakeLyreApi) => (await s14(api)).scenes[1].name;

  it("F2 on the scene's name starts editing; Enter saves; the scene stays folded and focus goes back", async () => {
    const { api } = openAt("session/crown/s14");
    const user = userEvent.setup();
    (await screen.findByRole("button", { name: "Scene 2: Greyhollow inn" })).focus();
    await user.keyboard("{F2}");
    const box = screen.getByRole("textbox", { name: "Name of scene 2" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("Greyhollow inn");
    await user.clear(box);
    await user.keyboard("The Drowned Lantern{Enter}");
    await waitFor(async () => expect(await sceneName(api)).toBe("The Drowned Lantern"));
    const renamed = await screen.findByRole("button", { name: "Scene 2: The Drowned Lantern" });
    await waitFor(() => expect(renamed).toHaveFocus());
    expect(renamed).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc cancels; double-click and Rename in the scene's menu start editing too", async () => {
    const { api } = openAt("session/crown/s14");
    const user = userEvent.setup();
    await user.dblClick(await screen.findByRole("button", { name: "Scene 2: Greyhollow inn" }));
    const box = screen.getByRole("textbox", { name: "Name of scene 2" });
    await user.keyboard("Nowhere{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name of scene 2" })).toBeNull();
    expect(head("Greyhollow inn")).toHaveFocus();
    expect(head("Greyhollow inn")).toHaveAttribute("aria-expanded", "false");
    expect(box).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More for Greyhollow inn" }));
    screen.getByRole("menuitem", { name: "Rename" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "Name of scene 2" })).toHaveFocus();
    await user.keyboard("{Control>}a{/Control}The Lantern{Enter}");
    await waitFor(async () => expect(await sceneName(api)).toBe("The Lantern"));
  });
});

describe("renaming the session from its title (BUG-21)", () => {
  const title = () => screen.getByRole("heading", { level: 1 });
  const sessionName = async (api: FakeLyreApi) => (await s14(api)).name;

  it("a click on the title edits only the name; Enter saves, the title and the name field follow, focus goes back", async () => {
    const { api } = openAt("session/crown/s14");
    const user = userEvent.setup();
    await user.click(await within(await screen.findByRole("heading", { level: 1, name: "Session 14: The Drowned Abbey" })).findByRole("button", { name: "Session 14: The Drowned Abbey" }));
    const box = screen.getByRole("textbox", { name: "Name of Session 14" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("The Drowned Abbey");
    expect(title()).toHaveTextContent(/^Session 14:/);
    await user.clear(box);
    await user.keyboard("The Flooded Abbey{Enter}");
    await waitFor(async () => expect(await sessionName(api)).toBe("The Flooded Abbey"));
    const renamed = await within(title()).findByRole("button", { name: "Session 14: The Flooded Abbey" });
    await waitFor(() => expect(renamed).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Session name" })).toHaveValue("The Flooded Abbey");
    expect(await screen.findByText("Session 14 is now called The Flooded Abbey")).toBeInTheDocument();
  });

  it("F2 on the title edits it too; Esc cancels and an empty name saves nothing", async () => {
    const { api } = openAt("session/crown/s14");
    const user = userEvent.setup();
    (await within(await screen.findByRole("heading", { level: 1, name: "Session 14: The Drowned Abbey" })).findByRole("button")).focus();
    await user.keyboard("{F2}");
    await user.keyboard("{Control>}a{/Control}Nowhere{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name of Session 14" })).toBeNull();
    expect(within(title()).getByRole("button", { name: "Session 14: The Drowned Abbey" })).toHaveFocus();
    await user.keyboard("{F2}");
    await user.clear(screen.getByRole("textbox", { name: "Name of Session 14" }));
    await user.keyboard("{Enter}");
    expect(await sessionName(api)).toBe("The Drowned Abbey");
    expect(title()).toHaveTextContent("Session 14: The Drowned Abbey");
    await expectNoAxeViolations();
  });
});

describe("round 5 in the session planner", () => {
  const music = () => within(abbey().getByRole("list", { name: "Music in order" }));
  const dialog = () => within(screen.getByRole("dialog"));

  it("PLY-13: a playlist in a scene has the scene's play order; session playlists have the session's", async () => {
    const user = userEvent.setup();
    await openAbbey();
    const order = await music().findByRole("button", { name: /^Play order of Abbey: eerie, low energy: / });
    expect(order).toHaveAccessibleName("Play order of Abbey: eerie, low energy: Shuffle, no repeat");
    await user.click(order);
    expect(screen.getByRole("menu", { name: "Play order" })).toHaveTextContent("Play order in the scene The abbey ruins");
    await user.keyboard("{Escape}");
    expect(region("Session playlists").getByRole("button", { name: "Play order of Wistful with some warmth: Shuffle, repeat all" })).toBeInTheDocument();
  });

  it("ORG-11, DAT-14, PLY-14: a scene's tracks show their tags, the scene's name with their own, and a wave button to this scene's settings", async () => {
    await openAbbey();
    const first = music().getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("Tags: Eerie, Dread, Drowned Abbess, Exploration");
    expect(first).toHaveTextContent("+1");
    expect(within(first).getByRole("link", { name: /^Waveform, end and fades in this scene: Eerie dread/ })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
    await userEvent.click(screen.getByRole("button", { name: "Scene 6: Aftermath" }));
    const aftermath = within(screen.getByRole("listitem", { name: /^Scene 6: Aftermath$/ }));
    const row = within(aftermath.getByRole("list", { name: "Music in order" })).getAllByRole("listitem")[0];
    expect(row.querySelector("a")?.textContent).toMatch(/^Dawn over the abbey/);
    expect(row).toHaveTextContent("Release after loss, ethereal voice, resolves - end of session or death of an NPC");
    // Folded, a scene's chip uses its name for the track too.
    expect(screen.getByRole("listitem", { name: /^Scene 4: Crypt ambush$/ })).toHaveTextContent("The wight rises");
  });

  it("DAT-14: Name in this scene… names a track for this scene only", async () => {
    const user = userEvent.setup();
    const { api } = await openAbbey();
    await user.click(music().getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }));
    await user.click(screen.getByRole("menuitem", { name: "Name in this scene…" }));
    await user.type(dialog().getByRole("textbox", { name: 'Name in "The abbey ruins"' }), "The drowned bells");
    await user.click(dialog().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(musicNames()[2]).toBe("The drowned bells"));
    const scene = (await s14(api)).scenes.find((x) => x.name === "The abbey ruins")!;
    expect(scene.trackNames).toMatchObject({ [scene.music[2].id]: "The drowned bells" });
  });

  it("ORG-12: Use in… on a scene's track keeps it on hand for the session, listed as a single track", async () => {
    const user = userEvent.setup();
    await openAbbey();
    await user.click(music().getByRole("button", { name: "More for Haunted sea shanty, grey and slow - the drowned bells" }));
    await user.click(screen.getByRole("menuitem", { name: "Use in…" }));
    expect(dialog().getByRole("heading", { name: 'Use "Haunted sea shanty, grey and slow - the drowned bells" in…' })).toBeInTheDocument();
    expect(dialog().getByRole("checkbox", { name: /^Scene: The abbey ruins/ })).toBeChecked();
    await user.click(dialog().getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ }));
    await user.click(dialog().getByRole("button", { name: "Save" }));
    const single = await region("Session playlists").findByRole("link", { name: /^Haunted sea shanty, grey and slow - the drowned bells \(single track\)/ });
    expect(single.closest("li")).toHaveTextContent("Single track");
  }, 40_000);

  it("ORG-10: an open playlist in the music picker has a box per track, to add just that track", async () => {
    const user = userEvent.setup();
    await openAbbey();
    await user.click(abbey().getByRole("button", { name: "Add tracks or playlists…" }));
    await user.type(dialog().getByRole("searchbox", { name: "Search the list" }), "Ashen King");
    await user.click(dialog().getByRole("button", { name: "Show contents of Ashen King" }));
    const inside = within(dialog().getByRole("list", { name: /^Tracks in Ashen King(,|$)/ }));
    await user.click(inside.getByRole("checkbox", { name: "Gothic menace, pounding low brass - villain reveal" }));
    expect(dialog().getByRole("checkbox", { name: /^Ashen King/ })).not.toBeChecked();
    await user.click(dialog().getByRole("button", { name: "Done" }));
    await waitFor(() => expect(musicNames()).toContain("Gothic menace, pounding low brass - villain reveal"));
    expect(musicNames()).not.toContain("Ashen King");
  });

  it("ORG-11: the music picker shows each track's tags", async () => {
    const user = userEvent.setup();
    await openAbbey();
    await user.click(abbey().getByRole("button", { name: "Add tracks or playlists…" }));
    await user.type(dialog().getByRole("searchbox", { name: "Search the list" }), "Bridge of Death");
    expect(screen.getByRole("dialog")).toHaveTextContent("Tags: Eerie, Dread, Drowned Abbess, Exploration");
  });

  it("PLY-14: coming back from the Audio profile opens the scene and focuses the track's wave button", async () => {
    const { returnToSession } = await import("../../kit/sceneReturn");
    openAt("campaigns");
    await screen.findByRole("heading", { level: 1 });
    act(() => returnToSession({ campaignId: "crown", sessionId: "s14", sceneId: "sc3", trackId: "t13" }));
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Scene 3: The abbey ruins" })).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(music().getByRole("link", { name: /^Waveform, end and fades in this scene: Eerie dread/ })).toHaveFocus());
  });

  it("has no accessibility failures with a scene open", async () => {
    await openAbbey();
    await music().findByRole("button", { name: /^Play order of Abbey/ });
    await expectNoAxeViolations();
  });
});

describe("round 7: what a scene does when it starts (PLY-8, r7play.js)", () => {
  const stepItems = () => within(within(screen.getByRole("dialog")).getByRole("list", { name: "Steps" })).getAllByRole("listitem");
  async function openSteps(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "More for The abbey ruins" }));
    await user.click(screen.getByRole("menuitem", { name: "What it does when it starts…" }));
    return screen.getByRole("dialog", { name: "When The abbey ruins starts" });
  }

  it("UX-R1: focus moves into the dialog when it opens from the menu, Tab stays inside and Esc closes it", async () => {
    const user = userEvent.setup();
    openAt("session/crown/s14");
    await user.click(await screen.findByRole("button", { name: "More for The abbey ruins" }));
    screen.getByRole("menuitem", { name: "What it does when it starts…" }).focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "When The abbey ruins starts" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "More for The abbey ruins" })).toHaveFocus();
  });

  it("the usual start is its music, its ambience and its first pad board, and nothing marks the scene", async () => {
    const user = userEvent.setup();
    openAt("session/crown/s14");
    await openSteps(user);
    expect(stepItems().map((li) => li.querySelector(".stp-s")?.textContent)).toEqual([
      expect.stringMatching(/^Play the music: Eerie dread/),
      "Play the ambience: Abbey ambience",
      "Show the pads: Drowned Abbey",
    ]);
    expect(screen.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ })).not.toHaveTextContent("Moves on by itself");
  });

  it("a step is added, changed and moved, and Done saves them with the Saved pop-up", async () => {
    const user = userEvent.setup();
    const { api } = openAt("session/crown/s14");
    const d = within(await openSteps(user));
    await user.click(d.getByRole("button", { name: "Add a step" }));
    await user.click(screen.getByRole("menuitem", { name: "Fire a pad…" }));
    await user.selectOptions(within(stepItems()[3]).getByRole("combobox", { name: "Pad" }), "Drowned Abbey › Abbey bell");
    await user.selectOptions(within(stepItems()[0]).getByRole("combobox", { name: "How it comes in" }), "At the mix-out marker");
    await user.selectOptions(within(stepItems()[0]).getByRole("combobox", { name: "Up next" }), "Play next");
    await user.click(within(stepItems()[3]).getByRole("button", { name: "Move up" }));
    expect(stepItems()[2]).toHaveTextContent("Abbey bell");
    await user.click(d.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent("Saved: what The abbey ruins does when it starts"));
    const sc3 = (await s14(api)).scenes.find((x) => x.id === "sc3")!;
    expect(sc3.steps?.map((x) => x.do)).toEqual(["music", "ambience", "pad", "board"]);
    expect(sc3.steps?.[0]).toMatchObject({ how: "mixOut", upNext: "playNext" });
  });

  it("Then: the scene moves on by itself when its music ends, and is marked", async () => {
    const user = userEvent.setup();
    openAt("session/crown/s14");
    const d = within(await openSteps(user));
    await user.selectOptions(d.getByRole("combobox", { name: "Then" }), "Start the next scene when its music ends");
    await user.click(d.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("listitem", { name: /^Scene \d+: The abbey ruins$/ })).toHaveTextContent("Moves on by itself"));
  });

  it("Try in headphones previews the first step's music", async () => {
    const user = userEvent.setup();
    const { audio } = openAt("session/crown/s14");
    const d = within(await openSteps(user));
    await user.click(d.getByRole("button", { name: "Try in headphones" }));
    expect(audio.calls.some(([m]) => m === "previewTrack" || m === "previewPlaylist")).toBe(true);
  });
});

describe("round 6, part 4: Reorder in a scene's playlist (Must 3, ORG-13)", () => {
  it("Reorder shows Move up and Move down for this scene only; Back to the playlist's order shows once it differs", async () => {
    const user = userEvent.setup();
    const { api } = await openAbbey();
    const music = within(abbey().getByRole("list", { name: "Music in order" }));
    await user.click(music.getByRole("button", { name: "Show contents of The Abbess" }));
    const tracks = () => within(music.getByRole("list", { name: /^Tracks in The Abbess/ }));
    expect(tracks().queryAllByRole("button", { name: /^Move up: / })).toHaveLength(0);
    const reorder = music.getByRole("button", { name: "Reorder" });
    await user.click(reorder);
    expect(reorder).toHaveAttribute("aria-pressed", "true");
    const second = tracks().getAllByRole("button", { name: /^Move up: / })[1].getAttribute("aria-label")!.replace(/^Move up: /, "");
    await user.click(tracks().getByRole("button", { name: `Move up: ${second}` }));
    await waitFor(() => expect(tracks().getAllByRole("listitem")[0]).toHaveTextContent(second));
    expect(tracks().getByRole("button", { name: `Move up: ${second}` })).toBeDisabled();
    expect(await music.findByRole("button", { name: "Back to the playlist's order" })).toBeInTheDocument();
    expect((await api.playlists.trackOrders())["sc:crown:s14:sc3"]?.["p-abbess"]?.length).toBeGreaterThan(0);
    await user.click(reorder);
    expect(tracks().queryAllByRole("button", { name: /^Move up: / })).toHaveLength(0);
  });

  it("PLY-17: Repeat one on a scene's track is saved with the scene", async () => {
    const user = userEvent.setup();
    const { api } = await openAbbey();
    const name = "Repeat one: Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)";
    const button = await abbey().findByRole("button", { name });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    await waitFor(async () => expect((await s14(api)).scenes.find((x) => x.id === "sc3")?.repeatOnes).toContain("t13"));
    await waitFor(() => expect(abbey().getByRole("button", { name })).toHaveAttribute("aria-pressed", "true"));
  });
});
