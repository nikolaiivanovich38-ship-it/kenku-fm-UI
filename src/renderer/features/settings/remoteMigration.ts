/**
 * Saved-settings migration for review 0.5.0 CR-3 (redux-persist version 7).
 *
 * In Kenku FM and Lyre 0.4.1 the main window's Settings kept the remote control's on/off, address and port, and
 * turned it on at every start. Lyre's own Settings now owns the remote control. The old choice is handed to the main
 * process once (which keeps it if the address is allowed, else uses 127.0.0.1) and removed from these settings.
 */
import type { OldRemoteSetting } from "../../../common/remoteControl";

export function moveRemoteOutOfSettings<S>(state: S, handOver: (old: OldRemoteSetting) => void): S {
  const saved = state as { settings?: Record<string, unknown> } | undefined;
  if (!saved?.settings) return state;
  const { remoteEnabled, remoteAddress, remotePort, ...settings } = saved.settings;
  if (remoteEnabled === undefined && remoteAddress === undefined && remotePort === undefined) return state;
  handOver({
    enabled: remoteEnabled === true,
    address: typeof remoteAddress === "string" ? remoteAddress.slice(0, 64) : "127.0.0.1",
    port: typeof remotePort === "string" ? remotePort.slice(0, 5) : "3333",
  });
  return { ...saved, settings } as S;
}
