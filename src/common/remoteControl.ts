/**
 * SEC-4: the remote control's settings as the Lyre page sees them (src/main/remote/remoteControl.ts keeps them).
 * Round 7 designs the Settings screen that shows them; until then only the bridge exists (`window.lyre.remote`).
 */

/** Answers a RemoteState (invoke, no arguments). */
export const REMOTE_GET = "REMOTE_GET";
/** Changes some settings (invoke, one RemoteChange); answers the new RemoteState or { error } in plain words. */
export const REMOTE_SET = "REMOTE_SET";
/** Makes a new secret code (invoke, no arguments); answers the new RemoteState. */
export const REMOTE_NEW_CODE = "REMOTE_NEW_CODE";
/** Main process to the Lyre page after every change: one RemoteState. */
export const REMOTE_STATE = "REMOTE_STATE";

export interface RemoteSettings {
  enabled: boolean;
  /** Where the server listens: 127.0.0.1 (this computer only), or this computer's network address. */
  address: string;
  port: number;
}

export type RemoteChange = Partial<RemoteSettings>;

export interface RemoteState extends RemoteSettings {
  /** True while the server is listening. */
  running: boolean;
  /** The secret code a remote tool must send as `Authorization: Bearer <code>`. */
  code: string;
  /** False when the code cannot be saved encrypted and a new one is made at every start. */
  codeRemembered: boolean;
  /** Why it is on but not running, in plain words. */
  problem?: string;
  /**
   * Round 7 (Settings › Remote control › Your home network): this computer's private address on its home network
   * (192.168.x.x and the like), for a phone or tablet on the same Wi-Fi; null when it has none.
   */
  homeAddress: string | null;
}

/** Where the remote control listens when it is for this computer only. */
export const THIS_COMPUTER_ONLY = "127.0.0.1";

/** Whether the remote control listens for this computer only (127.0.0.1 or localhost). */
export function listensLocally(state: Pick<RemoteSettings, "address">): boolean {
  return state.address === THIS_COMPUTER_ONLY || state.address === "localhost";
}

export function isRemoteState(value: unknown): value is RemoteState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    typeof v.running === "boolean" &&
    typeof v.address === "string" &&
    typeof v.port === "number" &&
    typeof v.code === "string" &&
    typeof v.codeRemembered === "boolean" &&
    (v.problem === undefined || typeof v.problem === "string") &&
    (v.homeAddress === null || typeof v.homeAddress === "string")
  );
}

/** What `window.lyre.remote` offers. */
export interface RemoteBridge {
  get(): Promise<RemoteState>;
  set(change: RemoteChange): Promise<RemoteState | { error: string }>;
  newCode(): Promise<RemoteState>;
  /** Called with each new state; returns a function that stops listening. */
  onChange(listener: (state: RemoteState) => void): () => void;
}
