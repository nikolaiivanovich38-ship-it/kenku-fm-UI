/**
 * ORG-5 (design round 7, r7org.js places): where dragged tracks can go. Manual playlists of the same kind (the
 * campaign's first; effects can also go to a music playlist when every track is music), pad boards as new pads (for
 * effects and stings), Up next in each room, and the scenes of the campaign's next session.
 */
import { isFx } from "../../../common/domain";
import type { CampaignInfo, LibraryTrack, PadBoard, PlaylistInfo, SessionInfo } from "../../../common/lyre/api";

export interface DropTarget {
  /** "Playlists", "Pad boards", "Up next", "Scenes in Session 14". */
  group: string;
  /** The prototype's key: pl:<id>, pb:<board>, q:<room>, sc:<campaign>:<session>:<scene>. */
  key: string;
  name: string;
  /** How Add to… lists it when the name alone is not enough ("Session 14 › The abbey ruins"). */
  label?: string;
}

export interface PlaceWorld {
  playlists: readonly PlaylistInfo[];
  boards: readonly PadBoard[];
  rooms: readonly { roomId: string; name: string }[];
  campaign: CampaignInfo | null;
  session: SessionInfo | null;
}

export function dropTargets(tracks: readonly LibraryTrack[], from: string | null, world: PlaceWorld): DropTarget[] {
  const out: DropTarget[] = [];
  const first = tracks[0];
  const lane = first ? (isFx(first) ? "fx" : first.kind) : "music";
  const inCampaign = (id: string) => (world.campaign?.playlistIds.includes(id) ? 1 : 0);
  world.playlists
    .filter((p) => p.kind === "manual" && p.id !== from && (p.lane === lane || (lane === "fx" && p.lane === "music" && tracks.every((t) => t.kind === "music"))))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => inCampaign(b.p.id) - inCampaign(a.p.id) || a.i - b.i)
    .forEach(({ p }) => out.push({ group: "Playlists", key: `pl:${p.id}`, name: p.name }));
  if (tracks.some((t) => isFx(t))) for (const b of world.boards) out.push({ group: "Pad boards", key: `pb:${b.id}`, name: b.name, label: `${b.name} (new pad)` });
  const rooms = world.rooms.length ? world.rooms : [{ roomId: "table", name: "Table" }];
  for (const r of rooms) out.push({ group: "Up next", key: `q:${r.roomId}`, name: `Up next in ${r.name}` });
  const { campaign, session } = world;
  if (campaign && session) {
    for (const sc of session.scenes) out.push({ group: `Scenes in Session ${session.number}`, key: `sc:${campaign.id}:${session.id}:${sc.id}`, name: sc.name, label: `Session ${session.number} › ${sc.name}` });
  }
  return out;
}

/** What is dragged, in words: a track's title, or "2 tracks". */
export function draggedName(tracks: readonly { title: string }[]): string {
  return tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks`;
}
