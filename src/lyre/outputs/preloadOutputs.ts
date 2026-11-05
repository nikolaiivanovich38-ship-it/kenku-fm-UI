/**
 * w4-outputs: the Lyre page's preload half of the outputs (src/lyre/preload.ts exposes it as
 * `window.lyre.outputs`): the Discord bots, the voice channels they can join and who is in each, and the changes the
 * Outputs screen makes. The main process side is src/main/broadcast/lyreOutputsBridge.ts; the channels and their
 * argument checks are in src/main/security/ipcChannels.ts ("w4-outputs"). Only the LyreOutputs shape crosses into
 * the page. Kept free of Electron imports (the preload passes `ipcRenderer`), so it is unit-tested.
 */
import { LYRE_OUTPUTS_STATE, isLyreOutputs, type LyreOutputs } from "../../common/lyreOutputs";

/** What the page's `window.lyre.outputs` offers. Changes come back as a new state (onState). */
export interface LyreOutputsBridge {
  get(): Promise<LyreOutputs>;
  /** Every new state; returns a function that stops them. */
  onState(listener: (outputs: LyreOutputs) => void): () => void;
  /** Send a bot to a voice channel: it joins, or moves there from where it is. */
  move(botId: string, channelId: string): void;
  /** Take a bot out of its voice channel. */
  leave(botId: string): void;
  setMuted(botId: string, muted: boolean): void;
  /** The room's volume, 0 to 1. */
  setVolume(botId: string, volume: number): void;
  /** Try a failed join (or login) again. */
  retry(botId: string): void;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
}

/** A copy, so nothing but the shape's own data reaches the page. */
const copy = (outputs: LyreOutputs): LyreOutputs => JSON.parse(JSON.stringify(outputs)) as LyreOutputs;

export function createLyreOutputsBridge(ipc: IpcRendererLike): LyreOutputsBridge {
  return {
    get: async () => {
      const outputs = await ipc.invoke("LYRE_OUTPUTS_GET");
      if (!isLyreOutputs(outputs)) throw new Error("Lyre could not read the Discord bots");
      return copy(outputs);
    },
    onState: (listener) => {
      const handler = (_event: unknown, outputs: unknown) => {
        if (isLyreOutputs(outputs)) listener(copy(outputs));
      };
      ipc.on(LYRE_OUTPUTS_STATE, handler);
      return () => {
        ipc.off(LYRE_OUTPUTS_STATE, handler);
      };
    },
    move: (botId, channelId) => ipc.send("LYRE_OUTPUT_MOVE", botId, channelId),
    leave: (botId) => ipc.send("LYRE_OUTPUT_LEAVE", botId),
    setMuted: (botId, muted) => ipc.send("LYRE_OUTPUT_SET_MUTED", botId, muted),
    setVolume: (botId, volume) => ipc.send("LYRE_OUTPUT_SET_VOLUME", botId, volume),
    retry: (botId) => ipc.send("LYRE_OUTPUT_RETRY", botId),
  };
}
