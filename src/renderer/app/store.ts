import { combineReducers, configureStore } from "@reduxjs/toolkit";
import connectionReducer from "../features/connection/connectionSlice";
import outputReducer from "../features/output/outputSlice";
import settingsReducer from "../features/settings/settingsSlice";
import bookmarksReducer from "../features/bookmarks/bookmarksSlice";
import { bookmarkMigrations } from "../features/bookmarks/bookmarksMigration";
import tabsReducer from "../features/tabs/tabsSlice";
import playerReducer from "../features/player/playerSlice";
import lyreReducer from "../features/lyre/lyreSlice";
import inputReducer from "../features/input/inputSlice";
import errorsReducer from "../features/errors/errorsSlice";

import {
  persistStore,
  persistReducer,
  createMigrate,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import storage from "redux-persist/lib/storage";
import { moveTokenOutOfSettings } from "../features/settings/tokenMigration";

const rootReducer = combineReducers({
  connection: connectionReducer,
  output: outputReducer,
  settings: settingsReducer,
  bookmarks: bookmarksReducer,
  tabs: tabsReducer,
  player: playerReducer,
  // WP5: the built-in "Lyre" tab (new interface); not saved, like the player tab.
  lyre: lyreReducer,
  input: inputReducer,
  // Error messages on screen (UX finding 4); not saved.
  errors: errorsReducer,
});

const migrations: any = {
  2: (state: RootState): RootState => {
    return {
      ...state,
      settings: {
        ...state.settings,
        urlBarEnabled: true,
        remoteEnabled: false,
        remoteAddress: "127.0.0.1",
        remotePort: "3333",
        externalInputsEnabled: false,
        multipleInputsEnabled: false,
      },
    };
  },
  // v1.1 - Add performance mode
  3: (state: RootState): RootState => {
    return {
      ...state,
      settings: {
        ...state.settings,
        streamingMode: "performance",
      },
    };
  },
  // UX-10 (version 5): bookmark folders and the collapsible sidebar
  ...bookmarkMigrations,

  // WP2 SEC-5 (version 6): the bot token moves to the main process
  // (encrypted) and is removed from this storage; OUT-1: "Multiple Outputs" is gone.
  6: (state: RootState): RootState =>
    moveTokenOutOfSettings(state, (token) => window.kenku.outputs.importLegacyToken(token)),
};

const persistConfig = {
  key: "root",
  version: 6,
  storage,
  whitelist: ["bookmarks", "settings"],
  migrate: createMigrate(migrations, { debug: false }),
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
