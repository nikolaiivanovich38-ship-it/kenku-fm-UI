/**
 * UX-16: every preview says where the game master started it, for the Now playing bar's "Previewed from the session
 * planner". The shell gives each screen the audio host with the screen's name filled in for previews that name no
 * place themselves (core.js SCREEN_NAMES), so no screen has to pass it. Everything else goes straight to the host.
 */
import React, { useMemo } from "react";

import { LyreAudioProvider, useOptionalLyreAudio, type LyreAudio } from "../audio";
import type { RouteName } from "./routes";

/** Each screen in the words "Previewed from …" takes. */
export const SCREEN_WORDS: Record<RouteName, string> = {
  campaigns: "Campaigns",
  campaign: "the campaign page",
  session: "the session planner",
  library: "the Library",
  playlists: "Playlists",
  playlist: "the playlist",
  boards: "Pad boards",
  board: "the pad board",
  profile: "the Audio profile",
  live: "Live",
  outputs: "Rooms",
  settings: "Settings",
  look: "Look and feel",
  backup: "Back up, move or share",
  moved: "What came across from Kenku FM",
  relink: "Find missing files",
};

/** The host with `from` filled in on the preview calls (Try pads too); the same object for the same host and screen. */
function withPreviewFrom(audio: LyreAudio, from: string): LyreAudio {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(audio, {
    get(target, property) {
      if (methods.has(property)) return methods.get(property);
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      let method: unknown;
      if (property === "previewTrack" || property === "previewPlaylist") {
        method = (id: string, options: { from?: string } = {}) => (value as (id: string, o: object) => unknown).call(target, id, { from, ...options });
      } else if (property === "previewPad") {
        method = (board: string, pad: string, options: { from?: string } = {}) => (value as (b: string, p: string, o: object) => unknown).call(target, board, pad, { from, ...options });
      } else if (property === "tryPad") {
        method = (board: string, pad: string, phase?: "down" | "up", options: { from?: string } = {}) =>
          (value as (b: string, p: string, ph: string | undefined, o: object) => unknown).call(target, board, pad, phase, { from, ...options });
      } else {
        method = (value as (...args: unknown[]) => unknown).bind(target);
      }
      methods.set(property, method);
      return method;
    },
  });
}

export function ScreenSound({ route, children }: { route: RouteName; children: React.ReactNode }) {
  const audio = useOptionalLyreAudio();
  const from = SCREEN_WORDS[route];
  const wrapped = useMemo(() => audio && withPreviewFrom(audio, from), [audio, from]);
  return wrapped ? <LyreAudioProvider audio={wrapped}>{children}</LyreAudioProvider> : <>{children}</>;
}
