import React from "react";

/**
 * The provider slot: everything the screens read data and sound from goes around the shell here, so every screen can
 * use it. The shell itself needs none of it.
 *
 * Wave 3 wiring (the lead adds these lines; w3-api and w3-host own the providers):
 *   <LyreApiProvider api={...}>                 the library (src/lyre/api)
 *     <LyreAudioProvider audio={...}>            play on air, preview, stop, now playing (src/lyre/audio)
 *       <ShellDataProvider value={...}>          campaign themes, "Live: S14", "Outputs (1/2)", the on-air bar
 *         {children}
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
