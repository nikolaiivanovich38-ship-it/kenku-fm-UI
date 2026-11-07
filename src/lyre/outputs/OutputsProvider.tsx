/**
 * w4-outputs: the Discord bots for every screen of the page (the Outputs screen, the rail's "Outputs (n/m)"). Holds
 * the latest state the main process sent and hands out the bridge's calls. Without a bridge (tests, or a page made
 * without one) there are no outputs and screens say so.
 */
import React, { createContext, useContext, useEffect, useState } from "react";

import type { LyreOutputs } from "../../common/lyreOutputs";
import type { LyreOutputsBridge } from "./preloadOutputs";

export type OutputsClient = LyreOutputsBridge;

interface OutputsValue {
  /** null until the first state arrives (or with no bridge). */
  outputs: LyreOutputs | null;
  client: OutputsClient | null;
}

const OutputsContext = createContext<OutputsValue>({ outputs: null, client: null });

export function OutputsProvider({ client, children }: { client: OutputsClient | null; children: React.ReactNode }) {
  const [outputs, setOutputs] = useState<LyreOutputs | null>(null);
  useEffect(() => {
    if (!client) return;
    let gone = false;
    let heard = false;
    const stop = client.onState((state) => {
      heard = true;
      if (!gone) setOutputs(state);
    });
    client.get().then(
      // A state pushed while the answer was on its way is newer: keep it.
      (state) => !gone && !heard && setOutputs(state),
      (): void => undefined,
    );
    return () => {
      gone = true;
      stop();
    };
  }, [client]);
  return <OutputsContext.Provider value={{ outputs, client }}>{children}</OutputsContext.Provider>;
}

export function useOutputs(): OutputsValue {
  return useContext(OutputsContext);
}

/** The rail's link, as core.js outputsBadge: bots connected in a voice channel, of all bots. */
export function outputsLabel(outputs: LyreOutputs): string {
  const connected = outputs.bots.filter((bot) => bot.room?.status === "connected").length;
  return `Rooms (${connected}/${outputs.bots.length})`;
}
