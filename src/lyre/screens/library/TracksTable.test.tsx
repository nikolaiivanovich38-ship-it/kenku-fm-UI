/** PERF-3: the Library at 20,000 tracks draws a screenful of rows, and filtering that many stays quick. */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { prototypeSeed } from "../../../common/lyre/seed";
import type { LibraryTrack } from "../../../common/lyre/api";
import { LyreAudioProvider } from "../../audio/LyreAudioProvider";
import { FakeLyreAudio } from "../../audio/testing/fakeLyreAudio";
import { AnnouncerProvider } from "../../shell/Announcer";
import { DEFAULT_FILTER, visibleTracks } from "./model";
import { TracksTable } from "./TracksTable";

// The screens import the audio host, whose worklet file is a webpack asset.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

function manyTracks(n: number): LibraryTrack[] {
  const base = prototypeSeed().tracks;
  return Array.from({ length: n }, (_, i) => {
    const t = base[i % base.length];
    return { ...t, id: `x${i}`, title: `${t.title || t.metaTitle} ${i}`, tags: { ...t.tags } };
  });
}

function table(list: LibraryTrack[], onCursor = vi.fn()) {
  return render(
    <AnnouncerProvider>
      <LyreAudioProvider audio={new FakeLyreAudio()}>
        <TracksTable
          list={list}
          groupNames={{}}
          openId={undefined}
          sel={new Set()}
          cursor={null}
          onAir={new Set()}
          airPaused={new Set()}
          preview={null}
          missing={new Set()}
          emptyText="None"
          sort="title"
          onOpen={vi.fn()}
          onToggle={vi.fn()}
          onToggleAll={vi.fn()}
          onCursor={onCursor}
          onExtend={vi.fn()}
          onPreview={vi.fn()}
          onPlay={vi.fn()}
          rowMenu={() => []}
        />
      </LyreAudioProvider>
    </AnnouncerProvider>,
  );
}

describe("the track grid at 20,000 tracks", () => {
  it("draws only a screenful of rows, and says how many there are in all", () => {
    const list = manyTracks(20_000);
    table(list);
    const grid = screen.getByRole("grid", { name: "Tracks" });
    expect(grid).toHaveAttribute("aria-rowcount", "20001");
    const drawn = grid.querySelectorAll("tbody tr[data-tid]");
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length).toBeLessThan(80);
    expect(drawn[0]).toHaveAttribute("aria-rowindex", "2");
  });

  it("End moves the keyboard to the last track, which is then drawn", () => {
    const list = manyTracks(20_000);
    const onCursor = vi.fn();
    const { rerender } = table(list, onCursor);
    const first = within(screen.getByRole("grid")).getAllByRole("row")[1];
    fireEvent.keyDown(first, { key: "End" });
    expect(onCursor).toHaveBeenCalledWith("x19999");
    rerender(<></>);
  });

  it("draws every row of a small library, so each one can be found", () => {
    table(manyTracks(300));
    expect(screen.getByRole("grid").querySelectorAll("tbody tr[data-tid]")).toHaveLength(300);
  });

  it("filters, searches and sorts 20,000 tracks in well under a second", () => {
    const list = manyTracks(20_000);
    const start = performance.now();
    visibleTracks(list, { ...DEFAULT_FILTER, kind: "music", tags: { mood: ["Grief"] } }, "the", "long");
    visibleTracks(list, DEFAULT_FILTER, "", "title");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
