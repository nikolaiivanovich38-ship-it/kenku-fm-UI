import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createFakeLyreApi } from "../../common/lyre/fake";
import { LyreApiProvider } from "../api";
import { LyreAudioProvider } from "../audio";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { expectNoAxeViolations } from "../test/axe";
import { AnnouncerProvider } from "./Announcer";
import { FindAndPlay } from "./FindAndPlay";

vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

let audio: FakeLyreAudio;

function page() {
  audio = new FakeLyreAudio();
  render(
    <LyreApiProvider api={createFakeLyreApi()}>
      <LyreAudioProvider audio={audio}>
        <AnnouncerProvider>
          <button type="button">Where I was</button>
          <FindAndPlay />
        </AnnouncerProvider>
      </LyreAudioProvider>
    </LyreApiProvider>,
  );
}

const dialog = () => screen.queryByRole("dialog", { name: "Find and play" });
const box = () => screen.getByRole("combobox", { name: "Type a track, playlist, pad or scene" });

beforeEach(() => localStorage.clear());

describe("Find and play (Ctrl+K, UX-12)", () => {
  it("Ctrl+K opens it with the field focused; Esc closes it and focus goes back", async () => {
    page();
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Where I was" }).focus();
    await user.keyboard("{Control>}k{/Control}");
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(box()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(screen.getByRole("button", { name: "Where I was" })).toHaveFocus();
  });

  it("finds playlists first, each option named with its kind; Enter plays it on air and closes", async () => {
    page();
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(box(), "abbess");
    const option = await screen.findByRole("option", { name: /^The Abbess, playlist/ });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(box()).toHaveAttribute("aria-activedescendant", option.id);
    await user.keyboard("{Enter}");
    expect(dialog()).toBeNull();
    expect(audio.calls.some(([name, id]) => name === "playPlaylist" && id === "p-abbess")).toBe(true);
  });

  it("Alt+Enter previews, Shift+Enter adds to the queue, and a pad or a scene can be found too", async () => {
    page();
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(box(), "thunder");
    expect(await screen.findByRole("option", { name: /^Thunder crack, pad/ })).toBeInTheDocument();
    await user.clear(box());
    await user.type(box(), "abbey ruins");
    expect(await screen.findByRole("option", { name: /^The abbey ruins, scene/ })).toBeInTheDocument();
    await user.clear(box());
    await user.type(box(), "lullaby");
    await screen.findByRole("option", { name: /^Lullaby/ });
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    expect(audio.calls.some(([name]) => name === "previewTrack")).toBe(true);
    await user.keyboard("{Control>}k{/Control}");
    await user.type(box(), "lullaby");
    await screen.findByRole("option", { name: /^Lullaby/ });
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(audio.calls.some(([name, what]) => name === "addToQueue" && (what as { kind: string }).kind === "track")).toBe(true);
  });

  it("a key pressed before the answer arrives waits for it (typed fast, Alt+Enter at once)", async () => {
    page();
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    fireEvent.change(box(), { target: { value: "lullaby" } });
    fireEvent.keyDown(box(), { key: "Enter", altKey: true });
    await vi.waitFor(() => expect(audio.calls.some(([name]) => name === "previewTrack")).toBe(true));
    expect(dialog()).toBeNull();
  });

  it("says when nothing is called that, and has no accessibility failures", async () => {
    page();
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    await user.type(box(), "zzzz");
    expect(await screen.findByText("Nothing is called that")).toBeInTheDocument();
    await act(async () => expectNoAxeViolations(document.body));
  });
});
