/** Preview and Play on air for every kind of sound (the prototype's L.previewButton and L.playOnAirButton). */
import React, { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PadBoard } from "../../common/lyre/api";
import { LyreAudioProvider } from "../audio";
import { EMPTY_NOW_PLAYING, FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "../shell/Announcer";
import { expectNoAxeViolations } from "../test/axe";
import { PlayOnAirButton, PreviewButton, previewKeyOf, type SoundTarget } from "./SoundButtons";

const pad = (id: string, label: string) => ({ id, label, sound: { kind: "none" } as never, mode: "oneshot" as const, key: "", color: "steel" as const, icon: "star", volume: 1, fadeOutMs: 0, aside: false });
const board: PadBoard = { id: "combat", name: "Combat", cols: 2, rows: 1, slots: [null, pad("sword", "Sword")], spare: [] };

function show(ui: React.ReactNode, audio = new FakeLyreAudio()) {
  render(
    <LyreAudioProvider audio={audio}>
      <AnnouncerProvider>{ui}</AnnouncerProvider>
    </LyreAudioProvider>,
  );
  return audio;
}

afterEach(() => vi.useRealTimers());

describe("Preview (only you hear it)", () => {
  it.each<[SoundTarget, string, string, unknown[]]>([
    [{ kind: "track", id: "t13" }, "Bridge", "Preview Bridge", ["previewTrack", "t13"]],
    [{ kind: "playlist", id: "p-company" }, "The Company themes", "Preview The Company themes", ["previewPlaylist", "p-company"]],
    [{ kind: "pad", boardId: "combat", padId: "sword" }, "Sword", "Preview Sword", ["previewPad", "combat", "sword"]],
    [{ kind: "board", board }, "Combat", "Preview the first pad of Combat", ["previewPad", "combat", "sword"]],
  ])("%o is named after it and starts its preview", async (target, name, label, call) => {
    const audio = show(<PreviewButton target={target} name={name} />);
    const button = screen.getByRole("button", { name: label });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("btn", "s", "icon", "pv");
    await userEvent.click(button);
    expect(audio.calls).toContainEqual(call);
  });

  it("is pressed while it plays, says Stop preview, and stops it", async () => {
    const audio = new FakeLyreAudio();
    audio.setNowPlaying({ preview: { key: previewKeyOf({ kind: "board", board }), label: "Sword (pad)" } });
    show(<PreviewButton target={{ kind: "board", board }} name="Combat" />, audio);
    const button = screen.getByRole("button", { name: "Stop preview of Combat" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Stop preview");
    await userEvent.click(button);
    expect(audio.calls).toContainEqual(["stopPreview"]);
    await expectNoAxeViolations();
  });

  it("keeps a row's click and its Tab stop to the row when asked", async () => {
    const onRow = vi.fn();
    show(
      <div onClick={onRow}>
        <PreviewButton target={{ kind: "track", id: "t1" }} name="Tavern" tabIndex={-1} />
      </div>,
    );
    const button = screen.getByRole("button", { name: "Preview Tavern" });
    expect(button).toHaveAttribute("tabindex", "-1");
    await userEvent.click(button);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("uses the keys of the audio host's preview: a track's id, pl:, pad:board/pad", () => {
    expect(previewKeyOf({ kind: "track", id: "t1" })).toBe("t1");
    expect(previewKeyOf({ kind: "playlist", id: "p1" })).toBe("pl:p1");
    expect(previewKeyOf({ kind: "pad", boardId: "b", padId: "p" })).toBe("pad:b/p");
    expect(previewKeyOf({ kind: "board", board })).toBe("pad:combat/sword");
  });
});

describe("Play on air (the players hear it)", () => {
  it("plays a track or a playlist with the prototype's 3-second fade in", async () => {
    const audio = show(
      <>
        <PlayOnAirButton target={{ kind: "track", id: "t13" }} name="Bridge" />
        <PlayOnAirButton target={{ kind: "playlist", id: "p-company" }} name="The Company themes" />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Play on air: Bridge" }));
    await userEvent.click(screen.getByRole("button", { name: "Play on air: The Company themes" }));
    expect(audio.calls).toEqual([
      ["playTrack", "t13", { fadeMs: 3000 }],
      ["playPlaylist", "p-company", { fadeMs: 3000 }],
    ]);
    expect(screen.getByRole("button", { name: "Play on air: Bridge" })).toHaveAttribute("title", "Play on air (the players hear it)");
  });

  it("plays a playlist from the session or campaign list it is shown in, so that list's play order applies (PLY-13, UX-16)", async () => {
    const place = { kind: "campaign" as const, campaignId: "crown" };
    const audio = show(<PlayOnAirButton target={{ kind: "playlist", id: "p-company", place }} name="The Company themes" />);
    await userEvent.click(screen.getByRole("button", { name: "Play on air: The Company themes" }));
    expect(audio.calls).toEqual([["playPlaylist", "p-company", { fadeMs: 3000, place }]]);
  });

  it("says so, and plays nothing, for a playlist with no tracks", async () => {
    const audio = show(<PlayOnAirButton target={{ kind: "playlist", id: "p-new", empty: true }} name="New playlist" />);
    await userEvent.click(screen.getByRole("button", { name: "Play on air: New playlist" }));
    expect(audio.calls).toEqual([]);
    expect(document.getElementById("lyre-toast")).toHaveTextContent("This playlist has no tracks yet");
  });

  it("presses a pad, or a board's first pad; a hold pad is let go after 1.5 s", async () => {
    vi.useFakeTimers();
    const audio = show(
      <>
        <PlayOnAirButton target={{ kind: "pad", boardId: "combat", padId: "sword", hold: true }} name="Sword" />
        <PlayOnAirButton target={{ kind: "board", board }} name="Combat" />
      </>,
    );
    act(() => screen.getByRole("button", { name: "Play on air: Sword" }).click());
    expect(audio.calls).toEqual([["firePad", "combat", "sword", "down"]]);
    act(() => vi.advanceTimersByTime(1500));
    expect(audio.calls).toContainEqual(["firePad", "combat", "sword", "up"]);
    act(() => screen.getByRole("button", { name: "Play on air: the first pad of Combat" }).click());
    expect(audio.calls[audio.calls.length - 1]).toEqual(["firePad", "combat", "sword"]);
  });
});

describe("a hold pad pressed from Play on air (review w3-polish 10)", () => {
  const ups = (audio: FakeLyreAudio) => audio.calls.filter((c) => c[0] === "firePad" && c[3] === "up").length;

  it("a second press within 1.5 s keeps it held 1.5 s from that press, and lets go once", () => {
    vi.useFakeTimers();
    const audio = show(<PlayOnAirButton target={{ kind: "pad", boardId: "combat", padId: "sword", hold: true }} name="Sword" />);
    const button = screen.getByRole("button", { name: "Play on air: Sword" });
    act(() => button.click());
    act(() => vi.advanceTimersByTime(1000));
    act(() => button.click());
    act(() => vi.advanceTimersByTime(1000));
    expect(ups(audio)).toBe(0);
    act(() => vi.advanceTimersByTime(600));
    expect(ups(audio)).toBe(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(ups(audio)).toBe(1);
  });

  it("is let go at once when the button goes away while it is held", () => {
    vi.useFakeTimers();
    const audio = new FakeLyreAudio();
    const { unmount } = render(
      <LyreAudioProvider audio={audio}>
        <AnnouncerProvider>
          <PlayOnAirButton target={{ kind: "pad", boardId: "combat", padId: "sword", hold: true }} name="Sword" />
        </AnnouncerProvider>
      </LyreAudioProvider>,
    );
    act(() => screen.getByRole("button", { name: "Play on air: Sword" }).click());
    unmount();
    expect(ups(audio)).toBe(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(ups(audio)).toBe(1);
  });
});

describe("many Preview buttons (review w3-polish 5)", () => {
  it("draw again only when what previews changes, not on every now-playing tick", () => {
    const audio = new FakeLyreAudio();
    let commits = 0;
    show(
      <Profiler id="list" onRender={() => commits++}>
        {Array.from({ length: 50 }, (_, i) => (
          <PreviewButton key={i} target={{ kind: "track", id: `t${i}` }} name={`T${i}`} />
        ))}
      </Profiler>,
      audio,
    );
    commits = 0;
    const music = { trackId: "m1", title: "Tavern", origin: "single" as never, playlistId: null as string | null, length: 20, paused: false, loading: false };
    for (let k = 0; k < 10; k++) act(() => audio.setNowPlaying({ rooms: [{ ...EMPTY_NOW_PLAYING.rooms[0], music: { ...music, position: k } }] }));
    expect(commits).toBe(0);
    act(() => audio.setNowPlaying({ preview: { key: "t3", label: "T3" } }));
    expect(commits).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Stop preview of T3" })).toHaveAttribute("aria-pressed", "true");
  });
});

