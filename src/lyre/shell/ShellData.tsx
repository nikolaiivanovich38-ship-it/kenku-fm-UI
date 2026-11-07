import React, { createContext, useContext } from "react";
import type { LyreApi } from "../../common/lyre/api";
import type { PlaceNames } from "./history";
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
  /** Its name for screen readers and speech control: what is seen, then in words, e.g. "Live: S14, session 14" (WCAG 2.5.3). */
  liveName?: string;
  /** The rail's Rooms link, e.g. "Rooms (1/2)": bots connected of all bots. */
  outputsLabel?: string;
  /** UX-18: the names of campaigns, sessions, playlists, boards and tracks, for Back's label and the trail. */
  placeNames?: PlaceNames;
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
