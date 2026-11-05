import React, { useEffect, useMemo, useState } from "react";

import type { LyreApi } from "../common/lyre/api";
import { LibrarySnapshot, LyreApiProvider, useCampaigns, useLyreApi } from "./api";
import { ipcLyreApi } from "./api/ipcClient";
import { LibraryStatus } from "./api/LibraryStatus";
import type { LyreApiBridge } from "./api/preloadApi";
import { EMPTY_LIBRARY, LyreAudioProvider, startLyreAudio, type LyreAudio } from "./audio";
import type { LyreAudioBridge } from "./audio/preloadAudio";
import { useLiveSession } from "./kit/liveSession";
import { OnAirBar } from "./shell/OnAirBar";
import { ShellDataProvider, type ShellData } from "./shell/ShellData";
import type { ThemeId } from "./shell/themes";

/**
 * The provider slot: everything the screens read data and sound from goes around the shell here, so every screen can
 * use it. The shell itself needs none of it.
 *
 *   <LyreApiProvider>       the library (src/lyre/api), over IPC to the library's own process
 *     <LyreAudioProvider>   play on air, preview, stop, now playing (src/lyre/audio), fed with the library
 *       <ShellDataProvider> each campaign's table theme, the session loaded in Live, the on-air bar
 *         {children}
 *
 * Tests pass `api` and `audio`; the page uses `window.lyre` (src/lyre/preload.ts).
 */
export function AppProviders({ children, api, audio }: { children: React.ReactNode; api?: LyreApi; audio?: LyreAudio }) {
  const lyreApi = useMemo(() => api ?? ipcLyreApi((window as unknown as { lyre: { api: LyreApiBridge } }).lyre.api), [api]);
  return (
    <LyreApiProvider api={lyreApi}>
      <LibraryStatus />
      <WithAudio audio={audio}>
        <ShellDataFromLibrary>{children}</ShellDataFromLibrary>
      </WithAudio>
    </LyreApiProvider>
  );
}

/** Starts the page's audio host once (unless a test gave one) and keeps it fed with the library as it is now. */
function WithAudio({ audio, children }: { audio?: LyreAudio; children: React.ReactNode }) {
  const [started, setStarted] = useState<LyreAudio | null>(audio ?? null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (audio) return;
    let gone = false;
    let host: LyreAudio | null = null;
    const bridge = (window as unknown as { lyre: { audio: LyreAudioBridge } }).lyre.audio;
    startLyreAudio({ window, bridge, library: EMPTY_LIBRARY }).then(
      (made) => {
        host = made;
        if (gone) void made.dispose();
        else setStarted(made);
      },
      (error: unknown) => !gone && setFailure(`Lyre's sound could not start: ${error instanceof Error ? error.message : String(error)}`),
    );
    const stop = (): void => void host?.dispose();
    window.addEventListener("pagehide", stop);
    return () => {
      gone = true;
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [audio]);
  if (failure) {
    return (
      <>
        <p className="lyre-library-status down" role="alert">
          {failure}
        </p>
        {children}
      </>
    );
  }
  // The screens may play from their first moment, so they wait for the sound (a fraction of a second).
  if (!started) return null;
  return (
    <LyreAudioProvider audio={started}>
      <FeedLibrary audio={started} />
      {children}
    </LyreAudioProvider>
  );
}

/** Loads the library the engine reads (LibrarySnapshot) and hands it over again after every reload. */
function FeedLibrary({ audio }: { audio: LyreAudio }): null {
  const api = useLyreApi();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let snapshot: LibrarySnapshot | null = null;
    let gone = false;
    LibrarySnapshot.load(api).then(
      (loaded): void => {
        if (gone) return loaded.dispose();
        snapshot = loaded;
        audio.setLibrary(loaded);
        loaded.subscribe(() => audio.setLibrary(loaded));
      },
      // The library is down; LibraryStatus says so, and this tries again when it is back.
      (): void => undefined,
    );
    const stopRetry = api.subscribe((event) => {
      if (event.type === "library-status" && event.ok && !snapshot) setAttempt((n) => n + 1);
    });
    return () => {
      gone = true;
      stopRetry();
      snapshot?.dispose();
    };
  }, [api, audio, attempt]);
  return null;
}

/** The bar is one element for the page's life: it follows the audio host itself, so ShellData stays the same. */
const ON_AIR_BAR = <OnAirBar />;

/**
 * What the shell shows from the library and the sound: each campaign's own table theme, the session loaded in Live
 * (its campaign's theme on Live, "Live: S14" on the rail, as core.js railHTML), the on-air bar.
 */
function ShellDataFromLibrary({ children }: { children: React.ReactNode }) {
  const campaigns = useCampaigns().data;
  const live = useLiveSession();
  const value = useMemo<ShellData>(() => {
    const themes = new Map((campaigns ?? []).map((c) => [c.id, c.theme as ThemeId]));
    const session = live && campaigns?.find((c) => c.id === live.campaignId)?.sessions.find((s) => s.id === live.sessionId);
    return {
      campaignTheme: (id: string) => themes.get(id),
      liveCampaign: live?.campaignId,
      liveLabel: session ? `Live: S${session.number}` : undefined,
      liveName: session ? `Live: session ${session.number}` : undefined,
      onAirBar: ON_AIR_BAR,
    };
  }, [campaigns, live]);
  return <ShellDataProvider value={value}>{children}</ShellDataProvider>;
}
