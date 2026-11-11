/**
 * UX-16: a preview says where it was started ("Previewed from the session planner") without each screen saying so:
 * the shell names the screen (core.js SCREEN_NAMES) for every preview started on it.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LyreAudioProvider, useLyreAudio } from "../audio";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { SCREEN_WORDS, ScreenSound } from "./ScreenSound";

function Buttons() {
  const audio = useLyreAudio();
  return (
    <>
      <button type="button" onClick={() => audio.previewTrack("t13")}>Track</button>
      <button type="button" onClick={() => audio.previewTrack("t13", { startAtMs: 500, quiet: true })}>Track from a point</button>
      <button type="button" onClick={() => audio.previewPlaylist("p-ashen")}>Playlist</button>
      <button type="button" onClick={() => audio.previewPad("combat", "sword", { from: "a pad" })}>Pad</button>
      <button type="button" onClick={() => audio.tryPad("combat", "sword", "up")}>Try</button>
      <button type="button" onClick={() => audio.playTrack("t13")}>On air</button>
    </>
  );
}

describe("ScreenSound", () => {
  it("names every screen as the prototype does", () => {
    expect(SCREEN_WORDS.session).toBe("the session planner");
    expect(SCREEN_WORDS.campaign).toBe("the campaign page");
    expect(SCREEN_WORDS.library).toBe("the Library");
  });

  it("adds where a preview was started unless the screen said, and leaves everything else as it was", async () => {
    const audio = new FakeLyreAudio();
    render(
      <LyreAudioProvider audio={audio}>
        <ScreenSound route="campaign">
          <Buttons />
        </ScreenSound>
      </LyreAudioProvider>,
    );
    for (const name of ["Track", "Track from a point", "Playlist", "Pad", "Try", "On air"]) await userEvent.click(screen.getByRole("button", { name }));
    expect(audio.calls).toEqual([
      ["previewTrack", "t13", { from: "the campaign page" }],
      ["previewTrack", "t13", { from: "the campaign page", startAtMs: 500, quiet: true }],
      ["previewPlaylist", "p-ashen", { from: "the campaign page" }],
      ["previewPad", "combat", "sword", { from: "a pad" }],
      ["tryPad", "combat", "sword", "up", { from: "the campaign page" }],
      ["playTrack", "t13"],
    ]);
  });
});
