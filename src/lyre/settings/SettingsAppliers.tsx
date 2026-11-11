/**
 * What Settings keeps that must work from the moment Lyre opens, on every screen (w6-rooms):
 *   - PRV-2: the preview's device and a split headset go to the audio host after settings.get() and after each change
 *     (ARCHITECTURE.md "What the screen streams must know"); left at the defaults, nothing is sent, since the preview
 *     already plays on the default device in both ears (asking again makes Chromium switch devices for nothing).
 *   - UX-12: with "Next scene and Fade all work in other programs too" on, their keys are registered in
 *     the main process (window.lyre.keys, src/main/globalKeys.ts); what it refused is kept for Settings to show.
 *     Each press reaches the page as a cancelable window event, GLOBAL_KEY_EVENT ({ action }): Live takes Next scene
 *     and Fade all there (and calls preventDefault); a Fade all nobody took fades every room
 *     here, so it works on any screen. A key registered for other programs is not seen by Lyre's own key handlers
 *     (Windows gives it to the registration), so Live must listen for this event too.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

import { DEFAULT_DEVICES, shortcutKey, type AudioDevices } from "../../common/domain";
import { GLOBAL_KEY_EVENT, type GlobalKeyRefusal } from "../../common/globalKeys";
import { useLyreSettings } from "../api";
import { useLyreAudio } from "../audio";
import type { LyreKeysBridge } from "../keys/preloadKeys";

const RefusalsContext = createContext<GlobalKeyRefusal[]>([]);

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
    bridge.setGlobal({ on, keys: { nextScene, fadeAll } }).then(
      (answer) => current && setRefused(answer.refused),
      (): void => undefined,
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
    });
  }, [bridge, audio]);

  return <RefusalsContext.Provider value={refused}>{children}</RefusalsContext.Provider>;
}
