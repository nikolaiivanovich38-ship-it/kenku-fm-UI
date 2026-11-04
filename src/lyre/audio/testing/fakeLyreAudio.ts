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
import { TypedEmitter } from "tiny-typed-emitter";

import type { CueOutcome, DeviceStatus, LyreAudio, LyreAudioEvents, NowPlaying, OutputDeviceInfo } from "../lyreAudio";

export const EMPTY_NOW_PLAYING: NowPlaying = {
  rooms: [{ roomId: "table", name: "Table", music: null, ambience: null, upNext: null, queued: [], effects: [] }],
  broadcasting: false,
  preview: null,
  previewDevice: null,
  canUndo: false,
};

type Call = [method: string, ...args: unknown[]];

export class FakeLyreAudio extends TypedEmitter<LyreAudioEvents> implements LyreAudio {
  calls: Call[] = [];
  /** What the next calls answer. */
  answer: CueOutcome = { ok: true };
  devices: OutputDeviceInfo[] = [{ deviceId: "", label: "Default sound device" }];
  private state: NowPlaying = EMPTY_NOW_PLAYING;
  private readonly subscribers = new Set<() => void>();

  setNowPlaying(state: Partial<NowPlaying>): void {
    this.state = { ...this.state, ...state };
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
  firePad = this.record("firePad");
  removeQueued = this.record("removeQueued");
  undoSceneStart = this.record("undoSceneStart");
  run = this.record("run");
  previewTrack = this.record("previewTrack");
  previewPlaylist = this.record("previewPlaylist");
  previewPad = this.record("previewPad");

  stopPreview(): void {
    this.calls.push(["stopPreview"]);
  }

  isPreviewing(key: string): boolean {
    return this.state.preview?.key === key;
  }

  async previewDevices(): Promise<OutputDeviceInfo[]> {
    return this.devices;
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
