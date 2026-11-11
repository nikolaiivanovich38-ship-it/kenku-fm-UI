import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { loadShellSettings, saveShellSettings, type ShellSettings } from "./settings";

interface ShellSettingsValue {
  settings: ShellSettings;
  /** Change some settings and remember them. */
  update: (change: Partial<ShellSettings>) => void;
}

const ShellSettingsContext = createContext<ShellSettingsValue | null>(null);

/** Holds the remembered shell settings (theme, rail, open and closed boxes) for the whole page. */
export function ShellSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(loadShellSettings);
  const update = useCallback((change: Partial<ShellSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      saveShellSettings(next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <ShellSettingsContext.Provider value={value}>{children}</ShellSettingsContext.Provider>;
}

export function useShellSettings(): ShellSettingsValue {
  const value = useContext(ShellSettingsContext);
  if (!value) {
    throw new Error("useShellSettings needs a ShellSettingsProvider around it");
  }
  return value;
}

/**
 * A box's open or closed state, remembered by its id. Without a provider (a component test of one box) it is kept
 * for the visit only.
 */
export function useRememberedOpen(id: string, openByDefault: boolean): [boolean, (open: boolean) => void] {
  const shared = useContext(ShellSettingsContext);
  const [local, setLocal] = useState(openByDefault);
  if (!shared) {
    return [local, setLocal];
  }
  const stored = shared.settings.panes[id];
  const open = stored === undefined ? openByDefault : stored === "o";
  return [open, (next) => shared.update({ panes: { ...shared.settings.panes, [id]: next ? "o" : "c" } })];
}
