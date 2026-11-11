/**
 * Tests only. Until 0.5.1 the old main window drove OutputManager over its own channels (BOT_*, OUTPUT_*, ROOM_*,
 * OUTPUTS_*); FND-16 removed them with the window. The tests that used them now make the same calls directly, by
 * the old channel's name, so each test still reads as it did.
 */
import type { OutputManager } from "../OutputManager";

export function oldWindowCall(manager: OutputManager, channel: string, ...args: unknown[]): unknown {
  const [a, b] = args as [string, never];
  switch (channel) {
    case "BOT_SET_TOKEN":
      return manager.setToken(a, b);
    case "BOT_REMOVE_TOKEN":
      return manager.removeToken(a);
    case "BOT_IMPORT_LEGACY_TOKEN":
      return manager.importLegacyToken(a);
    case "BOT_REMOVE":
      return manager.removeBot(a);
    case "BOT_RECONNECT":
      return manager.reconnect(a);
    case "BOT_JOIN_CHANNEL":
      return manager.bots.get(a)?.join(b);
    case "BOT_LEAVE_CHANNEL":
      return manager.bots.get(a)?.leave(b);
    case "BOT_MOVE_TO_CHANNEL":
      return manager.moveBot(a, b);
    case "OUTPUT_SET_MUTED":
      return manager.setMuted(a, b);
    case "ROOM_SET_VOLUME":
      return manager.setRoomVolume(a, b);
    case "OUTPUTS_CONNECT_SAVED":
      return manager.connectSaved();
    default:
      throw new Error(`No old window call ${channel}`);
  }
}
