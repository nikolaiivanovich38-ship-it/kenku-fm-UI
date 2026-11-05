/**
 * The library as the audio host reads it while it plays (LyreAudioLibrary, src/lyre/audio/lyreAudio.ts). The
 * engine asks synchronously, so this loads what it needs through LyreApi
 * once, answers from memory, and reloads the parts a "changed" event names. Give it to the host with
 * `audio.setLibrary(snapshot)`, and again from `snapshot.subscribe` so now-playing titles follow renames.
 */
import { isFx, type DomainPlaylist, type DomainScene, type DomainTrack, type ProfileOverrides } from "../../common/domain";
import type { CampaignInfo, LibraryTrack, LyreApi, LyreArea, PadBoard, PlaylistInfo, Pad } from "../../common/lyre/api";
import type { MediaRequest } from "../../player/engine/sources/sourceLoader";
import type { LyreAudioLibrary, LyrePad, SceneRef } from "../audio/lyreAudio";

type Part = "tracks" | "playlists" | "campaigns" | "boards" | "overrides";

/** Which parts each changed area makes stale. Tags change tracks (their tag values) and pads that play by tag. */
const PARTS_OF: Record<LyreArea, Part[]> = {
  tracks: ["tracks"],
  tags: ["tracks"],
  folders: [],
  playlists: ["playlists"],
  boards: ["boards"],
  campaigns: ["campaigns"],
  profiles: ["overrides"],
  history: [],
};

export class LibrarySnapshot implements LyreAudioLibrary {
  private trackList: LibraryTrack[] = [];
  private trackById = new Map<string, LibraryTrack>();
  private playlistById = new Map<string, DomainPlaylist>();
  private campaigns: CampaignInfo[] = [];
  private boards: PadBoard[] = [];
  private overrides: ProfileOverrides = {};
  /** The newest request per part: an older answer arriving later is dropped. */
  private readonly asked: Record<Part, number> = { tracks: 0, playlists: 0, campaigns: 0, boards: 0, overrides: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly stopEvents: () => void;
  private disposed = false;

  private constructor(private readonly api: LyreApi) {
    this.stopEvents = api.subscribe((event) => {
      if (event.type !== "changed") return;
      const parts = new Set(event.areas.flatMap((area) => PARTS_OF[area] ?? []));
      parts.forEach((part) => void this.reload(part));
    });
  }

  /** Loads everything once; resolves when the snapshot can answer. */
  static async load(api: LyreApi): Promise<LibrarySnapshot> {
    const snapshot = new LibrarySnapshot(api);
    await Promise.all((["tracks", "playlists", "campaigns", "boards", "overrides"] as Part[]).map((part) => snapshot.reload(part)));
    return snapshot;
  }

  /** Called after each reload is in place. Returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops following changes; the snapshot keeps answering from what it has. */
  dispose(): void {
    this.disposed = true;
    this.stopEvents();
    this.listeners.clear();
  }

  /* ---------- LyreAudioLibrary ---------- */

  track(id: string): DomainTrack | undefined {
    return this.trackById.get(id);
  }

  playlist(id: string): DomainPlaylist | undefined {
    return this.playlistById.get(id);
  }

  tracks(): Iterable<DomainTrack> {
    return this.trackList;
  }

  scene(ref: SceneRef): DomainScene | undefined {
    return this.campaigns
      .find((c) => c.id === ref.campaignId)
      ?.sessions.find((s) => s.id === ref.sessionId)
      ?.scenes.find((sc) => sc.id === ref.sceneId);
  }

  profileOverrides(): ProfileOverrides {
    return this.overrides;
  }

  media(track: DomainTrack): MediaRequest | null {
    const known = this.trackById.get(track.id);
    if (!known?.url) return null;
    return known.sizeBytes == null ? { url: known.url, trackId: known.id } : { url: known.url, trackId: known.id, sizeBytes: known.sizeBytes };
  }

  pad(boardId: string, padId: string): LyrePad | undefined {
    const board = this.boards.find((b) => b.id === boardId);
    const pad = board && [...board.slots, ...board.spare].find((p): p is Pad => !!p && p.id === padId);
    if (!pad) return undefined;
    const { sound } = pad;
    // "Any effect with a tag": every FX track (effects and stings) carrying that tag, in library order.
    const trackIds = sound.kind === "tag" ? (sound.tag ? this.trackList.filter((t) => isFx(t) && (t.tags[sound.tag.group] ?? []).includes(sound.tag.value)).map((t) => t.id) : []) : [...sound.trackIds];
    return { label: pad.label, trackIds, order: sound.order === "in_turn" ? "roundrobin" : "random", mode: pad.mode, fadeMs: pad.fadeOutMs, volume: pad.volume };
  }

  /* ---------- loading ---------- */

  private async reload(part: Part): Promise<void> {
    const asked = ++this.asked[part];
    const answer = await this.read(part);
    if (this.disposed || asked !== this.asked[part]) return;
    this.apply(part, answer);
    for (const listener of [...this.listeners]) listener();
  }

  private read(part: Part): Promise<unknown> {
    switch (part) {
      case "tracks":
        return this.api.library.listTracks();
      case "playlists":
        return this.api.playlists.list();
      case "campaigns":
        return this.api.campaigns.list();
      case "boards":
        return this.api.boards.list();
      case "overrides":
        return this.api.profiles.overrides();
    }
  }

  private apply(part: Part, answer: unknown): void {
    switch (part) {
      case "tracks":
        this.trackList = answer as LibraryTrack[];
        this.trackById = new Map(this.trackList.map((t) => [t.id, t]));
        break;
      case "playlists":
        this.playlistById = new Map((answer as PlaylistInfo[]).map((p) => [p.id, p]));
        break;
      case "campaigns":
        this.campaigns = answer as CampaignInfo[];
        break;
      case "boards":
        this.boards = answer as PadBoard[];
        break;
      case "overrides":
        this.overrides = answer as ProfileOverrides;
        break;
    }
  }
}
