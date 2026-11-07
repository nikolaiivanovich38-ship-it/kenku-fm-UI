/**
 * A LyreAudio for screen tests: no sound at all. It records every call in
 * `calls`, answers { ok: true } (or what `answer` says), and shows whatever
 * now-playing state a test gives it with `setNowPlaying`.
 *
 *   const audio = new FakeLyreAudio();
 *   render(<LyreAudioProvider audio={audio}><LiveView /></LyreAudioProvider>);
 *   await user.click(screen.getByRole("button", { name: "Next" }));
 *   expect(audio.calls).toContainEqual(["next", "music", undefined]);
 */
import type { AudioDevices } from "../../../common/domain";
import { TypedEmitter } from "tiny-typed-emitter";

import type { CueOutcome, DeviceStatus, LaneNowPlaying, LyreAudio, LyreAudioEvents, NowPlaying, OutputDeviceInfo, PreviewNowPlaying, RoomNowPlaying } from "../lyreAudio";

export const EMPTY_NOW_PLAYING: NowPlaying = {
  rooms: [{ roomId: "table", name: "Table", volume: 0.85, music: null, ambience: null, upNext: null, queued: [], upNextList: [], repeat: { chosen: null, shown: "off" }, canUndoUpNext: false, effects: [], played: [] }],
  broadcasting: false,
  preview: null,
  previewDevice: null,
  canUndo: false,
  previewEar: "both",
};

type Call = [method: string, ...args: unknown[]];

/** A lane as a test gives it: where it plays from, its play order and its gain may be left out (a single track, as it is). */
export type FakeLane = Omit<LaneNowPlaying, "place" | "playOrder" | "gainDb" | "level"> & Partial<Pick<LaneNowPlaying, "place" | "playOrder" | "gainDb" | "level">>;
/** A preview as a test gives it: its key and label, the rest filled in (a track, playing, full volume). */
export type FakePreview = Pick<PreviewNowPlaying, "key" | "label"> & Partial<PreviewNowPlaying>;
/** A room's round 6 and 7 fields may be left out: nothing in Up next, no Repeat chosen (off), nothing to undo, nothing played. */
type RoundSixRoom = "upNextList" | "repeat" | "canUndoUpNext" | "played";
/** Now-playing state as a test gives it to setNowPlaying. */
export type FakeNowPlaying = Partial<Omit<NowPlaying, "rooms" | "preview">> & {
  /** A room's volume may be left out: 0.85, as rooms start in the app. */
  rooms?: (Omit<RoomNowPlaying, "music" | "ambience" | "volume" | RoundSixRoom> &
    Partial<Pick<RoomNowPlaying, RoundSixRoom>> & { music: FakeLane | null; ambience: FakeLane | null; volume?: number })[];
  preview?: FakePreview | null;
};

const lane = (l: FakeLane | null): LaneNowPlaying | null => (l ? { place: null, playOrder: null, gainDb: 0, level: 1, ...l } : null);
const preview = (p: FakePreview | null | undefined): PreviewNowPlaying | null =>
  p ? { kind: "track", trackId: p.key.startsWith("pl:") || p.key.startsWith("pad:") ? null : p.key, playlistId: null, padKey: null, from: null, paused: false, position: null, length: null, volume: 1, gainDb: 0, ...p } : null;

export class FakeLyreAudio extends TypedEmitter<LyreAudioEvents> implements LyreAudio {
  calls: Call[] = [];
  /** What the next calls answer. */
  answer: CueOutcome = { ok: true };
  devices: OutputDeviceInfo[] = [{ deviceId: "", label: "Default sound device" }];
  private state: NowPlaying = EMPTY_NOW_PLAYING;
  private readonly subscribers = new Set<() => void>();

  setNowPlaying(state: FakeNowPlaying): void {
    const { rooms, preview: shown, ...rest } = state;
    this.state = {
      ...this.state,
      ...rest,
      ...(rooms
        ? { rooms: rooms.map((r): RoomNowPlaying => ({ volume: 0.85, upNextList: [], repeat: { chosen: null, shown: "off" as const }, canUndoUpNext: false, played: [], ...r, music: lane(r.music), ambience: lane(r.ambience) })) }
        : {}),
      ...(shown !== undefined ? { preview: preview(shown) } : {}),
    };
    this.subscribers.forEach((listener) => listener());
  }

  playTrack = this.record("playTrack");
  playPlaylist = this.record("playPlaylist");
  startScene = this.record("startScene");
  next = this.record("next");
  previous = this.record("previous");
  togglePause = this.record("togglePause");
  stopLane = this.record("stopLane");
  fadeAll = this.record("fadeAll");
  stopAll = this.record("stopAll");
  setRoomVolume = this.record("setRoomVolume");
  firePad = this.record("firePad");
  stopPads = this.record("stopPads");
  removeQueued = this.record("removeQueued");
  undoSceneStart = this.record("undoSceneStart");
  playNext = this.record("playNext");
  addToQueue = this.record("addToQueue");
  removeFromUpNext = this.record("removeFromUpNext");
  clearAdded = this.record("clearAdded");
  undoUpNext = this.record("undoUpNext");
  setRepeat = this.record("setRepeat");
  cycleRepeat = this.record("cycleRepeat");

  savedRepeatOneChanged(scene: unknown, trackId: string): void {
    this.calls.push(["savedRepeatOneChanged", scene, trackId]);
  }

  sessionLoaded(): void {
    this.calls.push(["sessionLoaded"]);
  }
  run = this.record("run");
  previewTrack = this.record("previewTrack");
  previewPlaylist = this.record("previewPlaylist");
  previewPad = this.record("previewPad");
  tryPad = this.record("tryPad");
  togglePreviewPause = this.record("togglePreviewPause");

  stopPreview(): void {
    this.calls.push(["stopPreview"]);
  }

  setPreviewVolume(volume: number): void {
    this.calls.push(["setPreviewVolume", volume]);
  }

  testChime(roomId: string): CueOutcome {
    this.calls.push(["testChime", roomId]);
    return this.answer;
  }

  /** OUT-10: what roomLevel answers per room (a test sets it); read many times a second, so not recorded. */
  levels: Record<string, number> = {};

  roomLevel(roomId: string): number {
    return this.levels[roomId] ?? 0;
  }

  isPreviewing(key: string): boolean {
    return this.state.preview?.key === key;
  }

  async previewDevices(): Promise<OutputDeviceInfo[]> {
    return this.devices;
  }

  async setAudioDevices(devices: AudioDevices): Promise<DeviceStatus | null> {
    this.calls.push(["setAudioDevices", devices]);
    this.state = { ...this.state, previewEar: devices.split ? devices.previewEar : "both" };
    this.subscribers.forEach((l) => l());
    return this.choosePreviewDevice(devices.previewDevice);
  }

  async choosePreviewDevice(deviceId: string): Promise<DeviceStatus> {
    this.calls.push(["choosePreviewDevice", deviceId]);
    const device = this.devices.find((d) => d.deviceId === deviceId) ?? this.devices[0];
    return { ...device, message: null };
  }

  setLibrary(): void {
    this.calls.push(["setLibrary"]);
  }

  getNowPlaying(): NowPlaying {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.calls.push(["dispose"]);
  }

  private record(method: string) {
    return (...args: unknown[]): CueOutcome => {
      this.calls.push([method, ...args]);
      return this.answer;
    };
  }
}
