import React from "react";
import type { Route, RouteName } from "../shell/routes";
import { BoardScreen } from "./boards/BoardScreen";
import { BoardsScreen } from "./boards/BoardsScreen";
import { LibraryScreen } from "./library/LibraryScreen";
import { PlaylistScreen, PlaylistsScreen } from "./library/PlaylistsScreen";
import { LookScreen } from "./look/LookScreen";
import { ComingScreen } from "./Placeholder";
import { CampaignScreen, CampaignsScreen, SessionScreen } from "./campaigns";
import { ProfileScreen } from "./profile/ProfileScreen";
import { BackupScreen } from "./transfer/BackupScreen";
import { MovedScreen } from "./transfer/MovedScreen";
import { RelinkScreen } from "./transfer/RelinkScreen";

/** What every screen gets: the route it was opened at (its ids are in route.params). */
export interface ScreenProps {
  route: Route;
}

export type ScreenComponent = React.ComponentType<ScreenProps> & {
  /**
   * True for a screen that shows what is on air itself (the Live screen, wave 4): the shell leaves out its On air
   * bar there. Every other screen, the "comes in 0.4" pages included, keeps the bar while anything plays (BUG-13).
   */
  showsOnAir?: boolean;
};

/** Live and Outputs come in Lyre 0.4; until then their page says so (ComingScreen). */
function comingLater(title: string): ScreenComponent {
  const Screen = () => <ComingScreen title={title} />;
  Screen.displayName = `${title} (comes in 0.4)`;
  return Screen;
}

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
  live: comingLater("Live"),
  outputs: comingLater("Outputs"),
  look: LookScreen,
  // Round 5: Back up, move or share; What came across from Kenku FM; Find missing files (w4-transfer).
  backup: BackupScreen,
  moved: MovedScreen,
  relink: RelinkScreen,
};
