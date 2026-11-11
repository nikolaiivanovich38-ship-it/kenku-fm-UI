/**
 * OUT-8 (w6-rooms): the main window shares its Sound to Discord and Website tabs settings with Settings in Lyre. It
 * stays where they live (saved in its storage, as Kenku FM did): it tells the main process after each change, and
 * takes Lyre's changes as its own (src/common/windowSettings.ts has the whole path).
 */
import type { Store } from "@reduxjs/toolkit";

import { isWindowSettingsChange, windowSettingsOf, type WindowSettings, type WindowSettingsChange } from "../../../common/windowSettings";
import { setExternalInputsEnabled, setMultipleInputsEnabled, setStreamingMode, setURLBarEnabled, type SettingsState } from "./settingsSlice";

/** window.kenku.windowSettings (src/preload.ts). */
export interface WindowSettingsPort {
  report(settings: WindowSettings): void;
  onSet(listener: (change: unknown) => void): () => void;
}

const same = (a: WindowSettings, b: WindowSettings) =>
  a.streamingMode === b.streamingMode && a.urlBarEnabled === b.urlBarEnabled && a.externalInputsEnabled === b.externalInputsEnabled && a.multipleInputsEnabled === b.multipleInputsEnabled;

/** Start sharing; returns a function that stops. */
export function startWindowSettingsSync(store: Store<{ settings?: SettingsState }>, port: WindowSettingsPort): () => void {
  const current = () => windowSettingsOf((store.getState().settings ?? {}) as unknown as Record<string, unknown>);
  let told = current();
  port.report(told);
  const stopStore = store.subscribe(() => {
    const now = current();
    if (same(now, told)) return;
    told = now;
    port.report(now);
  });
  const stopSet = port.onSet((change) => {
    if (!isWindowSettingsChange(change)) return;
    apply(store, change);
  });
  return () => {
    stopStore();
    stopSet();
  };
}

function apply(store: Store, change: WindowSettingsChange) {
  if (change.streamingMode !== undefined) store.dispatch(setStreamingMode(change.streamingMode));
  if (change.urlBarEnabled !== undefined) store.dispatch(setURLBarEnabled(change.urlBarEnabled));
  if (change.externalInputsEnabled !== undefined) store.dispatch(setExternalInputsEnabled(change.externalInputsEnabled));
  // Several inputs at once needs inputs on (the switch is greyed without them).
  if (change.externalInputsEnabled === false) store.dispatch(setMultipleInputsEnabled(false));
  else if (change.multipleInputsEnabled !== undefined) store.dispatch(setMultipleInputsEnabled(change.multipleInputsEnabled));
}
