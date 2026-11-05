/** The on-air bar's Stop and keyboard focus (review w3-polish 3). */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LyreAudioProvider } from "../audio";
import { EMPTY_NOW_PLAYING, FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "./Announcer";
import { OnAirBar } from "./OnAirBar";

const music = { trackId: "m1", title: "Tavern", origin: "single" as never, playlistId: null as string | null, position: 1, length: 20, paused: false, loading: false };

function show() {
  const audio = new FakeLyreAudio();
  audio.setNowPlaying({ rooms: [{ ...EMPTY_NOW_PLAYING.rooms[0], music }] });
  render(
    <LyreAudioProvider audio={audio}>
      <AnnouncerProvider>
        <main id="view">
          <h1>Library</h1>
          <button type="button">Elsewhere</button>
          <OnAirBar />
        </main>
      </AnnouncerProvider>
    </LyreAudioProvider>,
  );
  return audio;
}

describe("the on-air bar's Stop", () => {
  it("is named for what it stops, and keeps the words Stop", () => {
    show();
    expect(screen.getByRole("button", { name: "Stop everything on air" })).toHaveTextContent("Stop");
  });

  it("gives focus to the screen's heading when the bar goes away under it", async () => {
    const audio = show();
    screen.getByRole("button", { name: "Stop everything on air" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(audio.calls).toContainEqual(["fadeAll", 1000]);
    act(() => audio.setNowPlaying({ rooms: EMPTY_NOW_PLAYING.rooms }));
    expect(screen.queryByRole("region", { name: "On air" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("leaves focus alone when it was somewhere else", () => {
    const audio = show();
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    act(() => audio.setNowPlaying({ rooms: EMPTY_NOW_PLAYING.rooms }));
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });
});

describe("who hears it (w3-ux 11)", () => {
  it("with no Discord room connected, says plainly that only this computer hears it", () => {
    show();
    const bar = screen.getByRole("region", { name: "On air" });
    expect(bar).toHaveTextContent("Only this computer hears it: no Discord room is connected.");
    expect(bar.querySelector(".badge.onair")).toBeNull();
  });

  it("with a bot in a voice channel, shows the red On air mark", () => {
    const audio = show();
    act(() => audio.setNowPlaying({ broadcasting: true }));
    const bar = screen.getByRole("region", { name: "On air" });
    expect(bar.querySelector(".badge.onair")).toHaveTextContent("On air");
    expect(bar).not.toHaveTextContent("Only this computer");
  });
});

