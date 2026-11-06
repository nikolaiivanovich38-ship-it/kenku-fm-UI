/**
 * PLY-15: the library's Normalise volume setting for the Library and Playlists screens (LyreApi
 * library.normaliseSettings). A change to it is a "tracks" change, so the query reloads with the tracks.
 */
import { DEFAULT_LIBRARY_NORMALISE, type LibraryNormalise } from "../../../common/domain";
import { useLyreQuery } from "../../api";

export function useNormaliseSettings(): LibraryNormalise {
  return useLyreQuery("normalise-settings", (api) => api.library.normaliseSettings(), ["tracks"]).data ?? DEFAULT_LIBRARY_NORMALISE;
}
