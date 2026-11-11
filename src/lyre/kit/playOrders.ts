/**
 * PLY-13 play orders for every play order button on a screen, loaded once and shared: each playlist's name and own
 * order (playlists.list) and every place's own order (playlists.playOrders). A screen may show dozens of buttons, so
 * they share one load per LyreApi instead of one each. It loads again when a "changed" event names playlists or the
 * library is back after a restart, and a write's answer shows at once (`put`) without waiting for that.
 */
import { useSyncExternalStore } from "react";

import { keyOfPlace, resolvePlayOrder, type PlayOrder, type PlayOrderOverrides, type UsePlace } from "../../common/domain";
import type { LyreApi } from "../../common/lyre/api";
import { useLyreApi } from "../api";

export interface PlayOrderData {
  playlists: ReadonlyMap<string, { name: string; order: PlayOrder | null }>;
  overrides: PlayOrderOverrides;
}

class PlayOrderStore {
  private data: PlayOrderData | undefined;
  private readonly listeners = new Set<() => void>();
  private stopEvents: (() => void) | null = null;
  private loads = 0;

  constructor(private readonly api: LyreApi) {}

  get = (): PlayOrderData | undefined => this.data;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.stopEvents) {
      this.stopEvents = this.api.subscribe((event) => {
        if ((event.type === "changed" && event.areas.includes("playlists")) || (event.type === "library-status" && event.ok)) this.load();
      });
      this.load();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopEvents?.();
        this.stopEvents = null;
      }
    };
  };

  /** Loads again; an answer to an older load never replaces a newer one. */
  load(): void {
    const load = ++this.loads;
    Promise.all([this.api.playlists.list(), this.api.playlists.playOrders()]).then(
      ([playlists, overrides]) => {
        if (load !== this.loads) return;
        this.show({ playlists: new Map(playlists.map((p) => [p.id, { name: p.name, order: p.order }])), overrides });
      },
      // A fault (a lost connection): keep what is shown; the library's return loads again.
      (): void => undefined,
    );
  }

  /** Shows a write's answer at once: `order` null takes the place's (or the playlist's own) choice away. */
  put(playlistId: string, place: UsePlace | null, order: PlayOrder | null): void {
    const data = this.data;
    if (!data) return;
    if (!place) {
      const playlists = new Map(data.playlists);
      const playlist = playlists.get(playlistId);
      if (playlist) playlists.set(playlistId, { ...playlist, order });
      this.show({ ...data, playlists });
      return;
    }
    const key = keyOfPlace(place);
    const here = { ...data.overrides[key] };
    if (order) here[playlistId] = order;
    else delete here[playlistId];
    const overrides = { ...data.overrides, [key]: here };
    if (!Object.keys(here).length) delete overrides[key];
    this.show({ ...data, overrides });
  }

  private show(data: PlayOrderData): void {
    this.data = data;
    this.listeners.forEach((listener) => listener());
  }
}

const stores = new WeakMap<LyreApi, PlayOrderStore>();

export function playOrderStoreOf(api: LyreApi): PlayOrderStore {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = new PlayOrderStore(api)));
  return store;
}

/** Every playlist's name and own order, and every place's order; undefined until loaded. */
export function usePlayOrders(): PlayOrderData | undefined {
  const store = playOrderStoreOf(useLyreApi());
  return useSyncExternalStore(store.subscribe, store.get);
}

/** The play order of a playlist in a place (null: its own), where it comes from, and the playlist's order elsewhere. */
export function playOrderIn(data: PlayOrderData, playlistId: string, place: UsePlace | null) {
  const own = data.playlists.get(playlistId)?.order ?? null;
  const here = resolvePlayOrder(playlistId, own, place, data.overrides);
  const elsewhere = resolvePlayOrder(playlistId, own, null, data.overrides).order;
  return { ...here, elsewhere };
}
