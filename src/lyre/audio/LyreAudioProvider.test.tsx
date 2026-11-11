import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { LyreAudioProvider, useLyreAudio, useLyreAudioEvent, useNowPlaying } from "./LyreAudioProvider";
import { EMPTY_NOW_PLAYING, FakeLyreAudio } from "./testing/fakeLyreAudio";

const wrapper =
  (audio: FakeLyreAudio) =>
  ({ children }: { children: React.ReactNode }) => <LyreAudioProvider audio={audio}>{children}</LyreAudioProvider>;

const playing = (title: string) => ({
  ...EMPTY_NOW_PLAYING,
  rooms: [
    {
      ...EMPTY_NOW_PLAYING.rooms[0],
      music: { trackId: title, title, origin: { kind: "single" as const }, playlistId: null as string | null, position: 1, length: 20, paused: false, loading: false },
    },
  ],
});

/** A small screen: what plays, and a Next button. */
function NowPlayingLine() {
  const audio = useLyreAudio();
  const state = useNowPlaying();
  const music = state.rooms[0].music;
  return (
    <div>
      <p>{music ? `Playing ${music.title}` : "Nothing playing"}</p>
      <button onClick={() => audio.next("music")}>Next</button>
    </div>
  );
}

describe("LyreAudioProvider, useLyreAudio, useNowPlaying", () => {
  it("gives screens the audio to call and the now-playing state, and redraws when it changes", async () => {
    const audio = new FakeLyreAudio();
    render(
      <LyreAudioProvider audio={audio}>
        <NowPlayingLine />
      </LyreAudioProvider>,
    );
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    act(() => audio.setNowPlaying(playing("Tavern")));
    expect(screen.getByText("Playing Tavern")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(audio.calls).toEqual([["next", "music"]]);
  });

  it("stops listening when the screen goes", () => {
    const audio = new FakeLyreAudio();
    const { unmount } = renderHook(() => useNowPlaying(), { wrapper: wrapper(audio) });
    expect((audio as unknown as { subscribers: Set<unknown> }).subscribers.size).toBe(1);
    unmount();
    expect((audio as unknown as { subscribers: Set<unknown> }).subscribers.size).toBe(0);
  });

  it("says plainly when a screen is used outside the provider", () => {
    // React reports the thrown error to the console as well; keep the output clean.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useLyreAudio())).toThrow("LyreAudioProvider");
    quiet.mockRestore();
  });

  it("subscribes once however often the screen redraws", () => {
    const audio = new FakeLyreAudio();
    let subscriptions = 0;
    const subscribe = audio.subscribe.bind(audio);
    audio.subscribe = (listener) => {
      subscriptions++;
      return subscribe(listener);
    };
    const { rerender } = renderHook(() => useNowPlaying(), { wrapper: wrapper(audio) });
    rerender();
    rerender();
    expect(subscriptions).toBe(1);
  });

  it("hands announcements and errors to a listener for the live region and toasts", () => {
    const audio = new FakeLyreAudio();
    const heard: string[] = [];
    const { unmount } = renderHook(
      () => {
        useLyreAudioEvent("announce", (text) => heard.push(`say: ${text}`));
        useLyreAudioEvent("error", (text) => heard.push(`toast: ${text}`));
      },
      { wrapper: wrapper(audio) },
    );
    act(() => {
      audio.emit("announce", "Music: Tavern");
      audio.emit("error", "That track is no longer in the library.");
    });
    expect(heard).toEqual(["say: Music: Tavern", "toast: That track is no longer in the library."]);
    unmount();
    audio.emit("announce", "after");
    expect(heard).toHaveLength(2);
  });
});
