import React, { createContext, useContext } from "react";
import type { LyreApi } from "../../common/lyre/api";
import type { ThemeId } from "./themes";

/**
 * What the shell shows from the library and the audio host. The shell has no data of its own: wave 3 wiring (see
 * src/lyre/AppProviders.tsx) supplies these from LyreApi and LyreAudio. Every field is optional, and the shell
 * works without any of them (plain labels, the default theme, no Now playing bar).
 */
export interface ShellData {
  /** A campaign's own table theme, if it has one. */
  campaignTheme?: (campaignId: string) => ThemeId | undefined;
  /** The campaign of the session loaded in Live (Live shows that campaign's theme). */
  liveCampaign?: string;
  /** The rail's Live link, e.g. "Live: S14" while a session is loaded. */
  liveLabel?: string;
  /** The same as a screen reader should say it, e.g. "Live: session 14" (S14 is read letter by letter). */
  liveName?: string;
  /** The rail's Outputs link, e.g. "Outputs (1/2)": bots connected of all bots. */
  outputsLabel?: string;
  /** The library's history, for the undo message and Ctrl+Z (shell/UndoNote.tsx). */
  history?: Pick<LyreApi["history"], "state" | "undo">;
  /**
   * UX-16 the Now playing bar at the foot of every screen (from the audio host). The shell tells it when the screen
   * shows the rooms itself (Live: `showsOnAir`), so it shows only the preview there.
   */
  NowPlayingBar?: React.ComponentType<{ previewOnly: boolean }>;
}

const ShellDataContext = createContext<ShellData>({});

export function ShellDataProvider({ value, children }: { value: ShellData; children: React.ReactNode }) {
  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellData {
  return useContext(ShellDataContext);
}
