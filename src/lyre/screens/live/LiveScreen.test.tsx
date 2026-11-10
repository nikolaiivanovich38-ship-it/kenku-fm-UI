/**
 * Live (route `live`): the screen the game master runs a game from. The same behaviours as e2e/specs/live.spec.ts,
 * on the whole page (providers, shell, Live) over the in-memory LyreApi, the real audio host on the engine's fake
 * audio graph and the prototype's Discord (fake outputs). Live drives the audio host and shows what it says plays.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { normaliseHover } from "../../../common/domain";
import { createFakeLyreApi } from "../../../common/lyre/fake";
import type { LyreOutputs } from "../../../common/lyreOutputs";
import { AppProviders } from "../../AppProviders";
import { lyreAudioOnFakes } from "../../audio/testing/onFakes";
import { loadInLive } from "../../kit/liveSession";
import { FakeOutputs, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import { Shell } from "../../shell/Shell";
import { expectNoAxeViolations } from "../../test/axe";
import { SCREENS } from "..";
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
const findRegion = async (name: string) => within(await screen.findByRole("region", { name }));
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
const blur = () => act(() => (document.activeElement as HTMLElement | null)?.blur());
const startAbbey = () => userEvent.click(screen.getByRole("button", { name: "Start scene 3: The abbey ruins" }));

async function addSideRoom(outputs: FakeOutputs) {
  await userEvent.click(screen.getByRole("button", { name: "Add a room" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Side room/ }));
  await act(async () => outputs.settle());
  await findRegion("On air: Side room");
}

describe("Live on standby", () => {
  it("loads the next session with nothing started: Start the first scene, no Ready (round 6 part 5), and every room Silent", async () => {
    await openLive();
    expect(screen.getByRole("heading", { level: 1, name: "Live" })).toBeInTheDocument();
    expect(region("Scenes").queryByText("Ready")).toBeNull();
    expect(region("On air: Table").getByText("Silent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /The Sunken Crown Session 14/ })).toHaveAttribute("aria-haspopup", "menu");
    expect(within(screen.getByRole("group", { name: "Prep or live" })).getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
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

  it("loading another session fades out what plays from the one before", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms[0].music).not.toBeNull();
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
    // Round 6 part 5 (Nik, 6 Nov 16:14): no scene count; Now says which scene runs.
    expect(region("Scenes").queryByText(/^Scene \d of \d$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Next scene: Greyhollow inn" })).toHaveFocus();
    expect(region("On air: Table").getByText("Playing")).toBeInTheDocument();
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
    expect(region("Scenes").getByRole("status")).toHaveTextContent("Started Crypt ambush");
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

  it("Esc alone fades nothing; Shift+Esc fades everything out", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    blur();
    press("Escape");
    await playOn(sound);
    expect(region("On air: Table").getByText("Playing")).toBeInTheDocument();
    press("Escape", { shiftKey: true });
    await playOn(sound, 5);
    expect(region("On air: Table").getByText("Silent")).toBeInTheDocument();
  });
});

describe("single-key shortcuts", () => {
  it("Keys opens a list with a switch for single-key shortcuts; Esc closes it and focus goes back", async () => {
    await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(screen.getByRole("switch", { name: /Single-key shortcuts/ })).toHaveFocus();
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
    expect(screen.getByRole("searchbox", { name: /Off script/ })).not.toHaveFocus();
    expect(sound.audio.getNowPlaying().rooms[0].effects).toEqual([]);
    expect(localStorage.getItem("lyre-live-keys1")).toBe("off");
  });

  it("/ jumps to the Off script search; typing finds tracks; Esc in the box clears it", async () => {
    await openLive();
    blur();
    press("/");
    const search = screen.getByRole("searchbox", { name: /Off script/ });
    expect(search).toHaveFocus();
    await userEvent.type(search, "bells");
    expect(region("Off script").getAllByText(/\d+ found/).length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveValue("");
  });

  it("a pad key starts its pad, but not while typing in a box; a hold pad plays while its key is down", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    screen.getByRole("searchbox", { name: /Off script/ }).focus();
    await userEvent.keyboard("r");
    expect(sound.audio.getNowPlaying().rooms[0].effects).toEqual([]);
    blur();
    press("r");
    await playOn(sound, 0.5);
    expect(region("On air: Table").queryByText(/^None$/)).toBeNull();
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).toEqual(["abbey/stonedoor"]);
    press("f");
    await playOn(sound, 0.25);
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).toContain("abbey/heartab");
    fireEvent.keyUp(document.body, { key: "f" });
    await playOn(sound, 1);
    expect(sound.audio.getNowPlaying().rooms[0].effects.map((e) => e.padKey)).not.toContain("abbey/heartab");
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

describe("BUG-20: stopping pads in Live", () => {
  const padsSounding = (sound: Opened["sound"]) => sound.audio.getNowPlaying().rooms.flatMap((r) => r.effects.flatMap((e) => (e.padKey ? [e.padKey] : [])));

  it("a pad that plays says so (pressed, On) and pressing it again stops it, whatever its play mode", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await userEvent.click(region("Pads").getByRole("button", { name: "Pads" }));
    const grid = within(screen.getByRole("group", { name: "Pads on Drowned Abbey" }));
    const door = () => grid.getByRole("button", { name: /^Stone door grinds/ });
    expect(door()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(door());
    await playOn(sound, 0.5);
    expect(door()).toHaveAttribute("aria-pressed", "true");
    expect(door()).toHaveAccessibleName("Stone door grinds On");
    await userEvent.click(door());
    await playOn(sound, 0.1);
    expect(door()).toHaveAttribute("aria-pressed", "false");
    expect(door()).not.toHaveAccessibleName(/\bOn$/);
    expect(padsSounding(sound)).toEqual([]);
  });

  it("Stop pads stops every pad and leaves the scene's music and ambience; it is dimmed while no pad plays", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(region("Pads").getByRole("button", { name: "Pads" }));
    const stop = () => region("Pads").getByRole("button", { name: "Stop pads" });
    expect(stop()).toHaveAttribute("aria-disabled", "true");
    blur();
    press("r");
    press("f");
    await playOn(sound, 0.5);
    expect(padsSounding(sound)).toEqual(["abbey/stonedoor", "abbey/heartab"]);
    expect(stop()).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(stop());
    await playOn(sound, 0.5);
    expect(padsSounding(sound)).toEqual([]);
    expect(stop()).toHaveFocus();
    expect(stop()).toHaveAttribute("aria-disabled", "true");
    const table = sound.audio.getNowPlaying().rooms[0];
    expect(table.music).not.toBeNull();
    expect(table.ambience).not.toBeNull();
    expect(await screen.findByText("Pads stopped")).toBeInTheDocument();
    fireEvent.keyUp(document.body, { key: "f" });
  });
});

describe("choosing what plays", () => {
  it("Scene music lists the scene's tracks and playlists in order and marks the one on air", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const items = within(region("Scene music").getByRole("list", { name: /music in the order it plays/ })).getAllByRole("listitem", { hidden: false });
    const top = items.filter((li) => li.parentElement?.getAttribute("aria-label")?.endsWith("music in the order it plays"));
    expect(top).toHaveLength(4);
    expect(top[0]).toHaveTextContent("On air");
    expect(top[1]).toHaveTextContent("Abbey: eerie, low energy");
    expect(top[2]).toHaveTextContent("Haunted sea shanty");
    expect(top[3]).toHaveTextContent("The Abbess");
    // The length that plays here (the scene's own end point), and the end rule on the On air box.
    expect(top[0]).toHaveTextContent("3:10");
    expect(region("On air: Table").getByTitle(/Ends 3:10, then next/)).toBeInTheDocument();
  });

  it("row actions read Preview, Play next, Play on air, in that order", async () => {
    await openLive();
    await startAbbey();
    const row = within(region("Scene music").getByRole("list", { name: /music in the order it plays/ })).getAllByRole("listitem")[0];
    const names = within(row)
      .getAllByRole("button")
      .map((b) => (b.getAttribute("aria-label") ?? "").split(":")[0])
      .filter((n) => /^(Preview|Play next|Play on air)/.test(n));
    expect(names).toEqual(["Preview", "Play next", "Play on air"]);
  });

  it("Next follows the scene's order into the playlist after the track", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const onAir = () => screen.getByRole("region", { name: "On air: Table" });
    expect(onAir()).toHaveTextContent("Item 1 of 4");
    await userEvent.click(screen.getByRole("button", { name: "Next music track" }));
    await playOn(sound);
    expect(onAir()).toHaveTextContent("Item 2 of 4");
    expect(onAir()).toHaveTextContent("Abbey: eerie, low energy");
  });

  it("Play next queues a track and Next music then plays it", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    const queued = "Haunted sea shanty, grey and slow - the drowned bells";
    await userEvent.click(region("Scene music").getByRole("button", { name: `Play next: ${queued}` }));
    expect(region("On air: Table").getByText("Queued")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next music track" }));
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms[0].music?.trackId).toBe("t42");
    expect(region("On air: Table").getAllByText(queued).length).toBeGreaterThan(0);
  });

  it("a track's title opens its details with a link to its Audio profile in this scene, and does not play it", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    await userEvent.click(region("Scene music").getByRole("button", { name: "Haunted sea shanty, grey and slow - the drowned bells", exact: true } as never));
    expect(sound.audio.getNowPlaying().rooms[0].music?.trackId).toBe("t13");
    await userEvent.click(region("Scene music").getAllByRole("button", { name: /^Eerie dread, low cello/ })[0]);
    expect(region("Scene music").getByRole("link", { name: /profile/i })).toHaveAttribute("href", "#/profile/t13/sc:crown:s14:sc3");
  });

  it("a playlist in Scene music opens to show its tracks", async () => {
    await openLive();
    await startAbbey();
    await userEvent.click(region("Scene music").getByRole("button", { name: "Show contents of The Abbess" }));
    expect(region("Scene music").getByRole("list", { name: "Tracks in The Abbess" })).toBeInTheDocument();
  });

  it("the Pads box offers the scene's boards as a switch", async () => {
    await openLive();
    await startAbbey();
    await userEvent.click(region("Pads").getByRole("button", { name: "Pads" }));
    const boards = within(screen.getByRole("group", { name: "This scene's pad boards" }));
    expect(boards.getAllByRole("button").map((b) => b.textContent)).toEqual(["Drowned Abbey", "Weather and places"]);
    await userEvent.click(boards.getByRole("button", { name: "Weather and places" }));
    expect(screen.getByRole("group", { name: "Pads on Weather and places" })).toBeInTheDocument();
  });

  it("the campaign's single tracks are in its menu, ready to play on air (ORG-12)", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: /^Campaign:/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Play on air: Ominous song, the villain's calling card/ }));
    await playOn(sound);
    expect(region("On air: Table").getByText(/Ominous song, the villain's calling card/)).toBeInTheDocument();
  });

  it("a playlist in the scene's list has its play order for this scene (PLY-13)", async () => {
    await openLive();
    await startAbbey();
    expect(await region("Scene music").findByRole("button", { name: "Play order of Abbey: eerie, low energy: Shuffle, no repeat" })).toBeInTheDocument();
    expect(region("Scene music").getByRole("button", { name: "Play order of The Abbess: In order, no repeat" })).toBeInTheDocument();
  });

  it("hovering the track in an On air box says how its volume is evened out, with no words added on screen (PLY-15)", async () => {
    const { sound, api } = await openLive();
    await startAbbey();
    await playOn(sound);
    const settings = await api.library.normaliseSettings();
    const t13 = (await api.library.listTracks()).find((t) => t.id === "t13")!;
    const expected = normaliseHover(t13, null, settings);
    // The title is the track's own name, then the volume line on its own line.
    const name = region("On air: Table").getByTitle((_, element) => element?.getAttribute("title") === `${t13.title}\n${expected}`);
    expect(name).toHaveTextContent(/^Eerie dread/);
    expect(region("On air: Table").queryByText(/evened out/)).toBeNull();
    // Normalise volume switched on in the Library: the hover follows.
    await act(async () => void (await api.library.setNormaliseSettings({ on: true, target: "standard" })));
    const on = normaliseHover({ ...t13 }, null, { on: true, target: "standard" });
    expect(on).toMatch(/^Volume evened out|not measured yet/);
    await waitFor(() => expect(region("On air: Table").getByTitle((_, element) => element?.getAttribute("title") === `${t13.title}\n${on}`)).toBeInTheDocument());
  });

  it("a scene's name for a track shows in its list and its On air box (DAT-14)", async () => {
    const { sound } = await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Start scene 6: Aftermath" }));
    await playOn(sound);
    expect(region("On air: Table").getByText("Dawn over the abbey")).toBeInTheDocument();
    expect(region("Scene music").getByRole("button", { name: "Dawn over the abbey" })).toBeInTheDocument();
  });
});

describe("Off script search", () => {
  it("a tag you pick can be cleared with the X next to the tag list", async () => {
    await openLive();
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
    const off = region("Off script");
    await userEvent.click(within(off.getByRole("group", { name: "Show" })).getByRole("button", { name: "FX" }));
    await userEvent.type(off.getByRole("searchbox"), "door");
    expect(off.getAllByText("2 found").length).toBeGreaterThan(0);
    await userEvent.click(within(off.getByRole("list", { name: "Off script results" })).getByRole("button", { name: "Play on air: Heavy door slams" }));
    await playOn(sound, 0.5);
    const table = sound.audio.getNowPlaying().rooms[0];
    expect(table.effects.map((e) => e.trackId)).toEqual(["f08"]);
    expect(table.music?.trackId).toBe("t23");
  });
});

describe("rooms", () => {
  it("a room's box has Mute, shown as the one status Muted, and a volume slider that works from the keyboard", async () => {
    const { outputs } = await openLive();
    const room = region("On air: Table");
    await userEvent.click(room.getByRole("button", { name: "Mute Table" }));
    expect(room.getByText("Muted")).toBeInTheDocument();
    expect(outputs.calls).toContainEqual(["setMuted", TABLE_BOT, true]);
    await userEvent.click(room.getByRole("button", { name: "Mute Table" }));
    expect(room.queryByText("Muted")).toBeNull();
    const volume = room.getByRole("slider", { name: "Volume in Table" });
    expect(volume).toHaveValue("85");
    fireEvent.change(volume, { target: { value: "80" } });
    expect(volume).toHaveValue("80");
    expect(outputs.calls).toContainEqual(["setVolume", TABLE_BOT, 0.8]);
  });

  it("with one room there is no To: choice; Add a room gives a second box, Silent, and To: choices on each box", async () => {
    const { outputs } = await openLive();
    expect(screen.queryByRole("button", { name: /choose a room/i })).toBeNull();
    await addSideRoom(outputs);
    expect(region("On air: Side room").getByText("Silent")).toBeInTheDocument();
    for (const box of ["Scene music", "Off script"]) {
      expect(region(box).getByRole("button", { name: /choose a room/i })).toHaveTextContent(/^To:\s*Table$/);
    }
  });

  it("To: Side room sends Play on air from Scene music only to that room, and the buttons say so", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    const music = region("Scene music");
    await userEvent.click(music.getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    expect(music.getByRole("button", { name: /choose a room/i })).toHaveFocus();
    expect(music.getByRole("button", { name: /choose a room/i })).toHaveTextContent(/^To:\s*Side room$/);
    await userEvent.click(music.getByRole("button", { name: "Play on air in Side room: Coast road travel" }));
    await playOn(sound);
    expect(region("On air: Side room").getByText("Playing")).toBeInTheDocument();
    expect(region("On air: Table").getByText("Silent")).toBeInTheDocument();
    // Scenes always start in the first room.
    await userEvent.click(screen.getByRole("button", { name: "Start: Recap and the coast road" }));
    await playOn(sound);
    expect(sound.audio.getNowPlaying().rooms.find((r) => r.roomId === TABLE_BOT)?.music).not.toBeNull();
  });

  it("a pad key plays in the room the Pads box chose", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    await userEvent.click(region("Pads").getByRole("button", { name: "Pads" }));
    await userEvent.click(region("Pads").getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    blur();
    press("1");
    await playOn(sound, 0.5);
    const rooms = sound.audio.getNowPlaying().rooms;
    expect(rooms.find((r) => r.roomId === SIDE_BOT)?.effects.map((e) => e.padKey)).toEqual(["weather/thunder"]);
    expect(rooms.find((r) => r.roomId === TABLE_BOT)?.effects).toEqual([]);
    expect(region("On air: Side room").getByText(/Thunder/)).toBeInTheDocument();
  });

  it("a room's menu offers to copy another room and to leave; Leave takes its box and the To: choices away", async () => {
    const { outputs, sound } = await openLive();
    await addSideRoom(outputs);
    await userEvent.click(region("Scene music").getByRole("button", { name: /choose a room/i }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Side room" }));
    await userEvent.click(region("Scene music").getByRole("button", { name: "Play on air in Side room: Coast road travel" }));
    await playOn(sound);
    await userEvent.click(screen.getByRole("button", { name: "More for Table" }));
    expect(screen.getByRole("menuitem", { name: /Copy what Side room is playing/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "More for Side room" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Leave/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "On air: Side room" })).toBeNull());
    expect(screen.queryByRole("button", { name: /choose a room/i })).toBeNull();
  });

  it("with no room joined the top strip warns that players hear nothing and offers Join Table", async () => {
    const { outputs } = await openLive();
    act(() => outputs.leave(TABLE_BOT));
    expect(await screen.findByText(/players hear nothing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Join Table/ }));
    await act(async () => outputs.settle());
    expect(await screen.findByRole("region", { name: "On air: Table" })).toBeInTheDocument();
    expect(screen.queryByText(/players hear nothing/)).toBeNull();
  });
});

describe("BUG-19: with no room, nobody hears what plays", () => {
  it("the On air box says Silent, then Nobody hears it once something plays there", async () => {
    const { outputs, sound } = await openLive();
    act(() => outputs.leave(TABLE_BOT));
    const box = await findRegion("On air: no room yet");
    expect(box.getAllByText("Silent").length).toBeGreaterThan(0);
    expect(box.queryByText("Nobody hears it")).toBeNull();
    await startAbbey();
    await playOn(sound);
    expect(region("On air: no room yet").getByText("Nobody hears it")).toBeInTheDocument();
    expect(sound.hearSpeakers()).toBe(0);
  });
});

describe("the Now playing bar in Live (UX-16)", () => {
  it("shows only a preview, tagged Only you, because the room boxes show what each room hears", async () => {
    const { sound } = await openLive();
    await startAbbey();
    await playOn(sound);
    expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
    await userEvent.click(region("Scene music").getAllByRole("button", { name: /^Preview: / })[0]);
    await playOn(sound);
    const bar = within(screen.getByRole("region", { name: "Now playing" }));
    expect(bar.getByRole("group", { name: "Only you" })).toHaveTextContent("Previewed from Live");
    expect(bar.queryByRole("group", { name: /^On air/ })).toBeNull();
  });
});
