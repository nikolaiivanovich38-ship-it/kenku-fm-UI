import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

import settingsReducer, { setStreamingMode, setURLBarEnabled } from "./settingsSlice";
import { startWindowSettingsSync, type WindowSettingsPort } from "./windowSettingsSync";

function setup() {
  const store = configureStore({ reducer: { settings: settingsReducer } });
  let onSet: ((change: unknown) => void) | null = null;
  const port = {
    report: vi.fn((_settings: unknown) => undefined),
    onSet: (listener: (change: unknown) => void) => {
      onSet = listener;
      return () => {
        onSet = null;
      };
    },
  };
  const stop = startWindowSettingsSync(store, port satisfies WindowSettingsPort);
  return { store, port, stop, set: (change: unknown) => onSet?.(change), listening: () => onSet !== null };
}

describe("the main window's settings, shared with Settings in Lyre (OUT-8)", () => {
  it("tells the main process its four settings at once and after each change of them", () => {
    const { store, port } = setup();
    expect(port.report).toHaveBeenLastCalledWith({ streamingMode: "performance", urlBarEnabled: true, externalInputsEnabled: false, multipleInputsEnabled: false });
    store.dispatch(setStreamingMode("lowLatency"));
    expect(port.report).toHaveBeenLastCalledWith(expect.objectContaining({ streamingMode: "lowLatency" }));
    expect(port.report).toHaveBeenCalledTimes(2);
    store.dispatch(setURLBarEnabled(false));
    expect(port.report).toHaveBeenCalledTimes(3);
  });

  it("does not tell again when nothing it shares changed", () => {
    const { store, port } = setup();
    store.dispatch({ type: "settings/setRemotePort", payload: "4000" });
    expect(port.report).toHaveBeenCalledTimes(1);
  });

  it("takes a change from Settings in Lyre into its own settings (which it saves, as before)", () => {
    const { store, set } = setup();
    set({ streamingMode: "lowLatency", externalInputsEnabled: true });
    expect(store.getState().settings).toMatchObject({ streamingMode: "lowLatency", externalInputsEnabled: true });
    set({ multipleInputsEnabled: true });
    expect(store.getState().settings.multipleInputsEnabled).toBe(true);
  });

  it("turning off inputs turns off several inputs at once too, as Settings in Lyre shows it", () => {
    const { store, set } = setup();
    set({ externalInputsEnabled: true, multipleInputsEnabled: true });
    set({ externalInputsEnabled: false });
    expect(store.getState().settings).toMatchObject({ externalInputsEnabled: false, multipleInputsEnabled: false });
  });

  it("ignores a change of another shape", () => {
    const { store, set } = setup();
    const before = store.getState().settings;
    set({ remoteEnabled: true });
    set({ streamingMode: "loud" });
    set(null);
    expect(store.getState().settings).toEqual(before);
  });

  it("stops both ways when stopped", () => {
    const { store, port, stop, listening } = setup();
    stop();
    store.dispatch(setStreamingMode("lowLatency"));
    expect(port.report).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(false);
  });
});
