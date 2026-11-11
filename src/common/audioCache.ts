/**
 * FND-16 (0.5.1): Settings › Sound to Discord › Empty the audio cache. The Lyre page asks the main process to empty
 * Lyre's audio cache (the copies made so tracks start at once; StartedLibrary.clearAudioCache). Until 0.5.1 this was
 * part of Website tabs › Clear website data.
 */

/** Lyre page to main process (invoke, no arguments); resolves once the cache is empty. */
export const LYRE_EMPTY_AUDIO_CACHE = "LYRE_EMPTY_AUDIO_CACHE";

/** What `window.lyre.cache` offers. */
export interface AudioCacheBridge {
  emptyAudioCache(): Promise<void>;
}

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcInvokeLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export function createAudioCacheBridge(ipc: IpcInvokeLike): AudioCacheBridge {
  return {
    emptyAudioCache: async () => {
      await ipc.invoke(LYRE_EMPTY_AUDIO_CACHE);
    },
  };
}
