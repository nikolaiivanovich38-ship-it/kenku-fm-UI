import { configureStore } from "@reduxjs/toolkit";

import playlistsReducer from "../features/playlists/playlistsSlice";
import playlistPlaybackReducer from "../features/playlists/playlistPlaybackSlice";
import soundboardsReducer from "../features/soundboards/soundboardsSlice";
import soundboardPlaybackReducer from "../features/soundboards/soundboardPlaybackSlice";

/**
 * A player Redux store with the real reducers and no redux-persist, for hook
 * and component tests (WP0 S3). Same state shape as `app/store.ts`.
 */
export function createPlayerStore() {
  return configureStore({
    reducer: {
      playlists: playlistsReducer,
      soundboards: soundboardsReducer,
      playlistPlayback: playlistPlaybackReducer,
      soundboardPlayback: soundboardPlaybackReducer,
    },
  });
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;
