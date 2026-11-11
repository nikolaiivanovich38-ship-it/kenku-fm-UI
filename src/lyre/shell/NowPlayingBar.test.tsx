/**
 * UX-16 the Now playing bar (core.js onAirBar, roomRow, previewRow): at the foot of every screen while anything plays
 * or is paused, one row per room that plays and one for the preview, each tagged with where its sound goes.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { UsePlace } from "../../common/domain";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
import { LyreAudioProvider } from "../audio";
import { FakeLyreAudio, type FakeLane, type FakeNowPlaying } from "../audio/testing/fakeLyreAudio";
import { OutputsProvider } from "../outputs/OutputsProvider";
import { FakeOutputs, PROTOTYPE_OUTPUTS, TABLE_BOT } from "../outputs/testing/fakeOutputs";
import { expectNoAxeViolations } from "../test/axe";
import { AnnouncerProvider } from "./Announcer";
import { NowPlayingBar } from "./NowPlayingBar";

const crown: UsePlace = { kind: "campaign", campaignId: "crown" };
const ruins: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc3" };
const aftermath: UsePlace = { kind: "scene", campaignId: "crown", sessionId: "s14", sceneId: "sc6" };

const lane = (over: Partial<FakeLane> = {}): FakeLane => ({
  trackId: "t24",
  title: "Epic choir hero anthem - the Company's big moment",
  origin: { kind: "playlist", playlistId: "p-company", at: 0, place: crown },
  playlistId: "p-company",
  position: 12,
  length: 237,
  paused: false,
  loading: false,
  place: crown,
  playOrder: { shuffle: false, repeat: "all" },
  ...over,
});
type FakeRoom = NonNullable<FakeNowPlaying["rooms"]>[number];
const room = (roomId: string, name: string, music: FakeLane | null, more: Partial<FakeRoom> = {}): FakeRoom => ({
  roomId,
  name,
  music,
  ambience: null,
  upNext: null,
  queued: [],
  effects: [],
  ...more,
});

function show(state: FakeNowPlaying, previewOnly = false, outputs: FakeOutputs | null = null) {
  const audio = new FakeLyreAudio();
  audio.setNowPlaying({ broadcasting: true, ...state });
  render(
    <LyreApiProvider api={createFakeLyreApi()}>
      <LyreAudioProvider audio={audio}>
        <OutputsProvider client={outputs}>
          <AnnouncerProvider>
            <main id="view">
              <h1>The Sunken Crown</h1>
              <button type="button">Elsewhere</button>
              <NowPlayingBar previewOnly={previewOnly} />
            </main>
          </AnnouncerProvider>
        </OutputsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  return audio;
}

const bar = () => screen.getByRole("region", { name: "Now playing" });
const said = () => document.getElementById("lyre-live")?.textContent ?? "";

describe("when it shows", () => {
  it("is not there while nothing plays, nor for effects alone (they are short)", () => {
    const audio = show({ rooms: [room("table", "Table", null, { effects: [{ trackId: "t60", title: "Thunder", padKey: null }] })] });
    expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
    act(() => audio.setNowPlaying({ rooms: [room("table", "Table", lane())] }));
    expect(bar()).toBeInTheDocument();
  });

  it("stays while paused", () => {
    show({ rooms: [room("table", "Table", lane({ paused: true }))] });
    expect(within(bar()).getByRole("group", { name: "Paused" })).toBeInTheDocument();
  });
});

describe("a room's row: what the players hear", () => {
  it("has the On air tag, the track, where it comes from, how far, and that room's controls", async () => {
    show({ rooms: [room("table", "Table", lane())] });
    const row = within(bar()).getByRole("group", { name: "On air" });
    expect(within(row).getByTitle("The players hear this")).toHaveTextContent(/^On air$/);
    expect(row).toHaveTextContent("Epic choir hero anthem - the Company's big moment");
    await waitFor(() => expect(row).toHaveTextContent("Playlist: The Company themes · The Sunken Crown"));
    expect(row).toHaveTextContent("0:12 / 3:57");
    expect(within(row).getByRole("slider", { name: "Volume in Table" })).toHaveValue("85");
    expect(within(row).getByRole("slider", { name: "Volume in Table" })).toHaveAttribute("aria-valuetext", "85 percent");
    expect(await within(row).findByRole("button", { name: "Shuffle" })).toHaveAttribute("aria-pressed", "false");
    expect(within(row).getByRole("link", { name: "Go to Live" })).toHaveAttribute("href", "#/live");
    expect(within(row).getByRole("group", { name: "Control what the players hear in Table" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Pause" })).toHaveAttribute("title", "Pause the music in Table");
    expect(within(row).getByRole("button", { name: "Stop" })).toHaveAttribute("title", "Stop what the players hear in Table (fades out in a second)");
    expect(within(row).getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("Pause, Next, Stop and Volume act on that room only", async () => {
    const audio = show({ rooms: [room("table", "Table", lane()), room("side", "Side room", lane({ trackId: "t08", title: "Heroic charge" }))] });
    const side = within(bar()).getByRole("group", { name: "On air: Side room" });
    await userEvent.click(within(side).getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(said()).toBe("Paused"));
    await userEvent.click(within(side).getByRole("button", { name: "Next" }));
    await userEvent.click(within(side).getByRole("button", { name: "Stop" }));
    fireEvent.change(within(side).getByRole("slider", { name: "Volume in Side room" }), { target: { value: "60" } });
    expect(audio.calls.filter(([m]) => m !== "setLibrary")).toEqual([
      ["togglePause", "music", { room: "side" }],
      ["next", "music", { room: "side" }],
      ["stopLane", "music", { target: { room: "side" }, fadeMs: 1000 }],
      ["stopLane", "ambience", { target: { room: "side" }, fadeMs: 1000 }],
      ["setRoomVolume", { room: "side" }, 0.6],
    ]);
    await waitFor(() => expect(said()).toBe("Stopped"));
  });

  it("one volume per room: a bot's room changes the bot's volume, and before the bot is known nothing (security review w4, Should 4)", async () => {
    const outputs = new FakeOutputs({ ...PROTOTYPE_OUTPUTS, bots: [] });
    const audio = show({ rooms: [room(TABLE_BOT, "Table", lane())] }, false, outputs);
    const slider = within(bar()).getByRole("slider", { name: "Volume in Table" });
    fireEvent.change(slider, { target: { value: "40" } });
    expect(audio.calls.filter(([m]) => m === "setRoomVolume")).toEqual([]);
    act(() => outputs.push(PROTOTYPE_OUTPUTS));
    await waitFor(() => expect(slider).toHaveValue("85"));
    fireEvent.change(slider, { target: { value: "60" } });
    expect(outputs.calls).toContainEqual(["setVolume", TABLE_BOT, 0.6]);
    expect(audio.calls.filter(([m]) => m === "setRoomVolume")).toEqual([]);
  });

  it("paused: the tag turns grey, a Paused badge stands beside it, and Play carries on", async () => {
    const audio = show({ rooms: [room("table", "Table", lane({ paused: true }))] });
    const row = within(bar()).getByRole("group", { name: "Paused" });
    expect(within(row).getByTitle("The players hear this")).toHaveClass("dest", "air", "paused");
    expect(within(row).getByText("Paused", { selector: ".badge" })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Play" }));
    expect(audio.calls).toContainEqual(["togglePause", "music", { room: "table" }]);
    await waitFor(() => expect(said()).toBe("Playing again"));
  });

  it("a single track says so, has no Next and no play order", async () => {
    show({ rooms: [room("table", "Table", lane({ origin: { kind: "single" }, playlistId: null, place: null, playOrder: null }))] });
    const row = within(bar()).getByRole("group", { name: "On air" });
    expect(row).toHaveTextContent("Single track");
    expect(within(row).getByRole("button", { name: "Next" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Next" })).toHaveAttribute("title", "A single track has no next one");
    expect(within(row).queryByRole("button", { name: /^Play order/ })).toBeNull();
  });

  it("from a scene: the scene and its playlist, and the scene's name for the track with its own name on hover", async () => {
    show({
      rooms: [
        room("table", "Table", lane({ trackId: "t13", title: "Bridge of Death", playlistId: "p-abbey-eerie", place: ruins, origin: { kind: "scene", scene: ruins, at: 1 } })),
        room("side", "Side room", lane({ trackId: "t07", title: "Release after loss", playlistId: null, place: aftermath, origin: { kind: "scene", scene: aftermath, at: 0 } })),
      ],
    });
    const table = within(bar()).getByRole("group", { name: "On air: Table" });
    await waitFor(() => expect(table).toHaveTextContent("Scene: The abbey ruins (Session 14) · Abbey: eerie, low energy"));
    const side = within(bar()).getByRole("group", { name: "On air: Side room" });
    await waitFor(() => expect(within(side).getByTitle(/^Its own name: Release after loss( · |$)/)).toHaveTextContent("Dawn over the abbey"));
    expect(side).toHaveTextContent("Scene: Aftermath (Session 14)");
  });

  it("names the ambience under the music, and how many effects sound in that room", () => {
    show({
      rooms: [
        room("table", "Table", lane(), {
          ambience: lane({ trackId: "t40", title: "Rain on the roof", playlistId: null, place: null, origin: { kind: "single" } }),
          effects: [
            { trackId: "t60", title: "Thunder", padKey: null },
            { trackId: "t61", title: "Door", padKey: null },
          ],
        }),
      ],
    });
    const row = within(bar()).getByRole("group", { name: "On air" });
    expect(row).toHaveTextContent("Ambience: Rain on the roof");
    expect(row).toHaveTextContent("2 effects sounding");
  });

  it("ambience alone has a row of its own, controlling the ambience", async () => {
    const audio = show({ rooms: [room("table", "Table", null, { ambience: lane({ trackId: "t40", title: "Rain on the roof", playlistId: null, place: null, origin: { kind: "single" } }) })] });
    const row = within(bar()).getByRole("group", { name: "On air" });
    expect(row).toHaveTextContent("Rain on the roof");
    await userEvent.click(within(row).getByRole("button", { name: "Pause" }));
    expect(audio.calls).toContainEqual(["togglePause", "ambience", { room: "table" }]);
  });

  it("with two rooms, one row each, named in the tag; Go to Live on the first row only", () => {
    show({ rooms: [room("table", "Table", lane()), room("side", "Side room", lane()), room("quiet", "Quiet", null)] });
    const rows = within(bar()).getAllByRole("group", { name: /^On air: / });
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTitle("The players hear this in Table")).toHaveTextContent("On air · Table");
    expect(within(rows[1]).getByTitle("The players hear this in Side room")).toHaveTextContent("On air · Side room");
    expect(within(bar()).getAllByRole("link", { name: "Go to Live" })).toHaveLength(1);
    expect(within(rows[0]).getByRole("link", { name: "Go to Live" })).toBeInTheDocument();
  });

  it("with no bot in a voice channel, says there is no room and nobody hears it (BUG-19)", () => {
    show({ broadcasting: false, rooms: [room("table", "Table", lane())] });
    const row = within(bar()).getByRole("group", { name: "On air: no room" });
    expect(within(row).getByTitle("The players hear this in no room")).toHaveTextContent("On air · no room");
    expect(row).toHaveTextContent("No bot is in a voice channel: nobody hears it");
    expect(row).not.toHaveTextContent(/this computer/);
    expect(within(row).getByRole("slider", { name: "Volume in Table" })).toBeInTheDocument();
  });
});

describe("the preview's row: only you hear it", () => {
  const preview = { key: "pl:p-ashen", label: "Ashen King", from: "the campaign page", position: 5, length: 180, volume: 0.8 };

  it("has the Only you tag, what previews, where from, how far, and its own Pause, Stop and headphone volume", async () => {
    const audio = show({ rooms: [room("table", "Table", lane())], preview });
    const you = within(bar()).getByRole("group", { name: "Only you" });
    expect(within(you).getByTitle("Only you hear this, in your headphones")).toHaveTextContent(/^Only you$/);
    expect(you).toHaveTextContent("Ashen King");
    expect(you).toHaveTextContent("Previewed from the campaign page");
    expect(you).toHaveTextContent("0:05 / 3:00");
    expect(within(you).getByRole("slider", { name: "Headphone volume" })).toHaveValue("80");
    expect(within(you).queryByRole("link", { name: "Go to Live" })).toBeNull();
    await userEvent.click(within(you).getByRole("button", { name: "Pause the preview" }));
    await userEvent.click(within(you).getByRole("button", { name: "Stop the preview" }));
    fireEvent.change(within(you).getByRole("slider", { name: "Headphone volume" }), { target: { value: "55" } });
    expect(audio.calls.filter(([m]) => m !== "setLibrary")).toEqual([["togglePreviewPause"], ["stopPreview"], ["setPreviewVolume", 0.55]]);
    // Both rows show at once: the players' music goes on.
    expect(within(bar()).getByRole("group", { name: "On air" })).toBeInTheDocument();
  });

  it("paused: grey tag, Paused badge, Play the preview", () => {
    show({ preview: { ...preview, paused: true } });
    const you = within(bar()).getByRole("group", { name: "Only you: paused" });
    expect(within(you).getByTitle("Only you hear this, in your headphones")).toHaveClass("paused");
    expect(within(you).getByText("Paused", { selector: ".badge" })).toBeInTheDocument();
    expect(within(you).getByRole("button", { name: "Play the preview" })).toBeInTheDocument();
  });

  it("a preview with nowhere given says Preview", () => {
    show({ preview: { key: "t13", label: "Bridge of Death" } });
    expect(within(bar()).getByRole("group", { name: "Only you" })).toHaveTextContent("Preview");
  });

  it("in Live, which shows each room itself, the bar has the preview row only", () => {
    const audio = show({ rooms: [room("table", "Table", lane())] }, true);
    expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
    act(() => audio.setNowPlaying({ preview }));
    expect(within(bar()).getByRole("group", { name: "Only you" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("group", { name: /^On air/ })).toBeNull();
  });
});

describe("keyboard focus", () => {
  it("goes to the screen's heading when the bar goes away under it", async () => {
    const audio = show({ rooms: [room("table", "Table", lane())] });
    within(bar()).getByRole("button", { name: "Stop" }).focus();
    await userEvent.keyboard("{Enter}");
    act(() => audio.setNowPlaying({ rooms: [room("table", "Table", null)] }));
    expect(screen.queryByRole("region", { name: "Now playing" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("stays in the bar when only the row it was in goes away", async () => {
    const audio = show({ rooms: [room("table", "Table", lane())], preview: { key: "t13", label: "Bridge of Death" } });
    within(bar()).getByRole("button", { name: "Stop the preview" }).focus();
    await userEvent.keyboard("{Enter}");
    act(() => audio.setNowPlaying({ preview: null }));
    expect(within(bar()).getByRole("button", { name: "Pause" })).toHaveFocus();
  });

  it("is left alone when it was somewhere else", () => {
    const audio = show({ rooms: [room("table", "Table", lane())] });
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    act(() => audio.setNowPlaying({ rooms: [room("table", "Table", null)] }));
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });
});

it("has no accessibility failures with a room, two rooms and the preview", async () => {
  show({ rooms: [room("table", "Table", lane()), room("side", "Side room", lane({ paused: true }))], preview: { key: "pl:p-ashen", label: "Ashen King", from: "the campaign page" } });
  await screen.findAllByRole("button", { name: "Shuffle" });
  await expectNoAxeViolations(document.body);
});

describe("volume normalisation (PLY-15)", () => {
  it("a row's track name says on hover how much its volume is evened out where it plays, for the players and for a preview", async () => {
    const ashen = lane({ trackId: "t18", title: "Gothic menace, pounding low brass - villain reveal", playlistId: "p-ashen", origin: { kind: "playlist", playlistId: "p-ashen", at: 0, place: crown } });
    show({
      rooms: [room("table", "Table", ashen)],
      preview: { key: "t18", label: "Ashen King: Gothic menace, pounding low brass - villain reveal", trackId: "t18", playlistId: "p-ashen" },
    });
    const air = within(bar()).getByRole("group", { name: "On air" });
    expect(await within(air).findByTitle("Gothic menace, pounding low brass - villain reveal · Volume evened out: -2.2 dB (-15.8 LUFS measured)")).toBeInTheDocument();
    const you = within(bar()).getByRole("group", { name: "Only you" });
    expect(within(you).getByTitle(/· Volume evened out: -2\.2 dB/)).toBeInTheDocument();
  });

  it("says so when it plays as it is", async () => {
    show({ rooms: [room("table", "Table", lane())] });
    expect(await within(bar()).findByTitle(/· Volume not evened out$/)).toBeInTheDocument();
  });
});

describe("round 6 and 7: Shuffle, Repeat and What played on a room's row", () => {
  it("Shuffle is the playlist's own shuffle where it plays from (saved), pressed while on", async () => {
    show({ rooms: [room("table", "Table", lane())] });
    const shuffle = await within(bar()).findByRole("button", { name: "Shuffle" });
    expect(shuffle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(shuffle);
    await waitFor(() => expect(within(bar()).getByRole("button", { name: "Shuffle" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("PLY-17: Repeat is the room's, for what plays now: it shows what applies and goes off, all, one", async () => {
    const audio = show({ rooms: [room("table", "Table", lane(), { repeat: { chosen: null, shown: "all" } })] });
    const repeat = within(bar()).getByRole("button", { name: "Repeat: all" });
    expect(repeat).toHaveAttribute("aria-pressed", "true");
    expect(repeat).toHaveAttribute("title", expect.stringMatching(/not saved/));
    await userEvent.click(repeat);
    expect(audio.calls).toContainEqual(["cycleRepeat", { room: "table" }]);
  });

  it("PLY-1: What played opens the room's tracks, newest first, with Play again and Play next; Play again closes it", async () => {
    const audio = show({
      rooms: [
        room("table", "Table", lane(), {
          played: [
            { trackId: "t24", title: "Epic choir hero anthem - the Company's big moment", at: Date.now(), from: { playlistId: "p-company", place: crown } },
            { trackId: "t23", title: "Heroic charge", at: Date.now() - 120_000, from: { playlistId: "p-company", place: crown } },
          ],
        }),
      ],
    });
    await userEvent.click(within(bar()).getByRole("button", { name: "What played" }));
    const dialog = screen.getByRole("dialog", { name: "What played" });
    const items = within(within(dialog).getByRole("list", { name: "Played, newest first" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Epic choir hero anthem");
    expect(items[1]).toHaveTextContent("2 min ago");
    expect(within(items[1]).getByRole("button", { name: /^Play next: / })).toBeInTheDocument();
    await userEvent.click(within(items[1]).getByRole("button", { name: /^Play again: / }));
    expect(audio.calls).toContainEqual(["playTrack", "t23", expect.objectContaining({ target: { room: "table" }, from: { playlistId: "p-company", place: crown } })]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

