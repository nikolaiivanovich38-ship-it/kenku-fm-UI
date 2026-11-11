/**
 * OUT-5, PRV-1: messages on the private channel between the player page and
 * the capture window. The main process creates the channel (a
 * MessageChannelMain, like the WP2 audio port) and hands one end to each page
 * only; no network socket, nothing else can join it.
 *
 * Player page → capture window:
 * - `room`: 20 ms of one engine room's mix, played into that room's mix (so it
 *   is encoded for that room's bot only);
 * - `preview`: 20 ms of the preview, played on the game master's device by the
 *   capture window, which is never recorded and never mixes it into a room;
 * - `preview-sink`: play the preview on another output device (PRV-2).
 *
 * Capture window → player page:
 * - `broadcast`: whether a bot is in a voice channel (rooms are sent only then);
 * - `preview-sink-done`: the answer to `preview-sink`.
 */
import { MAX_ROOM_ID_LENGTH } from "./outputs";

/** Samples per channel in one 20 ms frame at 48 kHz. */
export const FRAME_LENGTH = 960;
/** One frame, planar stereo: 960 left samples, then 960 right. */
export const FRAME_SAMPLES = FRAME_LENGTH * 2;
/** Longest output device id accepted (Chromium's are 64 hex characters). */
export const MAX_DEVICE_ID_LENGTH = 256;

export type PlayerAudioMessage =
  | { kind: "room"; room: string; index: number; samples: Float32Array }
  | { kind: "preview"; index: number; samples: Float32Array }
  | { kind: "preview-sink"; id: number; deviceId: string };

export type CaptureAudioMessage =
  | { kind: "broadcast"; active: boolean }
  | { kind: "preview-sink-done"; id: number; error?: string };

function isFrame(value: { index?: unknown; samples?: unknown }): boolean {
  return (
    Number.isSafeInteger(value.index) &&
    (value.index as number) >= 0 &&
    value.samples instanceof Float32Array &&
    value.samples.length === FRAME_SAMPLES
  );
}

/** A well-formed message from the player page; anything else is dropped. */
export function isPlayerAudioMessage(value: unknown): value is PlayerAudioMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  switch (message.kind) {
    case "room":
      return (
        typeof message.room === "string" &&
        message.room.length > 0 &&
        message.room.length <= MAX_ROOM_ID_LENGTH &&
        isFrame(message)
      );
    case "preview":
      return isFrame(message);
    case "preview-sink":
      return (
        Number.isSafeInteger(message.id) &&
        typeof message.deviceId === "string" &&
        message.deviceId.length <= MAX_DEVICE_ID_LENGTH
      );
    default:
      return false;
  }
}

/** A well-formed message from the capture window; anything else is dropped. */
export function isCaptureAudioMessage(value: unknown): value is CaptureAudioMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message.kind === "broadcast") {
    return typeof message.active === "boolean";
  }
  if (message.kind === "preview-sink-done") {
    return Number.isSafeInteger(message.id) && (message.error === undefined || typeof message.error === "string");
  }
  return false;
}

/** The parts of a MessagePort both pages use (a fake in tests). */
export interface AudioPortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  start?(): void;
  close?(): void;
}
