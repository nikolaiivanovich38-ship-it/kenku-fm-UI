import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Tab } from "../tabs/tabsSlice";

import icon from "../../../assets/icons/32x32.png";

/**
 * WP5 (w3-shell): the built-in "Lyre" tab, the new interface beside the old
 * player tab. Like the player, it is not saved between starts: its view is
 * created afresh each time (id -1 until then).
 */
export interface LyreState {
  tab: Tab;
}

const initialState: LyreState = {
  tab: {
    id: -1,
    icon,
    url: window.kenku.lyreGetURL(),
    title: "Lyre",
    playingMedia: 0,
    muted: false,
  },
};

export const lyreSlice = createSlice({
  name: "lyre",
  initialState,
  reducers: {
    setLyreId: (state, action: PayloadAction<number>) => {
      state.tab.id = action.payload;
    },
  },
});

export const { setLyreId } = lyreSlice.actions;

/**
 * True for the app's own tabs (the old player and Lyre): they have no close
 * button and Ctrl+W leaves them open.
 */
export function isBuiltInTab(
  id: number | undefined,
  builtIn: { playerId: number; lyreId: number },
): boolean {
  return id !== undefined && id !== -1 && (id === builtIn.playerId || id === builtIn.lyreId);
}

export default lyreSlice.reducer;
