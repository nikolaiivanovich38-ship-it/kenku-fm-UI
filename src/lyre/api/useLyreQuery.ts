/**
 * One read from LyreApi that stays current: it loads when the screen opens or its key changes, and loads again
 * when a "changed" event names one of its areas (another box, another window, undo). While loading again it keeps
 * showing the last answer, so screens do not flicker; an answer to an older request never replaces a newer one.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { LyreApi, LyreArea } from "../../common/lyre/api";
import { useLyreApi } from "./LyreApiProvider";

export interface LyreQuery<T> {
  /** The last answer; undefined until the first one arrives. */
  data: T | undefined;
  /** Why the last load failed (a fault, such as a lost connection), or null. */
  error: Error | null;
  /** True while a load is under way. */
  loading: boolean;
  /** Loads again now (for a "Try again" button). */
  reload: () => void;
}

/**
 * @param key  Names this read and its arguments; a new key loads again (for example `playlist-tracks:${id}`).
 * @param load Reads from the API. Only the version passed with the current key is used.
 * @param areas The areas whose changes make this read stale.
 */
export function useLyreQuery<T>(key: string, load: (api: LyreApi) => Promise<T>, areas: readonly LyreArea[]): LyreQuery<T> {
  const api = useLyreApi();
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [version, setVersion] = useState(0);
  // The latest load and areas, read by the effects without making every render a new subscription or load.
  const loadRef = useRef(load);
  loadRef.current = load;
  const areasRef = useRef(areas);
  areasRef.current = areas;

  useEffect(() => {
    let current = true;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    loadRef.current(api).then(
      (data) => current && setState({ data, error: null, loading: false }),
      (error: unknown) => current && setState((s) => ({ data: s.data, error: error instanceof Error ? error : new Error(String(error)), loading: false })),
    );
    return () => {
      current = false;
    };
  }, [api, key, version]);

  useEffect(
    () =>
      api.subscribe((event) => {
        if (event.type === "changed" && event.areas.some((a) => areasRef.current.includes(a))) setVersion((v) => v + 1);
      }),
    [api],
  );

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
