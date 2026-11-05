/**
 * A scene's music, ambience and pad boards change on the screen at once, as in the prototype, while the library
 * saves them (a round trip to the library's own process). The screen shows the change until the library's copy
 * says the same, the library refuses it (the change is taken back), or shortly after the save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Done, SceneInfo, SessionInfo } from "../../../common/lyre/api";

export type ScenePlay = Partial<Pick<SceneInfo, "music" | "ambience" | "boardIds">>;

/** How long a saved change is shown before the library's copy is trusted again whatever it says. */
const TRUST_LIBRARY_AFTER_MS = 2000;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useOptimisticScenes(saved: SessionInfo) {
  const [shown, setShown] = useState<Record<string, ScenePlay>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Changes the library now has are no longer needed.
  useEffect(() => {
    setShown((current) => {
      let changed = false;
      const next: Record<string, ScenePlay> = {};
      for (const [id, patch] of Object.entries(current)) {
        const scene = saved.scenes.find((x) => x.id === id);
        if (scene && Object.entries(patch).some(([key, value]) => !same(scene[key as keyof ScenePlay], value))) next[id] = patch;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [saved]);

  const session = useMemo<SessionInfo>(
    () => (Object.keys(shown).length ? { ...saved, scenes: saved.scenes.map((sc) => (shown[sc.id] ? { ...sc, ...shown[sc.id] } : sc)) } : saved),
    [saved, shown],
  );

  const forget = useCallback((sceneId: string, patch: ScenePlay) => {
    setShown((current) => {
      const mine = current[sceneId];
      if (!mine || !Object.entries(patch).every(([key, value]) => same(mine[key as keyof ScenePlay], value))) return current;
      const rest = { ...current };
      delete rest[sceneId];
      return rest;
    });
  }, []);

  /** Show the change now and save it; resolves to what was done, or undefined when refused. */
  const saveScene = useCallback(
    async (sceneId: string, patch: ScenePlay, write: () => Promise<Done<void> | undefined>) => {
      setShown((current) => ({ ...current, [sceneId]: { ...current[sceneId], ...patch } }));
      const done = await write();
      if (!done) forget(sceneId, patch);
      else timers.current.push(setTimeout(() => forget(sceneId, patch), TRUST_LIBRARY_AFTER_MS));
      return done;
    },
    [forget],
  );

  return { session, saveScene };
}
