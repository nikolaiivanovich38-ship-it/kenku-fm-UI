import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Tab {
  id: number;
  url: string;
  title: string;
  icon: string;
  /** The number of media tracks playing on this tab */
  playingMedia: number;
  muted: boolean;
  /**
   * SEC-15: "local-file" for a tab showing a file from the user's computer
   * (its own partition, opened only after the user agreed). Left out for
   * website tabs.
   */
  kind?: "local-file";
}

export interface TabsState {
  tabs: {
    byId: Record<number, Tab>;
    allIds: number[];
  };
  selectedTab?: number;
}

const initialState: TabsState = {
  tabs: {
    byId: {},
    allIds: [],
  },
};

export const tabsSlice = createSlice({
  name: "tabs",
  initialState,
  reducers: {
    addTab: (state, action: PayloadAction<Tab>) => {
      state.tabs.byId[action.payload.id] = action.payload;
      state.tabs.allIds.push(action.payload.id);
    },
    removeTab: (state, action: PayloadAction<number>) => {
      delete state.tabs.byId[action.payload];
      state.tabs.allIds = state.tabs.allIds.filter(
        (id) => id !== action.payload
      );
      if (action.payload === state.selectedTab) {
        state.selectedTab = undefined;
      }
    },
    /**
     * SEC-15: a file or a web page that cannot open in the current tab (files
     * and websites never share a tab) opens in a new view, which takes the old
     * tab's place in the tab bar. The caller closes the old view.
     */
    replaceTab: (state, action: PayloadAction<{ oldId: number; tab: Tab }>) => {
      const { oldId, tab } = action.payload;
      const index = state.tabs.allIds.indexOf(oldId);
      delete state.tabs.byId[oldId];
      state.tabs.byId[tab.id] = tab;
      if (index === -1) {
        state.tabs.allIds.push(tab.id);
      } else {
        state.tabs.allIds[index] = tab.id;
      }
      if (state.selectedTab === oldId) {
        state.selectedTab = tab.id;
      }
    },
    selectTab: (state, action: PayloadAction<number>) => {
      if (state.selectedTab) {
        window.kenku.hideBrowserView(state.selectedTab);
      }
      state.selectedTab = action.payload;
      window.kenku.showBrowserView(action.payload);
    },
    editTab: (state, action: PayloadAction<Partial<Tab>>) => {
      if (!action.payload.id) {
        throw Error("Id needed in editBrowserView payload");
      }
      if (action.payload.id in state.tabs.byId) {
        state.tabs.byId[action.payload.id] = {
          ...state.tabs.byId[action.payload.id],
          ...action.payload,
        };
      }
    },
    moveTab: (
      state,
      action: PayloadAction<{ active: number; over: number }>
    ) => {
      const oldIndex = state.tabs.allIds.indexOf(action.payload.active);
      const newIndex = state.tabs.allIds.indexOf(action.payload.over);
      state.tabs.allIds.splice(oldIndex, 1);
      state.tabs.allIds.splice(newIndex, 0, action.payload.active);
    },
    increaseTabPlayingMedia: (state, action: PayloadAction<number>) => {
      if (action.payload in state.tabs.byId) {
        state.tabs.byId[action.payload].playingMedia += 1;
      }
    },
    decreaseTabPlayingMedia: (state, action: PayloadAction<number>) => {
      if (action.payload in state.tabs.byId) {
        state.tabs.byId[action.payload].playingMedia = Math.max(
          state.tabs.byId[action.payload].playingMedia - 1,
          0
        );
      }
    },
  },
});

export const {
  addTab,
  removeTab,
  replaceTab,
  selectTab,
  editTab,
  moveTab,
  increaseTabPlayingMedia,
  decreaseTabPlayingMedia,
} = tabsSlice.actions;

export default tabsSlice.reducer;
