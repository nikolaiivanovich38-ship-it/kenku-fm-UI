/**
 * FND-9: the Lyre page's preload half of Save diagnostics (src/lyre/preload.ts exposes it as
 * `window.lyre.diagnostics`); the main process side is src/main/diagnostics/diagnosticsBridge.ts. No argument goes
 * to the main process, and only the names in a DiagnosticsResult come back. Kept free of Electron imports.
 */
import { LYRE_DIAGNOSTICS_SAVE, LYRE_DIAGNOSTICS_SHOW, isDiagnosticsResult, type DiagnosticsBridge, type DiagnosticsResult } from "../../common/lyreDiagnostics";

/** The parts of Electron's ipcRenderer this needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
}

export function createLyreDiagnosticsBridge(ipc: IpcRendererLike): DiagnosticsBridge {
  return {
    save: async (): Promise<DiagnosticsResult> => {
      const answer = await ipc.invoke(LYRE_DIAGNOSTICS_SAVE);
      if (!isDiagnosticsResult(answer)) return { ok: false, cancelled: false, message: "Lyre did not answer. Try again." };
      return answer.ok ? { ok: true, folder: answer.folder, file: answer.file } : answer.cancelled ? { ok: false, cancelled: true } : { ok: false, cancelled: false, message: answer.message };
    },
    show: () => ipc.send(LYRE_DIAGNOSTICS_SHOW),
  };
}
