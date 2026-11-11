/**
 * OUT-5, PRV-1: the real-browser parts of the player page's channel to the
 * capture window (see roomStreams.ts). Unit tests use fakes; the packaged-app
 * test e2e/rooms.spec.ts checks these.
 */
// The PCM worklet the capture window uses, loaded here as a file next to the
// player bundle (the player's Content-Security-Policy allows 'self' scripts only).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pcmStreamUrl from "../../../preload/managers/PCMStream.worklet.js?asset";
import type { AudioPortLike } from "../../../common/playerAudio";
import { fromAudioContext, type NodeLike } from "../audio/types";
import {
  createBridgedPreviewOutput,
  type BridgedPreviewOutput,
  type FrameChannelFactory,
  type FrameTapFactory,
  type PlayerAudioLink,
  type TapFrame,
} from "./roomStreams";

/** What the player preload posts to the page with the channel's end attached. */
export const PLAYER_AUDIO_PORT_MESSAGE = "lyre-player-audio-port";

/**
 * Hand every channel end the main process gives this page to `link`. The
 * preload cannot pass a MessagePort through contextBridge, so it posts it to
 * this page's own window; only a message from this window itself is taken.
 */
export function listenForPlayerAudioPort(
  target: Window,
  link: PlayerAudioLink,
  // The player preload holds the end until the page asks for it.
  request: () => void = () => target.player.connectAudio(),
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source === target && event.data === PLAYER_AUDIO_PORT_MESSAGE && event.ports[0]) {
      link.connect(event.ports[0]);
    }
  };
  target.addEventListener("message", onMessage);
  request();
  return () => target.removeEventListener("message", onMessage);
}

/** w51-audio: a channel for one tap's frames, from this page's audio thread to the capture window. */
export const browserFrameChannel: FrameChannelFactory = () => {
  const channel = new MessageChannel();
  return { port1: channel.port1 as unknown as AudioPortLike, port2: channel.port2 as unknown as AudioPortLike };
};

/** Frames are 960 samples = 20 ms only at this rate, the rate Discord's Opus uses. */
export const BRIDGE_SAMPLE_RATE = 48_000;

/**
 * Taps (AudioWorkletNodes running the PCM worklet) in `audioContext`, which
 * must run at 48 kHz: make the engine's context with `sampleRate: 48000`.
 */
export async function createBrowserFrameTaps(audioContext: BaseAudioContext): Promise<FrameTapFactory> {
  if (audioContext.sampleRate !== BRIDGE_SAMPLE_RATE) {
    throw new Error(`Room audio needs a 48 kHz audio context, not ${audioContext.sampleRate} Hz`);
  }
  await audioContext.audioWorklet.addModule(pcmStreamUrl as string);
  return (onFrame) => {
    const node = new AudioWorkletNode(audioContext, "pcm-stream");
    node.port.onmessage = (event: MessageEvent<TapFrame[]>) => {
      for (const frame of event.data) {
        onFrame(frame);
      }
    };
    return {
      input: node as unknown as NodeLike,
      // w51-audio: the frames go from the audio thread straight to `port`, never through this page's main thread.
      sendTo: (port) =>
        node.port.postMessage({ kind: "send-to", port }, port ? [port as unknown as Transferable] : []),
      dispose: () => {
        node.port.onmessage = null;
        node.disconnect();
      },
    };
  };
}

/**
 * PRV-1: the preview's output for the player page. Its audio context has no
 * sound device at all (`sinkId: { type: "none" }`), so the page never plays
 * it and tab capture cannot record it; its frames go to the capture window,
 * which plays them on the game master's chosen device (PRV-2).
 */
export async function createBrowserBridgedPreview(link: PlayerAudioLink): Promise<BridgedPreviewOutput> {
  const audioContext = new AudioContext({
    latencyHint: "interactive",
    sampleRate: BRIDGE_SAMPLE_RATE,
    sinkId: { type: "none" },
  } as AudioContextOptions);
  const createTap = await createBrowserFrameTaps(audioContext);
  const bridged = createBridgedPreviewOutput({
    context: fromAudioContext(audioContext),
    link,
    createTap,
    createChannel: browserFrameChannel,
    closeContext: () => audioContext.close(),
  });
  // PRV-2: with one headset split, a panner before the bridge puts the preview in one ear (the frames stay stereo);
  // otherwise the preview goes straight on, so its level is as it was. All of it is in the preview's own context, so
  // nothing of it can reach a room.
  const target = bridged.input as unknown as AudioNode;
  const entry = audioContext.createGain();
  const panner = audioContext.createStereoPanner();
  panner.connect(target);
  entry.connect(target);
  return {
    ...bridged,
    input: entry as unknown as typeof bridged.input,
    setEar: (ear) => {
      entry.disconnect();
      if (ear === "both") entry.connect(target);
      else {
        panner.pan.setValueAtTime(ear === "left" ? -1 : 1, audioContext.currentTime);
        entry.connect(panner);
      }
    },
  };
}
