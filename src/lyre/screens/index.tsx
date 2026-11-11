import React from "react";
import type { Route, RouteName } from "../shell/routes";
import { BoardScreen } from "./boards/BoardScreen";
import { BoardsScreen } from "./boards/BoardsScreen";
import { LibraryScreen } from "./library/LibraryScreen";
import { PlaylistScreen, PlaylistsScreen } from "./library/PlaylistsScreen";
import { LiveScreen } from "./live/LiveScreen";
import { LookScreen } from "./look/LookScreen";
import { CampaignScreen, CampaignsScreen, SessionScreen } from "./campaigns";
import { OutputsScreen } from "./outputs/OutputsScreen";
import { ProfileScreen } from "./profile/ProfileScreen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { BackupScreen } from "./transfer/BackupScreen";
import { MovedScreen } from "./transfer/MovedScreen";
import { RelinkScreen } from "./transfer/RelinkScreen";
import { TagsScreen } from "./tags/TagsScreen";

/** What every screen gets: the route it was opened at (its ids are in route.params). */
export interface ScreenProps {
  route: Route;
}

export type ScreenComponent = React.ComponentType<ScreenProps> & {
  /**
   * True for a screen that shows what is on air itself (the Live screen): the shell's Now playing bar shows only the
   * preview there (UX-16). Every other screen shows every row (BUG-13).
   */
  showsOnAir?: boolean;
};

/**
 * The screen for each route. Each screen renders its own `.viewhead` with one h1 (the shell moves focus there when the
 * route changes) and its `.viewbody`. Wave 3 screen streams build theirs in src/lyre/screens/<screen>/ and the lead
 * swaps the placeholder below for it, e.g. `library: LibraryScreen,`.
 */
export const SCREENS: Record<RouteName, ScreenComponent> = {
  campaigns: CampaignsScreen,
  campaign: CampaignScreen,
  session: SessionScreen,
  library: LibraryScreen,
  playlists: PlaylistsScreen,
  playlist: PlaylistScreen,
  profile: ProfileScreen,
  boards: BoardsScreen,
  board: BoardScreen,
  live: LiveScreen,
  outputs: OutputsScreen,
  // w6-rooms (OUT-8): Settings in Lyre.
  settings: SettingsScreen,
  look: LookScreen,
  // Round 5: Back up, move or share; What came across from Kenku FM; Find missing files (w4-transfer).
  backup: BackupScreen,
  moved: MovedScreen,
  relink: RelinkScreen,
  // Round 7 (DAT-10): the tag vocabulary (w6-prep).
  tags: TagsScreen,
};
