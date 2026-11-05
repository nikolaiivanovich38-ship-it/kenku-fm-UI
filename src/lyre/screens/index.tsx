import React from "react";
import type { Route, RouteName } from "../shell/routes";
import { BoardScreen } from "./boards/BoardScreen";
import { BoardsScreen } from "./boards/BoardsScreen";
import { LibraryScreen } from "./library/LibraryScreen";
import { PlaylistScreen, PlaylistsScreen } from "./library/PlaylistsScreen";
import { LookPlaceholder } from "./LookPlaceholder";
import { PlaceholderScreen } from "./Placeholder";
import { CampaignScreen, CampaignsScreen, SessionScreen } from "./campaigns";
import { ProfileScreen } from "./profile/ProfileScreen";

/** What every screen gets: the route it was opened at (its ids are in route.params). */
export interface ScreenProps {
  route: Route;
}

export type ScreenComponent = React.ComponentType<ScreenProps>;

function placeholder(title: string): ScreenComponent {
  const Screen = () => <PlaceholderScreen title={title} />;
  Screen.displayName = `${title} (not built yet)`;
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
  live: placeholder("Live"),
  outputs: placeholder("Outputs"),
  look: LookPlaceholder,
};
