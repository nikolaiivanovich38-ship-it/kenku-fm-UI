/**
 * Places and origins in words (design round 5: UX-16, PLY-13), so every screen says them the same way. Ported from
 * the prototype: core.js L.placeLabel and the Now playing bar's originOf, views/_shared.js whereWords.
 * Pure: the names come in through PlaceNames (screens build one from the campaign trees).
 */
import type { UsePlace } from "./round5";

/** The names a place's words need. Each answers undefined when the place has gone. */
export interface PlaceNames {
  campaign(campaignId: string): string | undefined;
  session(campaignId: string, sessionId: string): { number: number; name: string } | undefined;
  scene(campaignId: string, sessionId: string, sceneId: string): string | undefined;
}

function sessionWords(session: { number: number; name: string }): string {
  return `Session ${session.number}${session.name.trim() ? `: ${session.name.trim()}` : ""}`;
}

/** "The abbey ruins (Session 14)", "Session 14: The Drowned Abbey", "The Sunken Crown"; "a scene" once it has gone. */
export function placeLabel(place: UsePlace, names: PlaceNames): string {
  if (place.kind === "campaign") return names.campaign(place.campaignId) ?? "a campaign";
  const session = names.session(place.campaignId, place.sessionId);
  if (place.kind === "session") return session ? sessionWords(session) : "a session";
  const scene = session && names.scene(place.campaignId, place.sessionId, place.sceneId);
  return scene ? `${scene} (Session ${session.number})` : "a scene";
}

/**
 * PLY-13: where a play order applies, to follow "Play order" or "Only": "in the scene The abbey ruins",
 * "in Session 14: The Drowned Abbey", "in The Sunken Crown"; a playlist's own order (no place) applies
 * "everywhere it has no order of its own".
 */
export function orderPlaceWords(place: UsePlace | null, names: PlaceNames): string {
  if (!place) return "everywhere it has no order of its own";
  if (place.kind === "scene") {
    const session = names.session(place.campaignId, place.sessionId);
    return `in the scene ${(session && names.scene(place.campaignId, place.sessionId, place.sceneId)) ?? "that has gone"}`;
  }
  return `in ${placeLabel(place, names)}`;
}

/**
 * UX-16: where what plays comes from, for the Now playing bar: "Scene: The abbey ruins (Session 14) · Abbey: eerie,
 * low energy", "Playlist: The Company themes · The Sunken Crown", "Single track".
 */
export function originWords(from: { place: UsePlace | null; playlistName: string | null }, names: PlaceNames): string {
  const { place, playlistName } = from;
  if (place?.kind === "scene") return `Scene: ${placeLabel(place, names)}${playlistName ? ` · ${playlistName}` : ""}`;
  if (playlistName) return `Playlist: ${playlistName}${place ? ` · ${placeLabel(place, names)}` : ""}`;
  return "Single track";
}
