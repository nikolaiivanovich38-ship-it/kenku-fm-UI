/**
 * Settings (route `settings`, OUT-8 and round 7): the same behaviours as e2e/specs/settings.spec.ts, on the fake
 * outputs, library, remote control and main-window settings.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../../../common/lyre/fake";
import type { RemoteBridge, RemoteState } from "../../../common/remoteControl";
import { DEFAULT_WINDOW_SETTINGS, type WindowSettings } from "../../../common/windowSettings";
import { LyreApiProvider } from "../../api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { OutputsProvider } from "../../outputs/OutputsProvider";
import { FakeOutputs, PROTOTYPE_OUTPUTS, SIDE_BOT } from "../../outputs/testing/fakeOutputs";
import { SettingsAppliers } from "../../settings/SettingsAppliers";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { UndoNoteBar, UndoNoteProvider } from "../../shell/UndoNote";
import { expectNoAxeViolations } from "../../test/axe";
import type { LyreWindowSettingsBridge } from "../../windowSettings/preloadWindowSettings";
import { SettingsBridgesProvider } from "./common";
import { SettingsScreen } from "./SettingsScreen";

// UX-R16: the version webpack builds in (none in tests unless given).
vi.mock("../../version", () => ({ LYRE_VERSION: "0.5.0" }));

function fakeRemote(home: string | null = "192.168.1.20") {
  let state: RemoteState = { enabled: false, running: false, address: "127.0.0.1", port: 3333, code: "K7QD-92XF", codeRemembered: true, homeAddress: home };
  const remote: RemoteBridge = {
    get: async () => state,
    set: vi.fn(async (change) => (state = { ...state, ...change, running: change.enabled ?? state.enabled })),
    newCode: async () => (state = { ...state, code: "WXYZ-2345" }),
    onChange: () => () => undefined,
  };
  return remote;
}

function fakeWindow(start: WindowSettings = DEFAULT_WINDOW_SETTINGS) {
  let state = start;
  const listeners = new Set<(s: WindowSettings) => void>();
  const bridge: LyreWindowSettingsBridge & { folders: string[] } = {
    folders: ["H:\\Audio\\Incoming"],
    get: async () => state,
    set: vi.fn(async (change) => {
      state = { ...state, ...change };
      listeners.forEach((l) => l(state));
      return true;
    }),
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    localFolders: async () => bridge.folders,
    forgetLocalFolder: vi.fn(async (f) => (bridge.folders = bridge.folders.filter((x) => x !== f))),
    clearWebsiteData: vi.fn(async () => undefined),
  };
  return bridge;
}

function open(start?: ConstructorParameters<typeof FakeOutputs>[0]) {
  localStorage.clear();
  const outputs = new FakeOutputs(start);
  const api = createFakeLyreApi();
  const audio = new FakeLyreAudio();
  const remote = fakeRemote();
  const win = fakeWindow();
  render(
    <LyreApiProvider api={api}>
      <LyreAudioProvider audio={audio}>
        <OutputsProvider client={outputs}>
          <SettingsAppliers keys={null}>
            <ShellSettingsProvider>
              <AnnouncerProvider>
                <SettingsBridgesProvider value={{ remote, windowSettings: win }}>
                  <main>
                    <UndoNoteProvider live={false}>
                      <SettingsScreen />
                      <UndoNoteBar />
                    </UndoNoteProvider>
                  </main>
                </SettingsBridgesProvider>
              </AnnouncerProvider>
            </ShellSettingsProvider>
          </SettingsAppliers>
        </OutputsProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
  return { outputs, api, audio, remote, win };
}

const region = (name: string) => within(screen.getByRole("region", { name }));
const bot = async (name: string) => within(await within(screen.getByRole("region", { name: "Discord bots" })).findByRole("group", { name }));
const toast = () => document.getElementById("lyre-toast")?.textContent ?? "";
async function unfold(name: string) {
  const b = region(name).getByRole("button", { name });
  if (b.getAttribute("aria-expanded") !== "true") await userEvent.click(b);
  return region(name);
}

describe("Settings › Discord bots (OUT-8)", () => {
  it("lists each bot with its status, its servers and only its token's last four characters", async () => {
    open();
    const table = await bot("Lyre Table");
    expect(table.getByText("Connected")).toBeInTheDocument();
    expect(table.getByText("The Gull and Lantern, Night court")).toBeInTheDocument();
    expect(table.getByText("••••••••Kq7w")).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Replace the token of Lyre Table" })).toBeInTheDocument();
  });

  it("Disconnect and Connect", async () => {
    const { outputs } = open();
    const side = await bot("Lyre Side");
    await userEvent.click(side.getByRole("button", { name: "Disconnect" }));
    expect(side.getByText("Not connected")).toBeInTheDocument();
    await userEvent.click(side.getByRole("button", { name: "Connect" }));
    expect(outputs.calls).toContainEqual(["connect", SIDE_BOT]);
  });

  it("Replace… sends the new token to the main process and shows only its last four characters", async () => {
    const { outputs } = open();
    const side = await bot("Lyre Side");
    await userEvent.click(side.getByRole("button", { name: "Replace the token of Lyre Side" }));
    await userEvent.type(side.getByLabelText("New token for Lyre Side"), "MTAx.secret-part.wxyz");
    await userEvent.click(side.getByRole("button", { name: "Save" }));
    expect(outputs.calls).toContainEqual(["replaceToken", SIDE_BOT, "wxyz"]);
    await waitFor(() => expect(side.getByText("••••••••wxyz")).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("secret-part");
    expect(toast()).toBe("Saved: Lyre Side token");
  });

  it("Remove is behind the bot's ⋯ menu, with an Undo that puts it back", async () => {
    const { outputs } = open();
    await bot("Lyre Side");
    await userEvent.click(screen.getByRole("button", { name: "More for Lyre Side" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove Lyre Side" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Lyre Side" })).toBeNull());
    await userEvent.click(within(screen.getByRole("group", { name: "Undo" })).getByRole("button", { name: "Undo" }));
    expect(outputs.calls).toContainEqual(["restore", SIDE_BOT]);
    expect(await bot("Lyre Side")).toBeTruthy();
  });

  it("Add a bot: three steps in Discord's order; the invite before the token; then it says where the bot is", async () => {
    const { outputs } = open();
    await bot("Lyre Table");
    await userEvent.click(screen.getByRole("button", { name: "Add a bot" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByRole("heading")).toHaveTextContent("Add a bot: step 1 of 3");
    expect(sheet.getByRole("list", { name: "Steps" })).toHaveTextContent(/Create it.*Invite it.*Connect it/);
    expect(sheet.getByRole("link", { name: "Open the Discord Developer Portal" })).toHaveAttribute("href", "https://discord.com/developers/applications");
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    expect(sheet.getByRole("heading")).toHaveTextContent("Add a bot: step 2 of 3");
    expect(sheet.getByRole("link", { name: "Open the invite" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.type(sheet.getByLabelText("Application ID"), "123456789012345678");
    const invite = sheet.getByRole("link", { name: "Open the invite" });
    expect(invite).toHaveAttribute("href", "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=3146752");
    await userEvent.click(invite);
    expect(outputs.calls).toContainEqual(["openInvite", "123456789012345678"]);
    await userEvent.click(sheet.getByRole("button", { name: "Or make the invite by hand" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Bot Permissions: View Channels, Connect, Speak");
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Discord shows it once.");
    await userEvent.type(sheet.getByLabelText("Token"), "MTAx.new-bot.abcd");
    await userEvent.click(sheet.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(sheet.getByRole("status")).toHaveTextContent("Lyre Third is connected. In The Gull and Lantern."));
    await userEvent.click(sheet.getByRole("button", { name: "Done" }));
    expect((await bot("Lyre Third")).getByText("••••••••abcd")).toBeInTheDocument();
  });

  it("a bot connected before it was invited says it is in no server yet, with the invite again", async () => {
    open();
    await bot("Lyre Table");
    await userEvent.click(screen.getByRole("button", { name: "Add a bot" }));
    const sheet = within(screen.getByRole("dialog"));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    await userEvent.type(sheet.getByLabelText("Application ID"), "123456789012345678");
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    await userEvent.type(sheet.getByLabelText("Token"), "MTAx.new-bot.abcd");
    await userEvent.click(sheet.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(sheet.getByRole("status")).toHaveTextContent("It is in no server yet."));
    expect(sheet.getByRole("link", { name: "Invite it" })).toHaveAttribute("href", expect.stringMatching(/client_id=123456789012345678&scope=bot&permissions=3146752$/));
  });

  it("UX-R11: an Application ID that is not a long number says so under the field, and Open the invite stays off", async () => {
    open();
    await bot("Lyre Table");
    await userEvent.click(screen.getByRole("button", { name: "Add a bot" }));
    const sheet = within(screen.getByRole("dialog"));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    const field = sheet.getByLabelText("Application ID");
    await userEvent.type(field, "abc123");
    expect(field).toHaveValue("abc123");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("An Application ID is a long number: copy it from General Information.");
    expect(sheet.getByRole("link", { name: "Open the invite" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.clear(field);
    await userEvent.type(field, " 123456789012345678 ");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(sheet.getByRole("link", { name: "Open the invite" })).toHaveAttribute("href", expect.stringContaining("client_id=123456789012345678&"));
  });

  it("UX-R11: Connect with no token says so under the Token field, not in a corner", async () => {
    open();
    await bot("Lyre Table");
    await userEvent.click(screen.getByRole("button", { name: "Add a bot" }));
    const sheet = within(screen.getByRole("dialog"));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    await userEvent.click(sheet.getByRole("button", { name: "Connect" }));
    expect(sheet.getByRole("alert")).toHaveTextContent("Paste the token first");
    expect(sheet.getByLabelText("Token")).toHaveAttribute("aria-invalid", "true");
    expect(sheet.getByLabelText("Token")).toHaveFocus();
    expect(toast()).toBe("");
  });

  it("UX-R10: on a computer that cannot keep tokens encrypted, step 3 says what Settings says", async () => {
    open({ ...PROTOTYPE_OUTPUTS, encryption: false });
    await bot("Lyre Table");
    await userEvent.click(screen.getByRole("button", { name: "Add a bot" }));
    const sheet = within(screen.getByRole("dialog"));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    await userEvent.click(sheet.getByRole("button", { name: "Next" }));
    expect(sheet.getByLabelText("Token")).toHaveAccessibleDescription("Kept only until Lyre closes: this computer cannot keep it encrypted.");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Kept encrypted");
  });

  it("UX-R16: shows Lyre's version at the top right, as the prototype does", async () => {
    open();
    await bot("Lyre Table");
    expect(screen.getByTitle("Lyre version")).toHaveTextContent("0.5.0");
  });

  it("is accessible", async () => {
    open();
    await bot("Lyre Table");
    await expectNoAxeViolations();
  });
});

describe("Settings: the folded boxes", () => {
  it("starts with the rare boxes folded; Sound to Discord shows the main window's mode and changes it there", async () => {
    const { win } = open();
    for (const name of ["Sound to Discord", "Headphones and speakers", "Remote control", "Keyboard shortcuts", "Website tabs", "Local files"]) {
      expect(region(name).getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
    }
    const sound = await unfold("Sound to Discord");
    await waitFor(() => expect(sound.getByRole("radio", { name: "Lighter on the computer" })).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(sound.getByRole("radio", { name: "Best sound quality" }));
    expect(win.set).toHaveBeenCalledWith({ streamingMode: "lowLatency" });
    await waitFor(() => expect(toast()).toBe("Saved: setting: Best sound quality"));
  });

  it("the crossfade between tracks has a default of 3 s and saves a change", async () => {
    const { api } = open();
    const sound = await unfold("Sound to Discord");
    const x = sound.getByRole("combobox", { name: "Between tracks" });
    await waitFor(() => expect(x).toHaveValue("3"));
    await userEvent.selectOptions(x, "5");
    await waitFor(() => expect(toast()).toBe("Saved: crossfade between tracks 5 s"));
    expect((await api.settings.get()).crossfade.ms).toBe(5000);
  });

  it("Website tabs: Several inputs needs inputs first", async () => {
    const { win } = open();
    const tabs = await unfold("Website tabs");
    expect(tabs.getByRole("switch", { name: "Use several inputs at once" })).toBeDisabled();
    await userEvent.click(tabs.getByRole("switch", { name: "Microphones and other inputs" }));
    expect(win.set).toHaveBeenCalledWith({ externalInputsEnabled: true });
    expect(tabs.getByRole("switch", { name: "Use several inputs at once" })).toBeEnabled();
  });

  it("Local files: Ask again forgets a folder", async () => {
    const { win } = open();
    const files = await unfold("Local files");
    await userEvent.click(await files.findByRole("button", { name: "Ask again before opening files in H:\\Audio\\Incoming" }));
    expect(win.forgetLocalFolder).toHaveBeenCalledWith("H:\\Audio\\Incoming");
    expect(await files.findByText("None")).toBeInTheDocument();
  });

  it("Headphones and speakers: no On air row (lead decision); one headset can be split, the preview in one ear", async () => {
    const { audio } = open();
    const box = await unfold("Headphones and speakers");
    expect(box.queryByRole("combobox", { name: "On air, on this computer" })).toBeNull();
    expect(box.getByRole("combobox", { name: "Preview (only you)" })).toBeInTheDocument();
    expect(box.queryByRole("radio", { name: "Preview in the left ear" })).toBeNull();
    await waitFor(() => expect(box.getByRole("switch", { name: "Split one headset" })).toBeEnabled());
    await userEvent.click(box.getByRole("switch", { name: "Split one headset" }));
    expect(await box.findByRole("radio", { name: "Preview in the left ear" })).toBeChecked();
    await userEvent.click(box.getByRole("radio", { name: "Preview in the right ear" }));
    await waitFor(() => expect(audio.calls).toContainEqual(["setAudioDevices", expect.objectContaining({ split: true, previewEar: "right" })]));
  });
});

describe("Settings › Remote control (SEC-4)", () => {
  it("is off; on, it shows the 8-character code and listens on this computer only; a new code replaces it", async () => {
    const { remote } = open();
    const box = await unfold("Remote control");
    const on = box.getByRole("switch", { name: "Let other devices control Lyre" });
    await waitFor(() => expect(on).toBeEnabled());
    expect(on).not.toBeChecked();
    expect(box.queryByRole("group", { name: "Secret code" })).toBeNull();
    await userEvent.click(on);
    expect(remote.set).toHaveBeenCalledWith({ enabled: true });
    expect(await box.findByRole("group", { name: "Secret code" })).toHaveTextContent("K7QD-92XF");
    expect(box.getByRole("radio", { name: "This computer only" })).toBeChecked();
    expect(toast()).toBe("Saved: remote control on");
    await userEvent.click(box.getByRole("button", { name: "Make a new code" }));
    await waitFor(() => expect(box.getByRole("group", { name: "Secret code" })).toHaveTextContent("WXYZ-2345"));
    expect(toast()).toBe("Saved: new remote control code · the old one stops working");
  });

  it("Copy code copies the code; when Lyre cannot copy, it says so in plain words (Nik, 0.5.0: Copy path copied nothing)", async () => {
    open();
    const box = await unfold("Remote control");
    await waitFor(() => expect(box.getByRole("switch", { name: "Let other devices control Lyre" })).toBeEnabled());
    await userEvent.click(box.getByRole("switch", { name: "Let other devices control Lyre" }));
    await box.findByRole("group", { name: "Secret code" });
    const writeText = vi.fn(async (_text: string) => undefined);
    // After userEvent's last use: its setup puts a clipboard of its own on the page.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => box.getByRole("button", { name: "Copy code" }).click());
    await waitFor(() => expect(toast()).toBe("Code copied"));
    expect(writeText).toHaveBeenCalledWith("K7QD-92XF");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    act(() => box.getByRole("button", { name: "Copy code" }).click());
    await waitFor(() => expect(toast()).toBe("Lyre could not copy the code: type it on the other device."));
  });

  it("can listen on the home network instead, at this computer's address", async () => {
    const { remote } = open();
    const box = await unfold("Remote control");
    await waitFor(() => expect(box.getByRole("switch", { name: "Let other devices control Lyre" })).toBeEnabled());
    await userEvent.click(box.getByRole("switch", { name: "Let other devices control Lyre" }));
    await userEvent.click(await box.findByRole("radio", { name: "Your home network" }));
    expect(remote.set).toHaveBeenCalledWith({ address: "192.168.1.20" });
    await waitFor(() => expect(box.getByRole("radio", { name: "Your home network" })).toBeChecked());
    expect(screen.getByRole("region", { name: "Remote control" })).toHaveTextContent("192.168.1.20:3333");
  });

  it("UX-R10: when Lyre cannot listen there, it says why in plain words and shows no Saved pop-up", async () => {
    const { remote } = open();
    const problem = "Lyre could not find the address 192.168.1.20 on this computer. Choose This computer only, or check your network.";
    const box = await unfold("Remote control");
    await waitFor(() => expect(box.getByRole("switch", { name: "Let other devices control Lyre" })).toBeEnabled());
    await userEvent.click(box.getByRole("switch", { name: "Let other devices control Lyre" }));
    await waitFor(() => expect(toast()).toBe("Saved: remote control on"));
    vi.mocked(remote.set).mockImplementationOnce(async (change) => ({ ...(await remote.get()), ...change, running: false, problem }));
    await userEvent.click(await box.findByRole("radio", { name: "Your home network" }));
    expect(await box.findByRole("alert")).toHaveTextContent(problem);
    expect(toast()).not.toMatch(/^Saved: remote control listens on your home network/);
  });
});

describe("Settings › Keyboard shortcuts (UX-12)", () => {
  it("lists every key; Change… takes the next key, a key in use is refused, Esc keeps the old one, Put back resets", async () => {
    const { api } = open();
    const box = await unfold("Keyboard shortcuts");
    const palette = () => box.getByRole("row", { name: "Find and play" });
    await waitFor(() => expect(within(palette()).getByRole("button", { name: "Change the key for Find and play" })).toBeEnabled());
    expect(palette()).toHaveTextContent("Ctrl+K");
    expect(box.getByRole("row", { name: "Next scene" })).toHaveTextContent("Space");
    await userEvent.click(within(palette()).getByRole("button", { name: "Change the key for Find and play" }));
    expect(palette()).toHaveTextContent("Press the new key");
    await userEvent.keyboard("{Shift>}{Escape}{/Shift}");
    expect(toast()).toBe("Shift+Esc is already Fade all. Press another key, or Esc to keep Ctrl+K");
    await userEvent.keyboard("{Control>}j{/Control}");
    await waitFor(() => expect(palette()).toHaveTextContent("Ctrl+J"));
    expect((await api.settings.get()).shortcuts.palette).toBe("Ctrl+J");
    await userEvent.click(within(palette()).getByRole("button", { name: "Change the key for Find and play" }));
    await userEvent.keyboard("{Escape}");
    expect(palette()).toHaveTextContent("Ctrl+J");
    await userEvent.click(box.getByRole("button", { name: "Put back Lyre's keys" }));
    await waitFor(() => expect(palette()).toHaveTextContent("Ctrl+K"));
  });

  it("refuses Space for other programs in plain words when keys in other programs is on", async () => {
    open();
    const box = await unfold("Keyboard shortcuts");
    const sw = box.getByRole("switch", { name: "Next scene and Fade all work in other programs too" });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    expect(await box.findByRole("alert")).toHaveTextContent("Space cannot work in other programs: you type with it there.");
  });

  it("a printable sheet lists every key", async () => {
    open();
    const box = await unfold("Keyboard shortcuts");
    await userEvent.click(box.getByRole("button", { name: "Printable sheet" }));
    const sheet = within(screen.getByRole("dialog", { name: "Lyre's keys" }));
    expect(sheet.getByRole("table")).toHaveTextContent("Fade all");
    expect(sheet.getByRole("button", { name: "Print" })).toBeInTheDocument();
    await act(async () => undefined);
  });
});
