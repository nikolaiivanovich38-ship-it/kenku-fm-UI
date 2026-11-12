/**
 * FND-16 step 6 (0.5.1; Nik, 11 Nov: "Hide until Stream Deck"): the remote control is hidden until Lyre has its own
 * Stream Deck and phone support (WP6). Until 0.5.0 it controlled only the old player, which is gone, and the Kenku FM
 * Stream Deck plugin cannot send Lyre's secret code anyway. The server never starts; REMOTE_GET and REMOTE_NEW_CODE
 * answer "off", REMOTE_SET refuses in plain words. Settings hides its box (SHOW_REMOTE_CONTROL).
 *
 * Kept for WP6, tested and unused: remoteSettings.ts (remote-control.json, the encrypted code), remoteCode.ts,
 * homeNetwork.ts and rateLimit.ts. A remote-control.json from 0.4.1 or 0.5.0 is left as it is and never read.
 */
import { ipcMain } from "electron";

import { THIS_COMPUTER_ONLY, type RemoteState } from "../../common/remoteControl";
import { guardIpc } from "../security/ipcGuard";

/** What REMOTE_SET answers. */
export const REMOTE_RETURNS_LATER = "Remote control returns with Stream Deck support.";

/** The remote control as the Lyre page sees it while hidden. */
export function remoteOffState(): RemoteState {
  return { enabled: false, running: false, address: THIS_COMPUTER_ONLY, port: 3333, code: "", codeRemembered: false, homeAddress: null };
}

export class RemoteOff {
  /** SEC-8: each channel accepts only the Lyre page, with the arguments IPC_CHANNELS names. */
  private ipc = guardIpc(ipcMain);

  constructor() {
    this.ipc.handle("REMOTE_GET", () => remoteOffState());
    this.ipc.handle("REMOTE_SET", () => ({ error: REMOTE_RETURNS_LATER }));
    this.ipc.handle("REMOTE_NEW_CODE", () => remoteOffState());
  }

  destroy(): void {
    this.ipc.dispose();
  }
}
