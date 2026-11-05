/**
 * Every track, kept for the whole page visit and shared by the Library and Playlists screens.
 *
 * Why not useTracks(): the shell draws a screen afresh on every address change (#/library to #/library/t44), and
 * useLyreQuery starts empty each time, so opening a track would reload and redraw 20,000 tracks and lose the list's
 * scroll and focus. This store loads once per LyreApi, reloads when a "changed" event names tracks (several events
 * close together cause one reload), and takes a write's answer at once (`put`), so typing a title shows in the list
 * without waiting for the reload.
 */
import { useSyncExternalStore } from "react";
import type { LibraryTrack, LyreApi } from "../../../common/lyre/api";
import { useLyreApi } from "../../api";

export interface TrackList {
  /** Undefined until the first load answers. */
  tracks: LibraryTrack[] | undefined;
  byId: ReadonlyMap<string, LibraryTrack>;
  error: Error | null;
}

const EMPTY: TrackList = { tracks: undefined, byId: new Map(), error: null };
/** Reloads asked for within this time are done once. */
const RELOAD_DELAY_MS = 60;

export class TrackStore {
  private state: TrackList = EMPTY;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private loading: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly api: LyreApi) {}

  get = (): TrackList => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.start();
    return () => this.listeners.delete(listener);
  };

  /** Loads now (or once more after the load under way). */
  reload(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = this.api.library.listTracks().then(
      (tracks) => this.set({ tracks, byId: new Map(tracks.map((t) => [t.id, t])), error: null }),
      (error: unknown) => this.set({ ...this.state, error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return this.loading.finally(() => {
      this.loading = null;
      if (this.again) {
        this.again = false;
        void this.reload();
      }
    });
  }

  /** A write's answer: the changed track replaces the old one at once. */
  put(track: LibraryTrack): void {
    const { tracks } = this.state;
    if (!tracks) return;
    const at = tracks.findIndex((t) => t.id === track.id);
    if (at < 0) return;
    const next = tracks.slice();
    next[at] = track;
    const byId = new Map(this.state.byId);
    byId.set(track.id, track);
    this.set({ tracks: next, byId, error: null });
  }

  /** Changes one track as a write will have changed it, before the write's answer or the reload arrives. */
  update(id: string, change: (t: LibraryTrack) => LibraryTrack): void {
    const t = this.state.byId.get(id);
    if (t) this.put(change(t));
  }

  private start() {
    if (this.started) return;
    this.started = true;
    void this.reload();
    this.api.subscribe((event) => {
      const stale = (event.type === "changed" && event.areas.includes("tracks")) || (event.type === "library-status" && event.ok);
      if (!stale) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.reload();
      }, RELOAD_DELAY_MS);
    });
  }

  private set(next: TrackList) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}

const stores = new WeakMap<LyreApi, TrackStore>();
export function trackStoreFor(api: LyreApi): TrackStore {
  let store = stores.get(api);
  if (!store) {
    store = new TrackStore(api);
    stores.set(api, store);
  }
  return store;
}

/** Every track, current; redraws only when the list changes. */
export function useTrackList(): TrackList & { store: TrackStore } {
  const store = trackStoreFor(useLyreApi());
  const list = useSyncExternalStore(store.subscribe, store.get);
  return { ...list, store };
}
