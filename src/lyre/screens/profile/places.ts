/**
 * Places: a track's own settings (key "") apply everywhere, unless a playlist ("pl:<id>") or a scene
 * ("sc:<campaign>:<session>:<scene>") has its own. Ported from the prototype (design/prototype/src/views/profile.js:
 * placeName, hasOwn, places, sceneOf, contexts), reading the lists the screen loaded from LyreApi.
 */
import {
  parsePlaceKey,
  playlistTracks,
  sceneSequence,
  usesOfPlaylist,
  usesOfTrack,
  type DomainLookup,
  type ProfileOverrides,
} from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PlaylistInfo, SceneInfo, SessionInfo } from "../../../common/lyre/api";
import { lookupFrom } from "../../../common/lyre/lookup";

/** What the screen loaded, with quick look-ups. */
export interface LibraryView {
  tracks: LibraryTrack[];
  playlists: PlaylistInfo[];
  campaigns: CampaignInfo[];
  overrides: ProfileOverrides;
  lookup: DomainLookup;
  track(id: string): LibraryTrack | undefined;
}

export function libraryView(tracks: LibraryTrack[], playlists: PlaylistInfo[], campaigns: CampaignInfo[], overrides: ProfileOverrides): LibraryView {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return { tracks, playlists, campaigns, overrides, lookup: lookupFrom(tracks, playlists), track: (id) => byId.get(id) };
}

export interface PlaceOption {
  key: string;
  label: string;
}

/** A scene's key, read back: its campaign, session and position. */
export function sceneOf(key: string, view: LibraryView): { campaign: CampaignInfo; session: SessionInfo; index: number; scene: SceneInfo } | null {
  const place = parsePlaceKey(key);
  if (!place || place.kind !== "scene") return null;
  const campaign = view.campaigns.find((c) => c.id === place.campaignId);
  const session = campaign?.sessions.find((s) => s.id === place.sessionId);
  const index = session ? session.scenes.findIndex((s) => s.id === place.sceneId) : -1;
  return campaign && session && index > -1 ? { campaign, session, index, scene: session.scenes[index] } : null;
}

function playlistOf(key: string, view: LibraryView): PlaylistInfo | undefined {
  const place = parsePlaceKey(key);
  return place?.kind === "playlist" ? view.playlists.find((p) => p.id === place.playlistId) : undefined;
}

/** "the playlist Gothic dread", "the scene The abbey ruins", or "the track's own settings". */
export function placeName(key: string, view: LibraryView): string {
  if (!key) return "the track's own settings";
  if (key.startsWith("pl:")) return `the playlist ${playlistOf(key, view)?.name ?? key.slice(3)}`;
  return `the scene ${sceneOf(key, view)?.scene.name ?? key.split(":")[3] ?? key}`;
}

/** True when this place has settings of its own for the track (the track's own settings always do). */
export function hasOwn(trackId: string, key: string, overrides: ProfileOverrides): boolean {
  return key ? Boolean(overrides[key]?.[trackId]) : true;
}

/** Places that have their own settings for this track. */
export function ownPlaceKeys(trackId: string, overrides: ProfileOverrides): string[] {
  return Object.keys(overrides).filter((k) => overrides[k]?.[trackId]);
}

/** Every place this track plays: playlists that contain it, and scenes that use it directly or through a playlist. */
export function placesOf(trackId: string, view: LibraryView): { pls: PlaceOption[]; scs: PlaceOption[] } {
  const pls: PlaceOption[] = [];
  const scs: PlaceOption[] = [];
  const seen = new Set<string>([""]);
  const add = (list: PlaceOption[], key: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ key, label });
  };
  const addScene = (campaignId: string, sessionId: string, sceneId: string) => {
    const key = `sc:${campaignId}:${sessionId}:${sceneId}`;
    const found = sceneOf(key, view);
    if (found) add(scs, key, `${found.scene.name} (${found.campaign.name}, session ${found.session.number})`);
  };
  const inPlaylists = view.playlists.filter((p) => playlistTracks(p, view.lookup).some((t) => t.id === trackId));
  inPlaylists.forEach((p) => add(pls, `pl:${p.id}`, p.name));
  usesOfTrack(trackId, view.campaigns).forEach((u) => u.level === "scene" && addScene(u.campaignId, u.sessionId, u.sceneId));
  inPlaylists.forEach((p) => usesOfPlaylist(p.id, view.campaigns).forEach((u) => u.level === "scene" && addScene(u.campaignId, u.sessionId, u.sceneId)));
  // Places that kept their own settings after the track left them still show, so those settings can be seen and removed.
  ownPlaceKeys(trackId, view.overrides).forEach((k) => add(k.startsWith("pl:") ? pls : scs, k, placeName(k, view).replace(/^the (playlist|scene) /, "")));
  return { pls, scs };
}

/** Where "the next track" comes from in the preview: its label, the next track's id and the place it plays in. */
export interface NextContext {
  label: string;
  next: string;
  place: string;
  /** Not in a scene or playlist yet: the next Library track stands in. */
  lib?: boolean;
}

/** The next track after this one in a list, round to the start, skipping copies of itself; null when there is none. */
function nextIn(list: string[], trackId: string): string | null {
  const i = list.indexOf(trackId);
  if (i < 0) return null;
  for (let j = 1; j < list.length; j++) {
    const n = list[(i + j) % list.length];
    if (n !== trackId) return n;
  }
  return null;
}

function nextInPlaylist(key: string, trackId: string, view: LibraryView): string | null {
  const p = playlistOf(key, view);
  return p ? nextIn(playlistTracks(p, view.lookup).map((t) => t.id), trackId) : null;
}

function nextInScene(key: string, trackId: string, view: LibraryView): string | null {
  const found = sceneOf(key, view);
  return found ? nextIn(sceneSequence(found.scene, view.lookup).map((s) => s.trackId), trackId) : null;
}

/**
 * What plays after End when the track moves on. In a place, that place decides; for the track's own settings, each
 * scene or playlist that uses them (places with their own settings are left out), or the Library if none does yet.
 */
export function nextContexts(trackId: string, key: string, view: LibraryView): NextContext[] {
  const out: NextContext[] = [];
  if (key) {
    if (key.startsWith("pl:")) {
      const n = nextInPlaylist(key, trackId, view);
      if (n) out.push({ label: `Next in the playlist ${playlistOf(key, view)?.name ?? ""}`, next: n, place: key });
    } else {
      const n = nextInScene(key, trackId, view);
      if (n) out.push({ label: `Next in the scene ${sceneOf(key, view)?.scene.name ?? ""}`, next: n, place: key });
    }
    if (out.length) return out;
  }
  const { pls, scs } = placesOf(trackId, view);
  for (const s of scs) {
    if (hasOwn(trackId, s.key, view.overrides)) continue;
    const n = nextInScene(s.key, trackId, view);
    if (n) out.push({ label: `In the scene ${s.label}`, next: n, place: s.key });
  }
  for (const p of pls) {
    if (hasOwn(trackId, p.key, view.overrides)) continue;
    const n = nextInPlaylist(p.key, trackId, view);
    if (n) out.push({ label: `In the playlist ${p.label}`, next: n, place: p.key });
  }
  if (!out.length) {
    const t = view.track(trackId);
    const same = view.tracks.filter((x) => x.kind === t?.kind);
    const k = same.findIndex((x) => x.id === trackId);
    const n = same[(k + 1) % same.length];
    if (n) out.push({ label: "The next track in the Library", next: n.id, place: "", lib: true });
  }
  return out;
}
