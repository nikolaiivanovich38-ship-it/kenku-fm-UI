/**
 * What Settings keeps that must work from the moment Lyre opens, on every screen (w6-rooms):
 *   - PRV-2: the preview's device and a split headset go to the audio host after settings.get() and after each change
 *     (ARCHITECTURE.md "What the screen streams must know"); left at the defaults, nothing is sent, since the preview
 *     already plays on the default device in both ears (asking again makes Chromium switch devices for nothing).
 *   - UX-12: with "Next scene and Fade all work in other programs too" on, their keys are registered in
 *     the main process (window.lyre.keys, src/main/globalKeys.ts); what it refused is kept for Settings to show,
 *     and when the main process could not be asked at all, each key is refused in words (w51-fix2: never silently).
 *     Each press reaches the page as a cancelable window event, GLOBAL_KEY_EVENT ({ action }): Live takes Next scene
 *     and Fade all there (and calls preventDefault); a Fade all nobody took fades every room
 *     here, so it works on any screen, and a Next scene nobody took opens Live, which starts the next scene
 *     (w51-fix2: Nik pressed F9 with Settings showing, and nothing happened). A key registered for other programs is not seen by Lyre's own key handlers
 *     (Windows gives it to the registration), so Live must listen for this event too.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

import { DEFAULT_DEVICES, SHORTCUT_ACTIONS, shortcutKey, type AudioDevices } from "../../common/domain";
import { GLOBAL_KEY_EVENT, type GlobalKeyAction, type GlobalKeyRefusal } from "../../common/globalKeys";
import { nextSceneInLive } from "../kit/liveSession";
import { useLyreSettings } from "../api";
import { useLyreAudio } from "../audio";
import type { LyreKeysBridge } from "../keys/preloadKeys";

const RefusalsContext = createContext<GlobalKeyRefusal[]>([]);

/** w51-fix2: the main process could not be asked (no answer): each key is refused in words, never silently. */
function unanswered(keys: Record<GlobalKeyAction, string>): GlobalKeyRefusal[] {
  return (Object.entries(keys) as [GlobalKeyAction, string][])
    .filter(([, key]) => key)
    .map(([action, key]) => {
      const name = SHORTCUT_ACTIONS.find((a) => a.id === action)?.name ?? action;
      return { action, key, message: `Lyre could not take ${key} from other programs, so ${name} works only in Lyre for now. Turn this off and on again to try once more.` };
    });
}

/** What the main process refused of the global keys, in plain words (Settings › Keyboard shortcuts shows it). */
export function useGlobalKeyRefusals(): GlobalKeyRefusal[] {
  return useContext(RefusalsContext);
}

/** The devices as one text, whatever order their keys came in. */
function keyOf(devices: AudioDevices): string {
  return [devices.previewDevice, devices.split, devices.previewEar, devices.airDevice].join("|");
}

/** The page's bridge; none in tests or a page made without it. */
function pageKeys(): LyreKeysBridge | null {
  return (window as unknown as { lyre?: { keys?: LyreKeysBridge } }).lyre?.keys ?? null;
}

export function SettingsAppliers({ keys, children }: { keys?: LyreKeysBridge | null; children: React.ReactNode }) {
  const bridge = keys === undefined ? pageKeys() : keys;
  const settings = useLyreSettings().data;
  const audio = useLyreAudio();
  const [refused, setRefused] = useState<GlobalKeyRefusal[]>([]);

  const devices = settings?.devices;
  const devicesKey = devices ? keyOf(devices) : "";
  // What the audio host plays with now: the defaults until something else is applied.
  const applied = useRef(keyOf(DEFAULT_DEVICES));
  useEffect(() => {
    if (!devices || devicesKey === applied.current) return;
    applied.current = devicesKey;
    void audio.setAudioDevices(devices).catch((): null => null);
    // devicesKey stands for devices: only a real change is applied again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, devicesKey]);

  const on = settings?.globalKeys ?? false;
  const nextScene = settings ? shortcutKey(settings.shortcuts, "nextScene") : "";
  const fadeAll = settings ? shortcutKey(settings.shortcuts, "fadeAll") : "";
  useEffect(() => {
    if (!bridge || !settings) return;
    let current = true;
    const keys = { nextScene, fadeAll };
    bridge.setGlobal({ on, keys }).then(
      (answer) => current && setRefused(answer.refused),
      (error: unknown) => {
        console.error("Lyre could not register its keys in other programs:", error);
        if (current) setRefused(on ? unanswered(keys) : []);
      },
    );
    return () => {
      current = false;
    };
    // settings stands only for "loaded"; the three values say what to register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, Boolean(settings), on, nextScene, fadeAll]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onGlobal((action) => {
      const event = new CustomEvent(GLOBAL_KEY_EVENT, { detail: { action }, cancelable: true });
      const taken = !window.dispatchEvent(event);
      if (!taken && action === "fadeAll") audio.fadeAll();
      // w51-fix2: only Live takes Next scene; on any other screen the press opens Live, which then moves on.
      if (!taken && action === "nextScene") nextSceneInLive();
    });
  }, [bridge, audio]);

  return <RefusalsContext.Provider value={refused}>{children}</RefusalsContext.Provider>;
}
