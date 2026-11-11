/**
 * Gives the new interface's screens their LyreApi: the main-process one in the app, the in-memory fake in tests
 * and the e2e demo. Screens reach it with useLyreApi() and read through the query hooks (hooks.ts).
 */
import React, { createContext, useContext } from "react";

import type { LyreApi } from "../../common/lyre/api";

const LyreApiContext = createContext<LyreApi | null>(null);

export function LyreApiProvider({ api, children }: { api: LyreApi; children: React.ReactNode }) {
  return <LyreApiContext.Provider value={api}>{children}</LyreApiContext.Provider>;
}

export function useLyreApi(): LyreApi {
  const api = useContext(LyreApiContext);
  if (!api) throw new Error("useLyreApi needs a LyreApiProvider around the screen (src/lyre/api).");
  return api;
}
