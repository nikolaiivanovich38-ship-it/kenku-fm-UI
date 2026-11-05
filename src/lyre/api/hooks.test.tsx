/**
 * The screens' hooks over LyreApi: a provider, useLyreApi, and queries that load once and load again when a
 * change event names one of their areas.
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createFakeLyreApi } from "../../common/lyre/fake";
import { prototypeLevels } from "../../common/lyre/prototypeLevels";
import { prototypeSeed } from "../../common/lyre/seed";
import type { LyreApi, LyreEvent } from "../../common/lyre/api";
import {
  LyreApiProvider,
  useCampaign,
  useHistory,
  useLyreApi,
  useLyreEvent,
  useLyreQuery,
  usePlaylistTracks,
  useSearch,
  useTracks,
  useTrackPeaks,
  useUsesOf,
} from "./index";

function wrapperFor(api: LyreApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <LyreApiProvider api={api}>{children}</LyreApiProvider>;
  };
}

/** Resolves a promise when the test says so, to control the order answers arrive in. */
function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useLyreApi", () => {
  it("gives the API from the provider", () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => useLyreApi(), { wrapper: wrapperFor(api) });
    expect(result.current).toBe(api);
  });

  it("says plainly when a screen is used outside the provider", () => {
    // React and jsdom report the thrown error as well; keep the test output to the result.
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useLyreApi())).toThrow(/LyreApiProvider/);
    vi.mocked(console.error).mockRestore();
    window.removeEventListener("error", quiet);
  });
});

describe("queries", () => {
  it("load, then load again when a change event names their area", async () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => useTracks(), { wrapper: wrapperFor(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toHaveLength(69));
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await api.library.updateTrack("t01", { title: "Riders" });
    });
    await waitFor(() => expect(result.current.data.find((t) => t.id === "t01").title).toBe("Riders"));
  });

  it("do not load again for changes to other areas", async () => {
    const api = createFakeLyreApi();
    const load = vi.fn((a: LyreApi) => a.boards.list());
    const { result } = renderHook(() => useLyreQuery("boards", load, ["boards"]), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current.data).toHaveLength(5));
    await act(async () => {
      await api.playlists.update("p-inn", { notes: "Loud" });
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      await api.boards.rename("combat", "Fight");
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("a dynamic playlist's tracks follow a tag change", async () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => usePlaylistTracks("p-wistful"), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).not.toContain("t23");
    await act(async () => {
      await api.tags.tagTracks({ trackIds: ["t23"], add: [{ group: "mood", value: "Warm" }] });
    });
    await waitFor(() => expect(result.current.data).toContain("t23"));
  });

  it("load what the new arguments ask for, and an older, slower answer never replaces a newer one", async () => {
    const api = createFakeLyreApi();
    const slow = deferred<string>();
    const answers: Record<string, Promise<string>> = { a: slow.promise, b: Promise.resolve("B") };
    const { result, rerender } = renderHook(({ id }) => useLyreQuery(`x:${id}`, () => answers[id], ["tracks"]), { wrapper: wrapperFor(api), initialProps: { id: "a" } });
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.data).toBe("B"));
    await act(async () => slow.resolve("A"));
    expect(result.current.data).toBe("B");
  });

  it("show an error, and try again on reload", async () => {
    const api = createFakeLyreApi();
    let fail = true;
    const load = () => (fail ? Promise.reject(new Error("Lyre lost its connection")) : Promise.resolve(42));
    const { result } = renderHook(() => useLyreQuery("n", load, ["tracks"]), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current.error?.message).toBe("Lyre lost its connection"));
    expect(result.current.loading).toBe(false);
    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current.error).toBeNull();
  });

  it("stop listening when the screen goes", async () => {
    const api = createFakeLyreApi();
    const stop = vi.fn();
    const spied: LyreApi = { ...api, subscribe: (l) => (api.subscribe(l), stop) };
    const { unmount } = renderHook(() => useTracks(), { wrapper: wrapperFor(spied) });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("search, a campaign tree, uses and the history state", async () => {
    const api = createFakeLyreApi();
    const wrapper = wrapperFor(api);
    const search = renderHook(() => useSearch({ text: "conan", lane: "music" }), { wrapper });
    const crown = renderHook(() => useCampaign("crown"), { wrapper });
    const uses = renderHook(() => useUsesOf({ kind: "board", id: "spells" }), { wrapper });
    const history = renderHook(() => useHistory(), { wrapper });
    await waitFor(() => expect(search.result.current.data?.total).toBe(3));
    await waitFor(() => expect(crown.result.current.data?.name).toBe("The Sunken Crown"));
    await waitFor(() => expect(uses.result.current.data).toHaveLength(4));
    await waitFor(() => expect(history.result.current.data?.canUndo).toBe(false));
    await act(async () => {
      await api.campaigns.setUses({ kind: "board", id: "spells" }, []);
    });
    await waitFor(() => expect(uses.result.current.data).toEqual([]));
    await waitFor(() => expect(history.result.current.data?.undoLabel).toBe('Stop using "Spellwork"'));
  });
});

describe("useLyreEvent", () => {
  it("passes on import progress to the screen showing it", async () => {
    const api = createFakeLyreApi();
    const seen: LyreEvent[] = [];
    renderHook(() => useLyreEvent((e) => seen.push(e)), { wrapper: wrapperFor(api) });
    await act(async () => {
      await api.import.start({ from: "paths", paths: ["D:\\New\\01 One.flac"] });
    });
    await waitFor(() => expect(seen.some((e) => e.type === "import-progress" && e.progress.phase === "done")).toBe(true));
  });
});

const levelsOf = (id: string) => prototypeLevels(prototypeSeed().tracks.find((t) => t.id === id)!);

describe("useTrackPeaks (w3-media)", () => {
  it("is null until the track's peaks are worked out, then gives its levels for the wave", async () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => useTrackPeaks("t01"), { wrapper: wrapperFor(api) });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(levelsOf("t01")));
  });

  it("never shows one track's wave for another: null again at once when the track changes", async () => {
    const api = createFakeLyreApi();
    const { result, rerender } = renderHook(({ id }) => useTrackPeaks(id), { wrapper: wrapperFor(api), initialProps: { id: "t01" } });
    await waitFor(() => expect(result.current).toEqual(levelsOf("t01")));
    rerender({ id: "t02" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(levelsOf("t02")));
  });

  it("asks again only while it has none, or when tracks change (a relinked file)", async () => {
    const api = createFakeLyreApi();
    const peaksOf = vi.spyOn(api.library, "peaksOf");
    const listeners: ((e: LyreEvent) => void)[] = [];
    const subscribe = api.subscribe.bind(api);
    vi.spyOn(api, "subscribe").mockImplementation((l) => {
      listeners.push(l);
      return subscribe(l);
    });
    const { result } = renderHook(() => useTrackPeaks("t01"), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current).not.toBeNull());
    const asked = peaksOf.mock.calls.length;
    act(() => listeners.forEach((l) => l({ type: "changed", areas: ["peaks"] })));
    expect(peaksOf.mock.calls.length).toBe(asked);
    act(() => listeners.forEach((l) => l({ type: "changed", areas: ["tracks"] })));
    await waitFor(() => expect(peaksOf.mock.calls.length).toBe(asked + 1));
  });

  it("is null for no track", () => {
    const api = createFakeLyreApi();
    const { result } = renderHook(() => useTrackPeaks(null), { wrapper: wrapperFor(api) });
    expect(result.current).toBeNull();
  });
});
