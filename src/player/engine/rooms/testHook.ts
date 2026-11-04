/**
 * Test builds only: lets e2e/rooms.spec.ts drive the engine's rooms and the
 * bridged preview inside the packaged player page, with real Web Audio,
 * worklets and the private channel to the capture window. Installed by
 * src/player/renderer.ts only when __CUE_DESK_TEST_BUILD__ is true; release
 * builds leave this module out.
 */
import type { Room } from "../../../common/domain";
import type { PlayerAudioMessage } from "../../../common/playerAudio";
import { fromAudioContext, type NodeLike } from "../audio/types";
import { createBrowserBridgedPreview, createBrowserFrameTaps, listenForPlayerAudioPort } from "./browserBridge";
import { RoomMixer } from "./roomMixer";
import { PlayerAudioLink, RoomStreams, type BridgedPreviewOutput } from "./roomStreams";

export interface RoomsTestApi {
  start(): Promise<void>;
  /** What the test is waiting for: rooms known, a broadcast running, the channel there. */
  status(): { rooms: Room[]; broadcasting: boolean; linked: boolean };
  /** A steady tone in one room's music lane. */
  tone(roomId: string, frequency: number): void;
  /** A steady tone in the preview. */
  preview(frequency: number): void;
  /** Frames this page has sent, by kind. */
  sent(): Record<string, number>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    __lyreRoomsTest?: RoomsTestApi;
  }
}

export function installRoomsTestHook(target: Window): void {
  let state:
    | {
        context: AudioContext;
        mixer: RoomMixer;
        link: PlayerAudioLink;
        streams: RoomStreams;
        preview: BridgedPreviewOutput;
        tones: OscillatorNode[];
        stop: (() => void)[];
      }
    | undefined;
  const sent: Record<string, number> = {};

  const tone = (context: BaseAudioContext, frequency: number, destination: NodeLike) => {
    const oscillator = context.createOscillator();
    const level = context.createGain();
    oscillator.frequency.value = frequency;
    level.gain.value = 0.3;
    oscillator.connect(level);
    level.connect(destination as unknown as AudioNode);
    oscillator.start();
    return oscillator;
  };

  target.__lyreRoomsTest = {
    async start() {
      if (state) {
        return;
      }
      // The engine's context: 48 kHz for the frames, and no sound device of
      // its own, so the page never sounds the rooms itself.
      const context = new AudioContext({ sampleRate: 48_000, sinkId: { type: "none" } } as AudioContextOptions);
      const mixer = new RoomMixer(fromAudioContext(context));
      const link = new PlayerAudioLink();
      const send = link.send.bind(link);
      link.send = (message: PlayerAudioMessage, transfer?: Transferable[]) => {
        sent[message.kind] = (sent[message.kind] ?? 0) + 1;
        return send(message, transfer);
      };
      const streams = new RoomStreams({ mixer, link, createTap: await createBrowserFrameTaps(context) });
      const preview = await createBrowserBridgedPreview(link);
      const stopRooms = target.player.onRooms((rooms) => mixer.setRooms(rooms));
      const stopPort = listenForPlayerAudioPort(target, link);
      state = { context, mixer, link, streams, preview, tones: [], stop: [stopRooms, stopPort] };
    },
    status() {
      return {
        rooms: state?.mixer.rooms() ?? [],
        broadcasting: state?.streams.broadcasting ?? false,
        linked: state?.link.connected ?? false,
      };
    },
    tone(roomId, frequency) {
      if (state) {
        state.tones.push(tone(state.context, frequency, state.mixer.getRoomBus(roomId, "music")));
      }
    },
    preview(frequency) {
      if (state) {
        // The preview's own context: the one its input node belongs to.
        const input = state.preview.input as unknown as AudioNode;
        state.tones.push(tone(input.context, frequency, state.preview.input));
      }
    },
    sent: () => ({ ...sent }),
    async close() {
      const current = state;
      state = undefined;
      if (!current) {
        return;
      }
      for (const oscillator of current.tones) {
        oscillator.stop();
      }
      for (const stop of current.stop) {
        stop();
      }
      current.streams.dispose();
      await current.preview.close();
      current.mixer.dispose();
      current.link.close();
      await current.context.close();
    },
  };
}
