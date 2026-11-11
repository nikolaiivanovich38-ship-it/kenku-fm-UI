/**
 * Outputs (route `outputs`): the rooms (Discord voice channels) the bots play into, and moving a bot between them on
 * the fly, as design/prototype/src/views/outputs.js shows them. The same behaviours as e2e/specs/outputs.spec.ts, on
 * the fake outputs and a silent audio host.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createFakeLyreApi } from "../../../common/lyre/fake";
import type { LyreOutputs } from "../../../common/lyreOutputs";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { OutputsProvider } from "../../outputs/OutputsProvider";
import { FakeOutputs, PROTOTYPE_OUTPUTS, SIDE_BOT, TABLE_BOT } from "../../outputs/testing/fakeOutputs";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { UndoNoteBar, UndoNoteProvider } from "../../shell/UndoNote";
import { expectNoAxeViolations } from "../../test/axe";
import { OutputsScreen } from "./OutputsScreen";

function open(options: { outputs?: FakeOutputs | null; start?: LyreOutputs } = {}) {
  const outputs = options.outputs === undefined ? new FakeOutputs(options.start) : options.outputs;
  const audio = new FakeLyreAudio();
  render(
    <LyreApiProvider api={createFakeLyreApi()}>
      <LyreAudioProvider audio={audio}>
        <OutputsProvider client={outputs}>
          <ShellSettingsProvider>
            <AnnouncerProvider>
              <main>
                <UndoNoteProvider live={false}>
                  <OutputsScreen />
                  <UndoNoteBar />
                </UndoNoteProvider>
              </main>
            </AnnouncerProvider>
          </ShellSettingsProvider>
        </OutputsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  return { outputs: outputs!, audio };
}

const room = (name: string) => within(screen.getByRole("region", { name }));
const findRoom = async (name: string) => within(await screen.findByRole("region", { name }));
const channels = () => room("All voice channels");
const toast = () => document.getElementById("lyre-toast")?.textContent ?? "";
const sideIn = (channelId: string): LyreOutputs => ({ ...PROTOTYPE_OUTPUTS, bots: [PROTOTYPE_OUTPUTS.bots[0], { ...PROTOTYPE_OUTPUTS.bots[1], room: { serverId: "1001", channelId, status: "connected" } }] });

describe("Outputs: the rooms", () => {
  it("shows a box per bot in a room, named after the room, with its bot, where it is and who hears it", async () => {
    open();
    const table = await findRoom("Table");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rooms");
    expect(table.getByText("Silent")).toBeInTheDocument();
    expect(table.getByText("via Lyre Table")).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Room The Gull and Lantern › Table" })).toHaveAttribute("aria-haspopup", "menu");
    expect(table.getByText("Hears it")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Table" })).toHaveTextContent("5 people: Nik, Aster, Bram, Corin, Dalia");
  });

  it("gives a bot that is in no room its own box saying Not in a room, with Choose a room…", async () => {
    open();
    const side = await findRoom("Lyre Side");
    expect(side.getByText("Not in a room")).toBeInTheDocument();
    expect(side.getByRole("button", { name: "Room Choose a room…" })).toBeInTheDocument();
    expect(side.queryByText("Hears it")).toBeNull();
  });

  it("lists every voice channel with who is in it and counts the bots in rooms", async () => {
    open();
    await findRoom("Table");
    const list = screen.getByRole("region", { name: "All voice channels" });
    expect(list).toHaveTextContent("6 channels in 2 servers");
    expect(list).toHaveTextContent("1 of 2 bots in rooms");
    expect(within(list).getByRole("region", { name: "The Gull and Lantern" })).toHaveTextContent("Table5: Nik, Aster, Bram, Corin, DaliaLyre Table");
    expect(channels().getByRole("button", { name: "Add bot to Whispers" })).toBeInTheDocument();
    expect(channels().getByText("AFK")).toBeInTheDocument();
    expect(channels().getByText("1: Ezra")).toBeInTheDocument();
  });

  it("says so plainly while there are no bots, or none yet", async () => {
    open({ outputs: null });
    expect(screen.getByText("Looking for your Discord bots…")).toBeInTheDocument();
  });

  it("tells a bot that is not logged in to go to Settings, and offers no rooms", async () => {
    open({ start: { ...PROTOTYPE_OUTPUTS, bots: [PROTOTYPE_OUTPUTS.bots[0], { ...PROTOTYPE_OUTPUTS.bots[1], login: "offline", name: "Bot 2" }] } });
    const bot = await findRoom("Bot 2");
    expect(bot.getByText("Not connected")).toBeInTheDocument();
    expect(bot.getByText(/Connect it, or give it a new token, in/)).toBeInTheDocument();
    expect(bot.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "#/settings");
    expect(bot.queryByRole("button", { name: /^Room / })).toBeNull();
  });

  it("is accessible", async () => {
    open();
    await findRoom("Table");
    await expectNoAxeViolations();
  });
});

describe("Outputs: moving a bot between rooms", () => {
  it("sends a bot in no room to the one chosen in its Room menu; its box takes the room's name", async () => {
    const { outputs } = open();
    await userEvent.click((await findRoom("Lyre Side")).getByRole("button", { name: "Room Choose a room…" }));
    const menu = within(screen.getByRole("menu", { name: "Room for Lyre Side" }));
    expect(menu.getByRole("menuitemradio", { name: /^Table 5 people Lyre Table is here: players would hear it twice/ })).toHaveAttribute("aria-checked", "false");
    expect(menu.getByRole("menuitemradio", { name: /^Whispers Empty: nobody would hear it/ })).toBeInTheDocument();
    await userEvent.click(menu.getByRole("menuitemradio", { name: /^Side room/ }));
    expect(outputs.calls).toContainEqual(["move", SIDE_BOT, "1012"]);
    expect(toast()).toBe("Lyre Side is joining Side room: nobody there.");
    await act(() => outputs.settle());
    const side = room("Side room");
    expect(side.getByText("via Lyre Side")).toBeInTheDocument();
    // UX-R9: one wording for a room nobody is in, as in Live.
    expect(side.getAllByText("Nobody there").length).toBeGreaterThan(0);
    expect(side.getByRole("button", { name: "Room The Gull and Lantern › Side room" })).toHaveFocus();
  });

  it("moves a bot in a room to another on the fly; its old room goes", async () => {
    const { outputs } = open();
    await userEvent.click((await findRoom("Table")).getByRole("button", { name: /^Room / }));
    expect(screen.getByRole("menuitemradio", { name: /^Table Here now · 5 people/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^Whispers/ }));
    await act(() => outputs.settle());
    expect(room("Whispers").getByText("via Lyre Table")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
  });

  it("works from the keyboard: Enter opens the menu, arrows choose, Enter moves the bot", async () => {
    const { outputs } = open();
    (await findRoom("Lyre Side")).getByRole("button", { name: /^Room / }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("menu", { name: "Room for Lyre Side" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(outputs.calls).toContainEqual(["move", SIDE_BOT, "1012"]);
  });

  it("OUT-7: no Bring…; each bot in a channel has its own Kick, and a channel with no bot has Add bot", async () => {
    open();
    await findRoom("Table");
    expect(channels().queryByRole("button", { name: /^Bring/ })).toBeNull();
    expect(channels().getByRole("button", { name: "Kick Lyre Table from Table" })).toBeInTheDocument();
    expect(channels().queryByRole("button", { name: "Add bot to Table" })).toBeNull();
    expect(channels().getByRole("button", { name: "Add bot to Side room" })).not.toHaveAttribute("aria-haspopup");
  });

  it("OUT-7: with one free bot, Add bot puts it in the channel in one click", async () => {
    const { outputs } = open();
    await findRoom("Table");
    await userEvent.click(channels().getByRole("button", { name: "Add bot to Whispers" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(outputs.calls).toContainEqual(["move", SIDE_BOT, "1013"]);
    await act(() => outputs.settle());
    expect(room("Whispers").getByText("via Lyre Side")).toBeInTheDocument();
  });

  it("OUT-7: with two free bots, Add bot offers a short choice; with none free, the choice says which room the bot leaves", async () => {
    const { outputs } = open({ start: { ...PROTOTYPE_OUTPUTS, bots: [{ ...PROTOTYPE_OUTPUTS.bots[0], room: null }, PROTOTYPE_OUTPUTS.bots[1]] } });
    await findRoom("Lyre Table");
    await userEvent.click(channels().getByRole("button", { name: "Add bot to Whispers" }));
    const items = within(screen.getByRole("menu", { name: "Add a bot to Whispers" })).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Lyre Table ", "Lyre Side "]);
    await userEvent.click(items[1]);
    expect(outputs.calls).toContainEqual(["move", SIDE_BOT, "1013"]);
    act(() => outputs.push(sideIn("1012")));
    await userEvent.click(channels().getByRole("button", { name: "Add bot to Whispers" }));
    expect(within(screen.getByRole("menu", { name: "Add a bot to Whispers" })).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Lyre Table Leaves Table", "Lyre Side Leaves Side room"]);
  });
  it("UX-R4: after Add, focus is on the new bot's Kick in that channel's row; after Kick, on the row's Add", async () => {
    const { outputs } = open();
    await findRoom("Table");
    await userEvent.click(channels().getByRole("button", { name: "Add bot to Whispers" }));
    await act(() => outputs.settle());
    await waitFor(() => expect(channels().getByRole("button", { name: "Kick Lyre Side from Whispers" })).toHaveFocus());
    await userEvent.click(room("Table").getByRole("button", { name: "Kick Lyre Table from Table" }));
    await act(() => outputs.settle());
    await waitFor(() => expect(channels().getByRole("button", { name: "Add bot to Table" })).toHaveFocus());
  });

  it("swaps two bots' rooms with one button once both are in rooms", async () => {
    const { outputs } = open({ start: sideIn("1012") });
    await findRoom("Side room");
    await userEvent.click(screen.getByRole("button", { name: "Swap rooms" }));
    expect(outputs.calls).toEqual([
      ["move", TABLE_BOT, "1012"],
      ["move", SIDE_BOT, "1011"],
    ]);
    await act(() => outputs.settle());
    expect(room("Table").getByText("via Lyre Side")).toBeInTheDocument();
    expect(room("Side room").getByText("via Lyre Table")).toBeInTheDocument();
  });

  it("Kick takes a bot out of its room at once and gives it a Not in a room box again", async () => {
    open();
    await userEvent.click((await findRoom("Table")).getByRole("button", { name: "Kick Lyre Table from Table" }));
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
    expect(room("Lyre Table").getByText("Not in a room")).toBeInTheDocument();
    expect(toast()).toBe("Lyre Table left Table");
    // The players heard nothing: there is nothing to undo.
    expect(screen.queryByRole("group", { name: "Undo" })).toBeNull();
  });

  it("OUT-7: kicking a bot the players are hearing asks nothing, and Undo puts it back with its music, from where it was", async () => {
    const { outputs, audio } = open();
    await findRoom("Table");
    act(() => audio.setNowPlaying({ rooms: [{ roomId: TABLE_BOT, name: "Table", music: { trackId: "t-anthem", title: "Epic choir hero anthem", origin: { kind: "playlist", playlistId: "p-company", at: 0 } as never, playlistId: "p-company", position: 12, length: 120, paused: false, loading: false }, ambience: null, upNext: null, queued: [], effects: [] }], broadcasting: true }));
    await userEvent.click(channels().getByRole("button", { name: "Kick Lyre Table from Table" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(outputs.calls).toContainEqual(["leave", TABLE_BOT]);
    const undo = within(screen.getByRole("group", { name: "Undo" }));
    expect(screen.getByRole("group", { name: "Undo" })).toHaveTextContent("Lyre Table left Table: the players there hear nothing now.");
    // The room goes with its bot (another bot is still in a room, so its music stops), and comes back empty.
    act(() => audio.setNowPlaying({ rooms: [], broadcasting: true }));
    await userEvent.click(undo.getByRole("button", { name: "Undo" }));
    expect(outputs.calls).toContainEqual(["move", TABLE_BOT, "1011"]);
    act(() => audio.setNowPlaying({ rooms: [{ roomId: TABLE_BOT, name: "Table", music: null, ambience: null, upNext: null, queued: [], effects: [] }], broadcasting: true }));
    await waitFor(() => expect(audio.calls).toContainEqual(["playTrack", "t-anthem", { target: { room: TABLE_BOT }, from: { playlistId: "p-company" }, fromMs: 12000, fadeMs: 1000 }]));
  });

  it("Must 2: moving away from players who hear something has the same Undo, back to where it was", async () => {
    const { outputs, audio } = open();
    await findRoom("Table");
    act(() => audio.setNowPlaying({ rooms: [{ roomId: TABLE_BOT, name: "Table", music: { trackId: "t13", title: "Bridge of Death", origin: { kind: "single" } as never, playlistId: null, position: 1, length: 9, paused: false, loading: false }, ambience: null, upNext: null, queued: [], effects: [] }], broadcasting: true }));
    await userEvent.click(room("Table").getByRole("button", { name: /^Room / }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /^Side room/ }));
    expect(screen.getByRole("group", { name: "Undo" })).toHaveTextContent("Lyre Table moved from Table: the players there hear nothing now.");
    await act(() => outputs.settle());
    await userEvent.click(within(screen.getByRole("group", { name: "Undo" })).getByRole("button", { name: "Undo" }));
    expect(outputs.calls[outputs.calls.length - 1]).toEqual(["move", TABLE_BOT, "1011"]);
  });

  it("Must 2: a room in a channel with nobody in it says so and moves to the players in one click", async () => {
    const { outputs } = open({ start: { ...PROTOTYPE_OUTPUTS, bots: [{ ...PROTOTYPE_OUTPUTS.bots[0], room: { serverId: "1001", channelId: "1012", status: "connected" } }, PROTOTYPE_OUTPUTS.bots[1]] } });
    const side = await findRoom("Side room");
    expect(side.getByText("Players hear nothing")).toBeInTheDocument();
    expect(side.getAllByText("Nobody there").length).toBeGreaterThan(0);
    const move = side.getByRole("button", { name: "Move to Table" });
    expect(move).toHaveAttribute("title", "Lyre Table moves to The Gull and Lantern › Table (5 people)");
    await userEvent.click(move);
    expect(outputs.calls).toContainEqual(["move", TABLE_BOT, "1011"]);
  });

  it("warns when two bots share a room, with Kick", async () => {
    open({ start: sideIn("1011") });
    const both = await screen.findAllByRole("region", { name: "Table" });
    expect(both[0]).toHaveTextContent("Lyre Side is in Table too: the players hear both.");
    expect(within(both[0]).getAllByRole("button", { name: "Kick Lyre Table from Table" }).length).toBeGreaterThan(0);
    expect(channels().getAllByText("Lyre Table")).toHaveLength(1);
    expect(channels().queryByRole("button", { name: "Add bot to Table" })).toBeNull();
  });

  it("shows a bot that joins from Discord at once", async () => {
    const { outputs } = open();
    await findRoom("Lyre Side");
    act(() => outputs.push(sideIn("1013")));
    expect(room("Whispers").getByText("via Lyre Side")).toBeInTheDocument();
  });
});

describe("Outputs: mute, volume, test and what plays", () => {
  it("Mute stops a room being heard and the status says Muted", async () => {
    const { outputs } = open();
    const table = await findRoom("Table");
    const mute = table.getByRole("button", { name: "Mute Table" });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mute);
    expect(outputs.calls).toContainEqual(["setMuted", TABLE_BOT, true]);
    expect(table.getByText("Muted")).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Mute Table" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has a volume slider per room that shows its percentage", async () => {
    const { outputs } = open();
    const volume = (await findRoom("Table")).getByRole("slider", { name: "Volume" });
    expect(volume).toHaveValue("85");
    expect(volume).toHaveAttribute("aria-valuetext", "85%");
    fireEvent.change(volume, { target: { value: "80" } });
    expect(volume).toHaveValue("80");
    expect(screen.getByRole("region", { name: "Table" })).toHaveTextContent("80%");
    expect(outputs.calls).toContainEqual(["setVolume", TABLE_BOT, 0.8]);
  });

  it("Test plays a short chime in that room only and says so, or says why not", async () => {
    const { audio } = open();
    await userEvent.click((await findRoom("Table")).getByRole("button", { name: "Test Table: a short chime in this room only" }));
    expect(audio.calls).toContainEqual(["testChime", TABLE_BOT]);
    expect(toast()).toBe("Test chime in Table only (5 people there)");
    await userEvent.click(room("Lyre Side").getByRole("button", { name: "Test Lyre Side: a short chime in this room only" }));
    expect(toast()).toBe("Lyre Side is not in a voice channel. Choose a room first.");
    expect(audio.calls.filter((c) => c[0] === "testChime")).toHaveLength(1);
  });

  it("shows what a room plays, On air, and Playing in its pill", async () => {
    const { audio } = open();
    await findRoom("Table");
    act(() =>
      audio.setNowPlaying({
        rooms: [{ roomId: TABLE_BOT, name: "Table", music: { trackId: "t13", title: "Bridge of Death", origin: { kind: "single" } as never, playlistId: null, position: 30, length: 120, paused: false, loading: false }, ambience: null, upNext: null, queued: [], effects: [] }],
        broadcasting: true,
      }),
    );
    const table = room("Table");
    await waitFor(() => expect(screen.getByRole("region", { name: "Table" }).querySelector(".pane-status")).toHaveTextContent("Playing"));
    expect(table.getByText("Bridge of Death")).toBeInTheDocument();
    expect(table.getByText("On air")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Table" })).not.toHaveClass("is-silent");
    expect(room("Lyre Side").queryByText("On air")).toBeNull();
  });

  it("OUT-10: a level meter beside each room's volume moves while the room plays, and rests while it is muted", async () => {
    const { audio, outputs } = open();
    await findRoom("Table");
    const bar = () => (screen.getByTestId(`meter-${TABLE_BOT}`).firstElementChild as HTMLElement).style.width;
    audio.levels[TABLE_BOT] = 1;
    await waitFor(() => expect(bar()).toBe("100%"));
    audio.levels[TABLE_BOT] = 0;
    await waitFor(() => expect(bar()).toBe("0%"));
    audio.levels[TABLE_BOT] = 1;
    await userEvent.click(room("Table").getByRole("button", { name: "Mute Table" }));
    expect(outputs.calls).toContainEqual(["setMuted", TABLE_BOT, true]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(bar()).toBe("0%");
    expect(screen.getByTestId(`meter-${TABLE_BOT}`)).toHaveAttribute("aria-hidden", "true");
  });

  it("OUT-8: Tokens and new bots goes to Settings in Lyre", async () => {
    open();
    await findRoom("Table");
    expect(channels().getByRole("link", { name: "Tokens and new bots" })).toHaveAttribute("href", "#/settings");
  });

  it("has the Prep | Live switch, with Prep pressed", async () => {
    open();
    const modes = within(await screen.findByRole("group", { name: "Prep or live" }));
    expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    expect(modes.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
  });
});
