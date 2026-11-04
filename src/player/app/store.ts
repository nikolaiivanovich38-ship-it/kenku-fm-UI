import { combineReducers, configureStore } from "@reduxjs/toolkit";
import playlistsReducer from "../features/playlists/playlistsSlice";
import soundboardsReducer from "../features/soundboards/soundboardsSlice";
import playlsitPlaybackReducer from "../features/playlists/playlistPlaybackSlice";
import soundboardPlaybackReducer from "../features/soundboards/soundboardPlaybackSlice";

import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import { createThrottledStorage } from "./throttledStorage";

/**
 * PERF-6: while the user holds a mouse button or key down (dragging a slider,
 * holding an arrow key), the library and the player settings are each written
 * at most once a second; letting go writes the final value at once. All other
 * changes are written straight away, as in Kenku FM (see throttledStorage.ts).
 */
export const SAVE_THROTTLE_MS = 1000;

let holding = false;
export const storage = createThrottledStorage(
  window.localStorage,
  SAVE_THROTTLE_MS,
  () => holding,
);

const playbackPersistConfig = {
  key: "playback",
  version: 1,
  storage,
  whitelist: ["volume", "muted", "shuffle", "repeat"],
};

const rootReducer = combineReducers({
  playlists: playlistsReducer,
  soundboards: soundboardsReducer,
  playlistPlayback: persistReducer(
    playbackPersistConfig,
    playlsitPlaybackReducer
  ),
  soundboardPlayback: soundboardPlaybackReducer,
});

const persistConfig = {
  key: "player",
  version: 1,
  storage,
  whitelist: ["playlists", "soundboards"],
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

/**
 * Track whether the user is holding a mouse button or key, and write waiting
 * changes as soon as they let go, or when the page loses focus, is hidden or
 * is reloaded. Both steps are synchronous: persistor.flush() hands
 * redux-persist's queued changes to `storage`, and storage.flush() writes them.
 * Capture phase, so a control that stops the event still lets it through here.
 */
function saveWhenUserLetsGo() {
  const saveNow = () => {
    holding = false;
    persistor.flush();
    storage.flush();
  };
  const hold = () => {
    holding = true;
  };
  window.addEventListener("pointerdown", hold, true);
  window.addEventListener("keydown", hold, true);
  for (const event of ["pointerup", "pointercancel", "keyup", "blur", "pagehide"]) {
    window.addEventListener(event, saveNow, true);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveNow();
    }
  });
}
saveWhenUserLetsGo();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
