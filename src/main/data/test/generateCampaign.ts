/**
 * Builds a large campaign for the performance tests (DAT-11): sessions of
 * scenes, each scene with a music list mixing tracks and playlists, an
 * ambience item and two pad boards; playlists and boards at campaign and
 * session level. Deterministic, like generateLibrary.
 */
import type { Library } from "../library";
import { addPad, createBoard } from "../repo/boards";
import {
  addSceneBoards,
  addSceneMusic,
  addToCampaign,
  addToSession,
  createCampaign,
  createScene,
  createSession,
  setSceneAmbience,
} from "../repo/campaigns";
import { addTracksToPlaylist, createPlaylist } from "../repo/playlists";

export function generateCampaign(
  library: Library,
  options: { sessions: number; scenesPerSession: number; trackIds: string[] },
): { campaignId: string; playlistIds: string[]; boardIds: string[] } {
  const { store } = library;
  const { trackIds } = options;
  const at = (i: number) => trackIds[(i * 7919) % trackIds.length];
  return store.changeWithoutHistory(() => {
    const playlistIds = Array.from({ length: 20 }, (_, i) => {
      const p = createPlaylist(store, { title: `Campaign music ${i}`, lane: i % 4 === 0 ? "amb" : "music" });
      addTracksToPlaylist(store, p.id, Array.from({ length: 12 }, (_, j) => at(i * 100 + j)));
      return p.id;
    });
    const boardIds = Array.from({ length: 6 }, (_, i) => {
      const b = createBoard(store, { title: `Board ${i}` });
      for (let j = 0; j < 8; j++) addPad(store, b.id, { label: `Pad ${j}`, sound: { kind: "variants", trackIds: [at(i * 10 + j), at(i * 10 + j + 1)] } });
      return b.id;
    });
    const campaign = createCampaign(store, { name: "The long campaign", theme: "hearth" });
    addToCampaign(store, campaign.id, { playlistIds: playlistIds.slice(0, 6), boardIds: boardIds.slice(0, 2) });
    for (let s = 0; s < options.sessions; s++) {
      const session = createSession(store, { campaignId: campaign.id, name: `Session ${s + 1}` });
      addToSession(store, session.id, { playlistIds: [playlistIds[(s + 6) % 20]], boardIds: [boardIds[s % 6]] });
      for (let c = 0; c < options.scenesPerSession; c++) {
        const n = s * options.scenesPerSession + c;
        const scene = createScene(store, { sessionId: session.id, name: `Scene ${n}`, startsWhen: "Roll initiative" });
        addSceneMusic(store, scene.id, [
          { kind: "track", id: at(n) },
          { kind: "playlist", id: playlistIds[(n % 15) + 1] },
          { kind: "track", id: at(n + 1) },
          { kind: "playlist", id: playlistIds[(n + 3) % 20] },
        ]);
        setSceneAmbience(store, scene.id, n % 2 ? { kind: "playlist", id: playlistIds[(n % 5) * 4] } : { kind: "track", id: at(n + 2) });
        addSceneBoards(store, scene.id, [boardIds[n % 6], boardIds[(n + 1) % 6]]);
      }
    }
    return { campaignId: campaign.id, playlistIds, boardIds };
  });
}
