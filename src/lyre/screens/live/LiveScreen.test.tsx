/**
 * Live (route `live`): the screen the game master runs a game from (round 6 part 3: seven boxes). The same behaviours
 * as e2e/specs/live.spec.ts, on the whole page (providers, shell, Live) over the in-memory LyreApi, the real audio host
 * on the engine's fake audio graph and the prototype's Discord (fake outputs). Live drives the audio host and shows
 * what it says plays.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normaliseHover } from "../../../common/domain";
import { GLOBAL_KEY_EVENT } from "../../../common/globalKeys";
import { createFakeLyreApi } from "../../../common/lyre/fake";
import type { LyreOutputs } from "../../../common/lyreOutputs";
import { AppProviders } from "../../AppProviders";
import { lyreAudioOnFakes } from "../../audio/testing/onFakes";
import { loadInLive } from "../../kit/liveSession";
import { FakeOutputs, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import { Shell } from "../../shell/Shell";
import { expectNoAxeViolations } from "../../test/axe";
import { SCREENS } from "..";
import { ICONS } from "../../kit/icons";
import { resetLiveState } from "./liveState";

beforeEach(() => {
  localStorage.clear();
  loadInLive(null);
  resetLiveState();
});

/** The rooms the audio host plays into: every bot in a voice channel (OutputManager's rooms, as the main process sends them). */
function roomsOf(state: LyreOutputs) {
  return state.bots.flatMap((b) => {
    const channel = b.room && state.servers.flatMap((s) => s.channels).find((c) => c.id === b.room!.channelId);
    return channel ? [{ botId: b.id, name: channel.name }] : [];
  });
}

async function openLive(path = "live") {
  const api = createFakeLyreApi();
  const sound = lyreAudioOnFakes({ tracks: [], playlists: [], campaigns: [] });
  for (const track of await api.library.listTracks()) {
    if (track.url) {
      sound.context.mediaDurations.set(track.url, Math.max(5, track.durationMs / 1000));
      sound.previewContext.mediaDurations.set(track.url, Math.max(5, track.durationMs / 1000));
    }
  }
  const outputs = new FakeOutputs();
  sound.setRooms(roomsOf(outputs.state));
  outputs.onState((state) => sound.setRooms(roomsOf(state)));
  window.history.replaceState(null, "", `#/${path}`);
  render(
    <AppProviders api={api} audio={sound.audio} outputs={outputs}>
      <Shell screens={SCREENS} />
    </AppProviders>,
  );
  if (path === "live") await screen.findByRole("button", { name: /^Start: / });
  return { api, sound, outputs };
}

type Opened = Awaited<ReturnType<typeof openLive>>;

/** Let the fake graph play on for a while (fades, loading), then let React catch up. */
async function playOn(sound: Opened["sound"], seconds = 1) {
  await act(async () => {
    await sound.advance(seconds);
  });
}

const region = (name: string) => within(screen.getByRole("region", { name }));
/** Round 6 part 3: one On air box with a part per room. */
const room = (name: string) => within(within(screen.getByRole("region", { name: "On air" })).getByRole("group", { name }));
const findRoom = async (name: string) => within(await within(screen.getByRole("region", { name: "On air" })).findByRole("group", { name }));
const current = () => region("Current scene");
const roomEl = (name: string) => within(screen.getByRole("region", { name: "On air" })).getByRole("group", { name });
const upNextEl = (name = "Table") => within(roomEl(name)).getByRole("list", { name: "Up next" });
const upNext = (name = "Table") => within(upNextEl(name));
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
const blur = () => act(() => (document.activeElement as HTMLElement | null)?.blur());
const startAbbey = () => userEvent.click(screen.getByRole("button", { name: "Start scene 3: The abbey ruins" }));

async function addSideRoom(outputs: FakeOutputs) {
  await userEvent.click(screen.getByRole("button", { name: "Add a room" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Side room/ }));
  await act(async () => outputs.settle());
  await findRoom("Side room");
}

/** Unfold a box in a tray (they start folded, round 6 part 6). */
async function unfold(name: string) {
  const toggle = within(screen.getByRole("region", { name })).getAllByRole("button", { expanded: false })[0];
  await userEvent.click(toggle);
}

const shanty = "Haunted sea shanty, grey and slow - the drowned bells";
const eerie = "Eerie dread, low cello and choir - something wrong in the dark (loops with crossfade)";

describe("Live on standby", () => {
  it("loads the next session with nothing started: Start the first scene, no Ready, and On air Silent", async () => {
    await openLive();
    expect(screen.getByRole("heading", { level: 1, name: "Live" })).toBeInTheDocument();
    expect(region("Scenes").queryByText("Ready")).toBeNull();
    expect(room("Table").getByText("Silent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "The Sunken Crown Session 14: The Drowned Abbey" })).toHaveAttribute("aria-haspopup", "menu");
    expect(within(screen.getByRole("group", { name: "Prep or live" })).getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    // SHW-7: before a scene starts, Current scene shows no scene.
    expect(current().getByText("No scene yet")).toBeInTheDocument();
  });

  it("has seven boxes, each a region with a heading of its own name; the trays' boxes start folded", async () => {
    await openLive();
    for (const name of ["On air", "Scenes", "Current scene", "Session playlists", "Session pads", "Campaign playlists", "Campaign pads"]) {
      const box = screen.getByRole("region", { name });
      expect(within(box).getByRole("heading", { level: 2 })).toHaveTextContent(new RegExp(name.split(" ").join("\\s*"), "i"));
    }
    for (const name of ["Session playlists", "Session pads", "Campaign playlists", "Campaign pads"]) expect(region(name).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Off script" })).toBeNull();
  });

  it("has no accessibility failures", async () => {
    await openLive();
    await expectNoAxeViolations(screen.getByRole("main"));
  });

  it("the session menu loads another campaign's session on standby", async () => {
    await openLive();
    await userEvent.click(screen.getByRole("button", { name: /The Sunken Crown Session 14/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Session 4: Frost fair/ }));
    expect(await screen.findByRole("button", { name: /The Sixth Year Session 4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start: Breakfast in the great hall" })).toBeInTheDocument();
  });

  it("loading another session fades out what plays from the one before, and clears what was added", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    expect(sound.audio.getNowPlaying().rooms[0].upNextList.some((e) => e.kind === "added")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /The Sunken Crown Session 14/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Session 12: Smugglers of Greyhollow/ }));
    await playOn(sound, 4);
    expect(sound.audio.getNowPlaying().rooms[0].music).toBeNull();
    expect(sound.audio.getNowPlaying().rooms[0].ambience).toBeNull();
    expect(screen.getByRole("button", { name: "Start: The harbour at night" })).toBeInTheDocument();
  });

  it("Run on another session fades out what plays from the one before, and Live waits on standby", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    act(() => {
      window.location.hash = "#/campaign/crown";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Run Session 12/ }));
    expect(await screen.findByRole("button", { name: "Start: The harbour at night" })).toBeInTheDocument();
    await playOn(sound, 4);
    expect(sound.audio.getNowPlaying().rooms[0].music).toBeNull();
  });

  it("Prep opens the session planner of the loaded session", async () => {
    await openLive();
    await userEvent.click(within(screen.getByRole("group", { name: "Prep or live" })).getByRole("button", { name: "Prep" }));
    expect(window.location.hash).toBe("#/session/crown/s14");
  });
});

describe("scenes and undo", () => {
  it("Space starts the next scene, and the Next scene button takes focus", async () => {
    const { sound } = await openLive();
    blur();
    press(" ");
    await playOn(sound);
    expect(region("Scenes").queryByText(/^Scene \d of \d$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Next scene: Greyhollow inn" })).toHaveFocus();
    expect(room("Table").getByText("Playing")).toBeInTheDocument();
    expect(current().getByRole("list", { name: "Recap and the coast road: music in the order it plays" })).toBeInTheDocument();
  });

  it("UX-12: a second Next scene key within a second is ignored, so a double press never skips a scene", async () => {
    await openLive();
    blur();
    press(" ");
    press(" ");
    expect(screen.getByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart scene 2: Greyhollow inn" })).toBeNull();
  });

  it("Space on a button reached with Tab presses that button instead", async () => {
    await openLive();
    screen.getByRole("button", { name: "Stop all" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Keys" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("group", { name: "Keys on the live screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start: Recap and the coast road" })).toBeInTheDocument();
  });

  it("a strip offers Undo after a scene change; Ctrl+Z and the button put back the previous scene", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await userEvent.click(screen.getByRole("button", { name: "Next scene: Crypt ambush" }));
    await playOn(sound);
    // UX-R6: the strip is a group named Undo, not a status: the live region alone reads the change out.
    expect(region("Scenes").queryByRole("status")).toBeNull();
    expect(region("Scenes").getByRole("group", { name: "Undo" })).toHaveTextContent("Started Crypt ambush");
    blur();
    press("z", { ctrlKey: true });
    await playOn(sound);
    expect(screen.getByRole("button", { name: "Next scene: Crypt ambush" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeInTheDocument();
    expect(sound.audio.getNowPlaying().rooms[0].music?.origin).toMatchObject({ kind: "scene", scene: { sceneId: "sc3" } });

    await userEvent.click(screen.getByRole("button", { name: "Next scene: Crypt ambush" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Next scene: Crypt ambush" })).toHaveFocus();
  });

  it("Must 1: after a pause, Ctrl+Z leaves the scene change alone", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(room("Table").getByRole("button", { name: "Pause music" }));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    blur();
    press("z", { ctrlKey: true });
    expect(screen.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeInTheDocument();
  });

  it("Esc alone fades nothing; Shift+Esc fades everything out", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    blur();
    press("Escape");
    await playOn(sound);
    expect(room("Table").getByText("Playing")).toBeInTheDocument();
    press("Escape", { shiftKey: true });
    await playOn(sound, 5);
    expect(room("Table").getByText("Silent")).toBeInTheDocument();
  });

  it("Could 21: the next scene's cue reads Starts when: and its words", async () => {
    await openLive();
    expect(screen.getByRole("region", { name: "Scenes" })).toHaveTextContent("Starts when: As the recap starts");
  });
});

describe("SHW-7: a scene unfolds in place before it starts", () => {
  it("clicking a scene's name unfolds its music in play order, ambience and pad boards, and changes nothing on air", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    const name = region("Scenes").getByRole("button", { name: "Scene 3: The abbey ruins" });
    await userEvent.click(name);
    expect(name).toHaveAttribute("aria-expanded", "true");
    const music = within(region("Scenes").getByRole("list", { name: "The abbey ruins: music in play order" }));
    expect(music.getAllByRole("listitem")[0]).toHaveTextContent("Eerie dread, low cello and choir");
    const row = name.closest("li")!;
    expect(row).toHaveTextContent(/Ambience: \S/);
    expect(row).toHaveTextContent(/Pad boards: \S/);
    expect(sound.audio.getNowPlaying().rooms[0].music?.origin).toMatchObject({ scene: { sceneId: "sc1" } });
  });

  it("Right unfolds a scene from the keyboard and Left folds it", async () => {
    await openLive();
    const name = region("Scenes").getByRole("button", { name: "Scene 4: Crypt ambush" });
    name.focus();
    press("ArrowRight");
    expect(name).toHaveAttribute("aria-expanded", "true");
    expect(name).toHaveFocus();
    press("ArrowLeft");
    expect(name).toHaveAttribute("aria-expanded", "false");
  });

  it("every row of an unfolded scene has Preview, Play next, Add to queue and Play on air", async () => {
    await openLive();
    await userEvent.click(region("Scenes").getByRole("button", { name: "Scene 4: Crypt ambush" }));
    const list = region("Scenes").getByRole("list", { name: "Crypt ambush: music in play order" });
    const rows = Array.from(list.children);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      const names = Array.from(r.querySelectorAll(":scope > div button")).map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0]);
      expect(names.filter((n) => /^(Preview|Play next|Add to queue|Play on air)$/.test(n))).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    }
  });

  it("Play on air in a scene that is not running plays that track by the scene's name, and does not start the scene", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(region("Scenes").getByRole("button", { name: "Scene 6: Aftermath" }));
    await userEvent.click(within(region("Scenes").getByRole("list", { name: "Aftermath: music in play order" })).getAllByRole("button", { name: /^Play on air: Dawn over the abbey/ })[0]);
    await playOn(sound);
    expect(room("Table").getAllByText("Dawn over the abbey").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeInTheDocument();
    expect(current().getByRole("list", { name: "The abbey ruins: music in the order it plays" })).toBeInTheDocument();
  });

  it("a scene's ambience has the row's buttons, and Play on air changes the room's ambience", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: /The Sunken Crown Session 14/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Session 4: Frost fair/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Scene 1: Breakfast in the great hall" }));
    const hall = screen.getByRole("group", { name: "Ambience: Great hall" });
    expect(within(hall).getAllByRole("button").map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0])).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    await userEvent.click(within(hall).getByRole("button", { name: "Play on air: Great hall" }));
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms[0].ambience).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Start: Breakfast in the great hall/ })).toBeInTheDocument();
  });
});

describe("single-key shortcuts and the keys", () => {
  it("Keys opens a list with a switch for single-key shortcuts and the boxes in their order; Esc closes it", async () => {
    await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(screen.getByRole("switch", { name: /Single-key shortcuts/ })).toHaveFocus();
    expect(screen.getByRole("group", { name: "Keys on the live screen" })).toHaveTextContent("On air, Scenes, Current scene, Session playlists");
    // UX-R15: Find and play is listed too, and Fade all has one name.
    expect(screen.getByRole("group", { name: "Keys on the live screen" })).toHaveTextContent(/Ctrl\+K\s*Find and play anything/);
    expect(screen.getByRole("group", { name: "Keys on the live screen" })).toHaveTextContent("Fade all (5 s)");
    expect(screen.queryByRole("menu")).toBeNull();
    press("Escape");
    expect(screen.queryByRole("group", { name: "Keys on the live screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keys" })).toHaveFocus();
  });

  it("switched off, Space, / and pad keys do nothing, and the choice is remembered", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Keys" }));
    await userEvent.click(screen.getByRole("switch", { name: /Single-key shortcuts/ }));
    expect(screen.getByRole("switch", { name: /Single-key shortcuts/ })).not.toBeChecked();
    press("Escape");
    blur();
    press(" ");
    press("/");
    press("r");
    await playOn(sound);
    expect(screen.getByRole("button", { name: "Start: Recap and the coast road" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /^Find a track or playlist/ })).not.toHaveFocus();
    expect(sound.audio.getNowPlaying().rooms[0].effects).toEqual([]);
    expect(localStorage.getItem("lyre-live-keys1")).toBe("off");
  });

  it("/ jumps to Find a track; typing finds tracks; Esc in the field clears it, then closes the results", async () => {
    await openLive();
    blur();
    press("/");
    const search = screen.getByRole("searchbox", { name: /^Find a track or playlist/ });
    expect(search).toHaveFocus();
    await userEvent.type(search, "bells");
    expect(region("Find a track or playlist").getAllByText(/\d+ found/).length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Find a track or playlist" })).toBeNull();
    // UX-R4: focus stays in the field, not on the page.
    expect(search).toHaveFocus();
  });

  it("a pad key starts its pad, but not while typing in a box; a hold pad plays while its key is down", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    screen.getByRole("searchbox", { name: /^Find a track/ }).focus();
    await userEvent.keyboard("r");
    expect(sound.audio.getNowPlaying().rooms[0].effects).toEqual([]);
    blur();
    press("r");
    await playOn(sound, 0.5);
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).toEqual(["abbey/stonedoor"]);
    expect(roomEl("Table")).toHaveTextContent(/1 sounding/);
    press("f");
    await playOn(sound, 0.25);
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).toContain("abbey/heartab");
    fireEvent.keyUp(document.body, { key: "f" });
    await playOn(sound, 1);
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).not.toContain("abbey/heartab");
  });

  it("Alt+3 goes to Current scene, F6 to the next box (Session playlists), Alt+1 to On air", async () => {
    await openLive();
    blur();
    press("3", { altKey: true, code: "Digit3" });
    expect(current().getAllByRole("button", { name: /Current scene/ })[0]).toHaveFocus();
    press("F6");
    expect(region("Session playlists").getByRole("button", { name: "Session Playlists" })).toHaveFocus();
    press("1", { altKey: true, code: "Digit1" });
    expect(region("On air").getAllByRole("button", { name: /On air/ })[0]).toHaveFocus();
  });

  it("UX-12: the keys follow Settings › Keyboard shortcuts", async () => {
    const { api } = await openLive();
    await act(async () => void (await api.settings.setShortcut("nextScene", "N")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start: Recap and the coast road" })).toHaveAttribute("aria-keyshortcuts", "N"));
    blur();
    press(" ");
    expect(screen.getByRole("button", { name: "Start: Recap and the coast road" })).toBeInTheDocument();
    press("n");
    expect(await screen.findByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeInTheDocument();
  });
});

describe("UX-12: keys that work in other programs too", () => {
  const globalKey = (action: "nextScene" | "fadeAll") => {
    const event = new CustomEvent(GLOBAL_KEY_EVENT, { detail: { action }, cancelable: true });
    act(() => void window.dispatchEvent(event));
    return event;
  };

  it("Next scene from another program starts the next scene once, with the guard; Live takes the key", async () => {
    await openLive();
    const first = globalKey("nextScene");
    expect(first.defaultPrevented).toBe(true);
    globalKey("nextScene");
    expect(await screen.findByRole("button", { name: "Restart scene 1: Recap and the coast road" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart scene 2: Greyhollow inn" })).toBeNull();
  });

  it("Fade all from another program fades every room", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    expect(globalKey("fadeAll").defaultPrevented).toBe(true);
    await playOn(sound, 5);
    expect(room("Table").getByText("Silent")).toBeInTheDocument();
  });
});

describe("0.5.1: the fade buttons take 5 s", () => {
  it("Fade all says 5 seconds; a room's Fade music out fades over 5 s", async () => {
    const { sound } = await openLive();
    expect(screen.getByRole("button", { name: "Fade all" })).toHaveAttribute("title", expect.stringContaining("over 5 seconds"));
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound, 5);
    const fade = room("Table").getByRole("button", { name: "Fade music out" });
    expect(fade).toHaveAttribute("title", "Fade music out over 5 seconds");
    const stopLane = vi.spyOn(sound.audio, "stopLane");
    await userEvent.click(fade);
    expect(stopLane).toHaveBeenCalledWith("music", expect.objectContaining({ fadeMs: 5000 }));
  });
});

describe("0.5.1: Stop and Shuffle on air (Nik, 11 Nov)", () => {
  it("the playing music has Stop beside Pause (both kept); Stop ends the music in that room", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const controls = within(room("Table").getByRole("group", { name: "Music in Table" }));
    const names = controls.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names.indexOf("Stop music")).toBe(names.indexOf("Pause music") + 1);
    await userEvent.click(controls.getByRole("button", { name: "Stop music" }));
    await playOn(sound, 2);
    expect(sound.audio.getNowPlaying().rooms[0].music).toBeNull();
    expect(sound.audio.getNowPlaying().rooms[0].ambience).not.toBeNull();
  });

  it("each room has Shuffle next to Repeat, pressed while on, for what plays now", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const shuffle = () => room("Table").getByRole("button", { name: "Shuffle" });
    const repeat = room("Table").getByRole("button", { name: /^Repeat: / });
    expect(shuffle().nextElementSibling ?? shuffle().previousElementSibling).toBe(repeat);
    expect(shuffle()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(shuffle());
    await waitFor(() => expect(shuffle()).toHaveAttribute("aria-pressed", "true"));
    expect(sound.audio.getNowPlaying().rooms[0].shuffle).toBe(true);
    await userEvent.click(shuffle());
    await waitFor(() => expect(shuffle()).toHaveAttribute("aria-pressed", "false"));
  });
});

describe("0.5.1: On air's position bar is a seek bar (Nik, 11 Nov)", () => {
  it("the playing music's bar is a slider named for the track; Right jumps 5 s on in that room, Home to the start", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound, 2);
    // Music first, then the ambience.
    const seek = room("Table").getAllByRole("slider", { name: /^Position in / })[0];
    expect(seek.getAttribute("aria-label")).toBe(`Position in ${sound.audio.getNowPlaying().rooms[0].music!.title}`);
    expect(seek).toHaveAttribute("aria-valuetext", expect.stringMatching(/^0:0\d of \d+:\d\d$/));
    const before = sound.audio.getPositions().rooms[sound.audio.getNowPlaying().rooms[0].roomId]!.music!;
    seek.focus();
    await userEvent.keyboard("{ArrowRight}");
    await playOn(sound, 0.25);
    expect(sound.audio.getPositions().rooms[sound.audio.getNowPlaying().rooms[0].roomId]!.music!).toBeGreaterThan(before + 4.5);
    await userEvent.keyboard("{Home}");
    await playOn(sound, 0.25);
    expect(sound.audio.getPositions().rooms[sound.audio.getNowPlaying().rooms[0].roomId]!.music!).toBeLessThan(1);
  });
});

describe("BUG-21: renaming the session in Live's top strip", () => {
  const session = (name: string) => screen.getByRole("button", { name: `The Sunken Crown Session 14: ${name}` });

  it("F2 on the session edits only its name; Enter saves and focus goes back", async () => {
    const { api } = await openLive();
    const user = userEvent.setup();
    session("The Drowned Abbey").focus();
    await user.keyboard("{F2}");
    const box = screen.getByRole("textbox", { name: "Name of Session 14" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("The Drowned Abbey");
    expect(screen.getByText("Session 14:")).toBeInTheDocument();
    await user.keyboard("{Control>}a{/Control}The Flooded Abbey{Enter}");
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.sessions.find((s) => s.id === "s14")?.name).toBe("The Flooded Abbey"));
    await waitFor(() => expect(session("The Flooded Abbey")).toHaveFocus());
  });

  it("Rename session in the session menu edits it too; Esc cancels", async () => {
    const { api } = await openLive();
    const user = userEvent.setup();
    await user.click(session("The Drowned Abbey"));
    await user.click(screen.getByRole("menuitem", { name: "Rename session" }));
    const box = await screen.findByRole("textbox", { name: "Name of Session 14" });
    await waitFor(() => expect(box).toHaveFocus());
    await user.keyboard("Nowhere{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name of Session 14" })).toBeNull();
    await waitFor(() => expect(session("The Drowned Abbey")).toHaveFocus());
    expect((await api.campaigns.get("crown"))?.sessions.find((s) => s.id === "s14")?.name).toBe("The Drowned Abbey");
  });
});

describe("BUG-20: the scene's pads in Current scene", () => {
  const padsSounding = (sound: Opened["sound"]) => sound.audio.getNowPlaying().rooms.flatMap((r) => r.effects.flatMap((e) => (e.padKey ? [e.padKey] : [])));

  it("a pad that plays says so (pressed, On) and pressing it again stops it, whatever its play mode", async () => {
    const { sound } = await openLive();
    await startAbbey();
    const grid = within(current().getByRole("group", { name: "Pads on Drowned Abbey" }));
    const door = () => grid.getByRole("button", { name: /^Stone door grinds/ });
    expect(door()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(door());
    await playOn(sound, 0.5);
    expect(door()).toHaveAttribute("aria-pressed", "true");
    expect(door()).toHaveAccessibleName(/\bOn$/);
    await userEvent.click(door());
    await playOn(sound, 0.1);
    expect(door()).toHaveAttribute("aria-pressed", "false");
    expect(padsSounding(sound)).toEqual([]);
  });

  it("Stop pads shows while a pad sounds, stops every pad and leaves the music and ambience; focus goes to the first pad", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    expect(current().queryByRole("button", { name: "Stop pads" })).toBeNull();
    blur();
    press("r");
    press("f");
    await playOn(sound, 0.5);
    expect(padsSounding(sound)).toEqual(["abbey/stonedoor", "abbey/heartab"]);
    await userEvent.click(current().getByRole("button", { name: "Stop pads" }));
    await playOn(sound, 0.5);
    expect(padsSounding(sound)).toEqual([]);
    expect(within(current().getByRole("group", { name: "Pads on Drowned Abbey" })).getByRole("button", { name: /^Abbey bell/ })).toHaveFocus();
    const table = sound.audio.getNowPlaying().rooms[0];
    expect(table.music).not.toBeNull();
    expect(table.ambience).not.toBeNull();
    fireEvent.keyUp(document.body, { key: "f" });
  });

  it("the scene's boards are a switch, and the board chosen is the one whose keys play", async () => {
    await openLive();
    await startAbbey();
    const boards = within(current().getByRole("group", { name: "This scene's pad boards" }));
    expect(boards.getAllByRole("button").map((b) => b.textContent)).toEqual(["Drowned Abbey", "Weather and places"]);
    await userEvent.click(boards.getByRole("button", { name: "Weather and places" }));
    expect(current().getByRole("group", { name: "Pads on Weather and places" })).toBeInTheDocument();
  });
});

describe("Current scene: choosing what plays", () => {
  it("lists the scene's tracks and playlists in order, marks the one on air, with its length and the end rule", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const list = current().getByRole("list", { name: /music in the order it plays/ });
    const top = Array.from(list.children);
    expect(top).toHaveLength(4);
    expect(top[0]).toHaveTextContent("On air");
    expect(top[1]).toHaveTextContent("Abbey: eerie, low energy");
    expect(top[2]).toHaveTextContent("Haunted sea shanty");
    expect(top[3]).toHaveTextContent("The Abbess");
    expect(top[0]).toHaveTextContent("3:10");
    expect(room("Table").getByTitle(/Ends 3:10, then next/)).toBeInTheDocument();
  });

  it("the lane's time runs to where the track ends here (its audio profile), not the end of the file", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    // t13 is a 7:21 file; in The abbey ruins it ends at 3:10.
    await waitFor(() => expect(roomEl("Table")).toHaveTextContent(/\d:\d\d \/ 3:10/));
  });

  it("row actions read Preview, Play next, Add to queue, Play on air, in that order; at rest they show, greyed", async () => {
    await openLive();
    await startAbbey();
    const row = current().getByRole("list", { name: /music in the order it plays/ }).children[0] as HTMLElement;
    const names = within(row)
      .getAllByRole("button")
      .map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0])
      .filter((n) => /^(Preview|Play next|Add to queue|Play on air)$/.test(n));
    expect(names).toEqual(["Preview", "Play next", "Add to queue", "Play on air"]);
    expect(current().getByRole("button", { name: "Preview: The Abbess" })).toHaveClass("lv-hov");
  });

  it("Next follows the scene's order into the playlist after the track; Up next is never the track playing", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const table = () => screen.getByRole("region", { name: "On air" });
    expect(table()).toHaveTextContent("Item 1 of 4");
    await userEvent.click(screen.getByRole("button", { name: "Next music track" }));
    await playOn(sound);
    expect(table()).toHaveTextContent("Item 2 of 4");
    expect(table()).toHaveTextContent("Abbey: eerie, low energy");
    const playing = sound.audio.getNowPlaying().rooms[0].music!.trackId;
    expect(sound.audio.getNowPlaying().rooms[0].upNextList[0].trackIds[0]).not.toBe(playing);
  });

  it("a track's title opens its details with a link to its Audio profile in this scene, and does not play it", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: shanty }));
    expect(sound.audio.getNowPlaying().rooms[0].music?.trackId).toBe("t13");
    await userEvent.click(current().getAllByRole("button", { name: /^Eerie dread, low cello/ })[0]);
    expect(current().getByRole("link", { name: /profile/i })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
  });

  it("a playlist opens to show its tracks; it has its play order for this scene (PLY-13)", async () => {
    await openLive();
    await startAbbey();
    await userEvent.click(current().getByRole("button", { name: "Show contents of The Abbess" }));
    expect(current().getByRole("list", { name: "Tracks in The Abbess" })).toBeInTheDocument();
    expect(await current().findByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" })).toBeInTheDocument();
    expect(current().getByRole("button", { name: "Play order of The Abbess: In order, no repeat" })).toBeInTheDocument();
  });

  it("hovering the track on air says how its volume is evened out, with no words added on screen (PLY-15)", async () => {
    const { sound, api } = await openLive();
    await startAbbey();
    await playOn(sound);
    const settings = await api.library.normaliseSettings();
    const t13 = (await api.library.listTracks()).find((t) => t.id === "t13")!;
    const expected = normaliseHover(t13, null, settings);
    const names = room("Table").getAllByTitle((_, element) => !!element?.classList.contains("lv-lane-t") && (element.getAttribute("title") ?? "").includes(expected));
    expect(names[0]).toHaveTextContent(/^Eerie dread/);
    expect(room("Table").queryByText(/evened out/)).toBeNull();
  });

  it("a scene's name for a track shows in its list and On air (DAT-14)", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start scene 6: Aftermath" }));
    await playOn(sound);
    expect(room("Table").getByText("Dawn over the abbey")).toBeInTheDocument();
    expect(current().getByRole("button", { name: "Dawn over the abbey" })).toBeInTheDocument();
  });

  it("PLY-17: Repeat one on a scene's track is saved with the scene, and the room's Repeat then shows one", async () => {
    const { sound, api } = await openLive();
    await startAbbey();
    await playOn(sound);
    const one = current().getByRole("button", { name: `Repeat one: ${eerie}` });
    expect(one).toHaveAttribute("aria-pressed", "false");
    // A moment after the scene's own announcement, as a person would press it.
    await new Promise((r) => setTimeout(r, 600));
    await userEvent.click(one);
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.sessions.find((s) => s.id === "s14")?.scenes[2].repeatOnes).toContain("t13"));
    await waitFor(() => expect(current().getByRole("button", { name: `Repeat one: ${eerie}` })).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(screen.getAllByRole("status").some((st) => st.textContent?.includes("Saved: Repeat one in The abbey ruins"))).toBe(true));
    await waitFor(() => expect(room("Table").getByRole("button", { name: /^Repeat: / })).toHaveAccessibleName("Repeat: one"));
    // UX-R6: one event, one message: Live's fuller words are read out in place of the pop-up's.
    await new Promise((r) => setTimeout(r, 300));
    expect(document.getElementById("lyre-live")).toHaveTextContent(/^Repeat one on, saved with the scene: /);
    expect(document.getElementById("lyre-toast")).toHaveAttribute("aria-live", "off");
  });
});

describe("PLY-16: Play next, Add to queue and Up next", () => {
  it("Play next goes right after the current track, Add to queue to the bottom of Up next; Next plays what was next", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    await userEvent.click(current().getByRole("button", { name: `Play next: ${shanty}` }));
    const items = upNext().getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(`Play next: ${shanty}`);
    expect(items[items.length - 1]).toHaveTextContent("Added: The Abbess");
    await userEvent.click(screen.getByRole("button", { name: "Next music track" }));
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms[0].music?.trackId).toBe("t42");
  });

  it("× takes an entry out of Up next; Undo (or Ctrl+Z) takes an add back, and the scene change stays", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: `Add to queue: ${shanty}` }));
    const added = upNext().getAllByRole("listitem").find((li) => li.textContent?.includes(`Added: ${shanty}`))!;
    await userEvent.click(within(added).getByRole("button", { name: `Remove ${shanty} from Up next` }));
    expect(upNext().queryAllByRole("listitem").filter((li) => li.textContent?.includes(`Added: ${shanty}`))).toHaveLength(0);
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    expect(room("Table").getByRole("group", { name: "Undo" })).toHaveTextContent("Added to the queue: The Abbess");
    blur();
    press("z", { ctrlKey: true });
    expect(upNext().queryByText("The Abbess")).toBeNull();
    expect(screen.getByRole("button", { name: "Restart scene 3: The abbey ruins" })).toBeInTheDocument();
  });

  it("a new scene clears what was added; its Undo brings it back", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    await userEvent.click(screen.getByRole("button", { name: /^Next scene: / }));
    await playOn(sound);
    expect(room("Table").queryByText(/^Added:/)).toBeNull();
    expect(sound.audio.getNowPlaying().rooms[0].upNextList.some((e) => e.kind === "added")).toBe(false);
    await userEvent.click(within(screen.getByRole("region", { name: "Scenes" })).getByRole("button", { name: "Undo" }));
    await playOn(sound);
    expect(upNextEl()).toHaveTextContent("Added: The Abbess");
  });

  it("a long Up next folds to one line with how many more, and unfolds", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    for (const i of [0, 1, 2]) await userEvent.click(current().getAllByRole("button", { name: /^Add to queue: / })[i]);
    expect(upNext().getAllByRole("listitem")).toHaveLength(1);
    const more = upNext().getByRole("button", { name: /^\d+ more$/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(upNext().getAllByRole("listitem").filter((li) => li.textContent?.includes("Added:"))).toHaveLength(4);
  });

  it("a track in an unfolded scene can be added before that scene starts, by the scene's name for it", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    await userEvent.click(region("Scenes").getByRole("button", { name: "Scene 6: Aftermath" }));
    await userEvent.click(within(region("Scenes").getByRole("list", { name: "Aftermath: music in play order" })).getAllByRole("button", { name: /^Add to queue: / })[0]);
    expect(upNextEl()).toHaveTextContent("Added: Dawn over the abbey");
  });

  it("PLY-17: the room's Repeat goes off, all, one; it is for what plays now and is off again after the music stops", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const repeat = () => room("Table").getByRole("button", { name: /^Repeat: / });
    expect(repeat()).toHaveAccessibleName("Repeat: off");
    await userEvent.click(repeat());
    expect(repeat()).toHaveAccessibleName("Repeat: all");
    expect(repeat()).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(repeat());
    expect(repeat()).toHaveAccessibleName("Repeat: one");
    await userEvent.click(screen.getByRole("button", { name: "Stop all" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart scene 3: The abbey ruins" }));
    await playOn(sound);
    expect(repeat()).toHaveAccessibleName("Repeat: off");
  });

  it("PLY-1: What played opens in the room, newest first, with Play again", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "Next music track" }));
    await playOn(sound);
    // UX-R14: its icon is a clock turning back, not Add to queue's lines.
    expect(room("Table").getByRole("button", { name: "What played" }).querySelector("path")).toHaveAttribute("d", ICONS.history);
    await userEvent.click(room("Table").getByRole("button", { name: "What played" }));
    const played = within(room("Table").getByRole("list", { name: "What played in Table" })).getAllByRole("listitem");
    expect(played[1]).toHaveTextContent("Eerie dread");
    await userEvent.click(within(played[1]).getByRole("button", { name: /^Play again: / }));
    await playOn(sound);
    expect(room("Table").queryByRole("list", { name: "What played in Table" })).toBeNull();
    expect(sound.audio.getNowPlaying().rooms[0].music?.trackId).toBe("t13");
  });
});

describe("Find a track or playlist", () => {
  it("finds playlists first, each with the row's buttons, then tracks; a playlist unfolds to its tracks", async () => {
    await openLive();
    const field = screen.getByRole("searchbox", { name: /^Find a track or playlist/ });
    await userEvent.click(field);
    await userEvent.type(field, "abbess");
    const found = region("Find a track or playlist");
    const lists = found.getAllByRole("list").filter((l) => /^(Playlists|Tracks)$/.test(l.getAttribute("aria-labelledby") ? (document.getElementById(l.getAttribute("aria-labelledby")!)?.textContent ?? "") : ""));
    expect(document.getElementById(lists[0].getAttribute("aria-labelledby")!)?.textContent).toBe("Playlists");
    const pl = within(found.getByRole("list", { name: "Playlists" })).getAllByRole("listitem")[0];
    await userEvent.click(within(pl).getByRole("button", { name: "Show contents of The Abbess" }));
    expect(within(pl).getByRole("list", { name: "Tracks in The Abbess" })).toBeInTheDocument();
  });

  it("UX-R7: the count is read out once typing pauses, and Clear is not part of what is read", async () => {
    await openLive();
    const live = document.getElementById("lyre-live")!;
    const heard: string[] = [];
    const watch = new MutationObserver(() => live.textContent && heard.push(live.textContent));
    watch.observe(live, { childList: true, characterData: true, subtree: true });
    await userEvent.type(screen.getByRole("searchbox", { name: /^Find a track or playlist/ }), "abbess");
    expect(region("Find a track or playlist").queryByRole("status")).toBeNull();
    await waitFor(() => expect(heard.some((h) => /^\d+ found$/.test(h))).toBe(true), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 700));
    watch.disconnect();
    expect(heard.filter((h) => /found/.test(h))).toHaveLength(1);
  });

  it("a tag you pick can be cleared with the X next to the tag list", async () => {
    await openLive();
    await userEvent.click(screen.getByRole("searchbox", { name: /^Find a track/ }));
    const moods = within(screen.getByRole("group", { name: "Moods" }));
    await userEvent.click(moods.getByRole("button", { name: "Tense" }));
    expect(moods.getByRole("button", { name: "Tense" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Clear selected tags" }));
    expect(screen.queryByRole("button", { name: "Clear selected tags" })).toBeNull();
    expect(moods.getByRole("button", { name: "Tense" })).toHaveAttribute("aria-pressed", "false");
  });

  it("FX narrows the results, and an effect played on air layers over the music", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    const field = screen.getByRole("searchbox", { name: /^Find a track/ });
    await userEvent.click(field);
    const found = region("Find a track or playlist");
    await userEvent.click(within(found.getByRole("group", { name: "Show" })).getByRole("button", { name: "FX" }));
    await userEvent.type(field, "door");
    expect(found.getAllByText("2 found").length).toBeGreaterThan(0);
    await userEvent.click(within(found.getByRole("list", { name: "Tracks" })).getByRole("button", { name: "Play on air: Heavy door slams" }));
    await playOn(sound, 0.5);
    const table = sound.audio.getNowPlaying().rooms[0];
    expect(table.effects.map((e) => e.trackId)).toEqual(["f08"]);
    expect(table.music?.trackId).toBe("t23");
  });
});

describe("the trays", () => {
  it("Session playlists start folded and stay open once unfolded; the campaign's single tracks play on air (ORG-12)", async () => {
    const { sound } = await openLive();
    const toggle = region("Session playlists").getByRole("button", { name: "Session Playlists" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(region("Session playlists").getAllByRole("listitem").length).toBeGreaterThan(0);
    await userEvent.click(region("Campaign playlists").getByRole("button", { name: "Campaign Playlists" }));
    await userEvent.click(region("Campaign playlists").getByRole("button", { name: /^Play on air: Ominous song, the villain's calling card/ }));
    await playOn(sound);
    expect(room("Table").getByText(/Ominous song, the villain's calling card/)).toBeInTheDocument();
  });
});

describe("rooms", () => {
  it("a room has Mute, shown as the one status Muted, and a volume slider that works from the keyboard", async () => {
    const { outputs } = await openLive();
    const table = room("Table");
    await userEvent.click(table.getByRole("button", { name: "Mute Table" }));
    expect(table.getByText("Muted")).toBeInTheDocument();
    expect(outputs.calls).toContainEqual(["setMuted", TABLE_BOT, true]);
    await userEvent.click(table.getByRole("button", { name: "Mute Table" }));
    expect(table.queryByText("Muted")).toBeNull();
    const volume = table.getByRole("slider", { name: "Volume in Table" });
    expect(volume).toHaveValue("85");
    fireEvent.change(volume, { target: { value: "80" } });
    expect(volume).toHaveValue("80");
    expect(outputs.calls).toContainEqual(["setVolume", TABLE_BOT, 0.8]);
  });

  it("with one room there is no To: choice; Add a room gives a second part and To: choices on each box", async () => {
    const { outputs } = await openLive();
    expect(screen.queryByRole("button", { name: /choose a room/i })).toBeNull();
    await addSideRoom(outputs);
    expect(room("Side room").getByText(/^(Silent|Nobody there)$/)).toBeInTheDocument();
    await unfold("Session playlists");
    await userEvent.click(screen.getByRole("searchbox", { name: /^Find a track/ }));
    for (const box of ["Current scene", "Session playlists", "Find a track or playlist"]) {
      expect(region(box).getByRole("button", { name: /choose a room/i })).toHaveTextContent(/^To:\s*Table$/);
    }
  });

  it("To: Side room sends Play on air from Session playlists only to that room; scenes always start in the first room", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    await unfold("Session playlists");
    const box = region("Session playlists");
    await userEvent.click(box.getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    expect(box.getByRole("button", { name: /choose a room/i })).toHaveFocus();
    expect(box.getByRole("button", { name: /choose a room/i })).toHaveTextContent(/^To:\s*Side room$/);
    await userEvent.click(box.getAllByRole("button", { name: /^Play on air in Side room: / })[0]);
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms.find((r) => r.roomId === SIDE_BOT)?.music).not.toBeNull();
    expect(room("Table").getByText("Silent")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms.find((r) => r.roomId === TABLE_BOT)?.music).not.toBeNull();
  });

  it("a pad key plays in the room Current scene chose", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await userEvent.click(current().getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    blur();
    press("1");
    await playOn(sound, 0.5);
    const rooms = sound.audio.getNowPlaying().rooms;
    expect(rooms.find((r) => r.roomId === SIDE_BOT)?.effects.map((e) => e.padKey)).toEqual(["weather/thunder"]);
    expect(rooms.find((r) => r.roomId === TABLE_BOT)?.effects).toEqual([]);
    expect(room("Side room").getByText(/Thunder/)).toBeInTheDocument();
  });

  it("OUT-7: each room shows its bot; its menu moves it, copies another room; Kick takes it out at once, with Undo", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    await unfold("Session playlists");
    const box = region("Session playlists");
    await userEvent.click(box.getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    await userEvent.click(box.getAllByRole("button", { name: /^Play on air in Side room: / })[0]);
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "Lyre Table in Table: change" }));
    const menu = within(screen.getByRole("menu", { name: "Room Table" }));
    expect(menu.getByText("Lyre Table plays in")).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: /Copy what Side room is playing/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    // Nobody is in Side room: Kick takes it out at once, with nothing to undo.
    await userEvent.click(screen.getByRole("button", { name: "Kick Lyre Side from Side room" }));
    await act(async () => outputs.settle());
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "On air" })).queryByRole("group", { name: "Side room" })).toBeNull());
    expect(screen.queryByRole("button", { name: /choose a room/i })).toBeNull();
  });

  it("OUT-7: Kick of a room the players were hearing offers Undo, which puts the bot back with its music", async () => {
    const { outputs, sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "Kick Lyre Table from Table" }));
    await act(async () => outputs.settle());
    const strip = within(screen.getByRole("region", { name: "On air" })).getAllByRole("group", { name: "Undo" }).find((st) => st.textContent?.includes("Lyre Table left Table"))!;
    await userEvent.click(within(strip).getByRole("button", { name: "Undo" }));
    await act(async () => outputs.settle());
    await playOn(sound);
    await waitFor(() => expect(room("Table").getByText("Playing")).toBeInTheDocument());
  });

  it("Must 2: a bot moved to a channel with nobody in it says Nobody there, offers Move to Table, and has Undo", async () => {
    const { outputs, sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "Lyre Table in Table: change" }));
    const menu = within(screen.getByRole("menu", { name: "Room Table" }));
    expect(menu.getByRole("menuitemradio", { name: /^Side room\s*empty$/ })).toBeInTheDocument();
    expect(menu.getAllByRole("menuitemradio", { name: /players/ })).toHaveLength(1);
    await userEvent.click(menu.getByRole("menuitemradio", { name: /^Side room/ }));
    await act(async () => outputs.settle());
    const side = await findRoom("Side room");
    expect(side.getByText("Nobody there")).toBeInTheDocument();
    // UX-R9: the status says the one wording; the line under it says what it means, without repeating it.
    expect(side.getByText("Players hear nothing")).toBeInTheDocument();
    expect(side.getByRole("button", { name: "Move to Table" })).toBeInTheDocument();
    // The Now playing bar tags the room's row the same way, outlined in the warning colour.
    expect(screen.getByTitle("Nobody hears it: nobody is in Side room")).toHaveTextContent("On air · nobody there");
    await userEvent.click(side.getByRole("button", { name: "Undo" }));
    await act(async () => outputs.settle());
    expect(await findRoom("Table")).toBeTruthy();
  });

  it("with no room joined, On air warns that players hear nothing and offers Join Table", async () => {
    const { outputs } = await openLive();
    act(() => outputs.leave(TABLE_BOT));
    expect(await screen.findByText(/players hear nothing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Join Table/ }));
    await act(async () => outputs.settle());
    expect(await findRoom("Table")).toBeTruthy();
    expect(screen.queryByText(/players hear nothing/)).toBeNull();
  });
});

describe("BUG-19: with no room, nobody hears what plays", () => {
  it("On air's No room says Silent, then Nobody hears it once something plays; the row on air says On air · no room", async () => {
    const { outputs, sound } = await openLive();
    act(() => outputs.leave(TABLE_BOT));
    const none = await findRoom("No room");
    expect(none.getByText("Silent")).toBeInTheDocument();
    await startAbbey();
    await playOn(sound);
    expect(room("No room").getByText("Nobody hears it")).toBeInTheDocument();
    expect(current().getByText("On air · no room")).toBeInTheDocument();
    expect(sound.hearSpeakers()).toBe(0);
  });
});

describe("the Now playing bar in Live (UX-16)", () => {
  it("shows only a preview, tagged Only you, because On air shows what each room hears", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
    await userEvent.click(current().getAllByRole("button", { name: /^Preview: / })[0]);
    await playOn(sound);
    const bar = within(screen.getByRole("region", { name: "Now playing" }));
    expect(bar.getByRole("group", { name: "Only you" })).toHaveTextContent("Previewed from Live");
    expect(bar.queryByRole("group", { name: /^On air/ })).toBeNull();
  });
});

/* 0.5.0 usability review (UX-R4): when the control in use goes, focus goes to a neighbour, never to the page. */
describe("UX-R4: focus after the control in use goes", () => {
  const focusName = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? document.activeElement?.textContent;

  it("× in Up next moves focus to the next ×", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(current().getByRole("button", { name: `Add to queue: ${shanty}` }));
    await userEvent.click(current().getByRole("button", { name: "Add to queue: The Abbess" }));
    const added = upNext().getAllByRole("listitem").find((li) => li.textContent?.includes(`Added: ${shanty}`))!;
    await userEvent.click(within(added).getByRole("button", { name: `Remove ${shanty} from Up next` }));
    await waitFor(() => expect(focusName()).toBe("Remove The Abbess from Up next"));
  });

  it("Add a room moves focus to the new room's bot button", async () => {
    const { outputs } = await openLive();
    await addSideRoom(outputs);
    await waitFor(() => expect(focusName()).toBe("Lyre Side in Side room: change"));
  });

  it("Undo after Kick puts focus back on the room's bot button", async () => {
    const { outputs, sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "Kick Lyre Table from Table" }));
    await act(async () => outputs.settle());
    await userEvent.click(within(screen.getByRole("region", { name: "On air" })).getByRole("button", { name: "Undo" }));
    await act(async () => outputs.settle());
    await playOn(sound);
    await waitFor(() => expect(focusName()).toBe("Lyre Table in Table: change"));
  });
});
