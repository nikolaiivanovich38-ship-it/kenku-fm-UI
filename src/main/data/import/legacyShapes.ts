/**
 * FND-16 (0.5.1): the frozen shapes of what the old player (Kenku FM, Cue Desk and Lyre up to 0.5.0) kept in its
 * storage under "persist:player": its playlists and soundboards, as its redux slices wrote them. The old player is
 * gone; Lyre still reads this storage on the first start (legacy.ts importLegacyLibrary) and once after it (the
 * catch-up), so the shapes are kept here, unchanged, instead of in the old player's code.
 */

export interface Track {
  id: string;
  url: string;
  title: string;
}

export interface Playlist {
  tracks: string[];
  background: string;
  title: string;
  id: string;
}

export interface PlaylistsState {
  playlists: {
    byId: Record<string, Playlist>;
    allIds: string[];
  };
  tracks: Record<string, Track>;
}

export interface Sound {
  id: string;
  url: string;
  title: string;
  loop: boolean;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Soundboard {
  sounds: string[];
  background: string;
  title: string;
  id: string;
}

export interface SoundboardsState {
  soundboards: {
    byId: Record<string, Soundboard>;
    allIds: string[];
  };
  sounds: Record<string, Sound>;
}

/**
 * A file's address as the old player wrote it when a file was dropped on it (Kenku FM's encodeFilePath): file:// and
 * the path, encoded, with "/" or "\" as "/". For tests that build an old player's storage.
 */
export function encodeFilePath(path: string): string {
  return `file://${encodeURIComponent(path)
    .replace(/(%2F)|(%5C)/g, "/")
    .replace(/%3A/g, ":")}`;
}
