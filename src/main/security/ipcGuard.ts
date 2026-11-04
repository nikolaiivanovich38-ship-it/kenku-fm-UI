/**
 * SEC-8: only the app's own pages may talk to the main process, and only on
 * the channels they use.
 *
 * Electron delivers a message to `ipcMain` no matter which page or frame sent
 * it. `guardIpc` wraps `ipcMain.on` / `ipcMain.handle` so a message reaches
 * its handler only when it comes from the main frame of a page registered in
 * `trustedContents` with a role listed for that channel in `IPC_CHANNELS`, and
 * its arguments have the expected types. Anything else is dropped and logged
 * once per channel and reason.
 */
import { IPC_CHANNELS, type IpcChannel, type IpcChannelRule } from "./ipcChannels";
import { TrustedContentsRegistry, trustedContents } from "./trustedContents";

/** The parts of Electron's WebFrameMain the guard needs. */
interface FrameLike {
  frameTreeNodeId: number;
}

/** The parts of an IPC event (IpcMainEvent / IpcMainInvokeEvent) the guard needs. */
export interface IpcSenderEvent {
  sender: { id: number; isDestroyed(): boolean; mainFrame: FrameLike };
  senderFrame: FrameLike | null;
  returnValue?: unknown;
}

type Listener = (event: IpcSenderEvent, ...args: unknown[]) => unknown;

/** The parts of Electron's `ipcMain` the guard needs. */
export interface IpcMainLike {
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
  handle(channel: string, listener: Listener): void;
  removeHandler(channel: string): void;
}

export interface GuardedIpc {
  /** `ipcMain.on` for allowed senders only. Returns a function that removes the listener. */
  on<E extends IpcSenderEvent>(
    channel: IpcChannel,
    listener: (event: E, ...args: unknown[]) => unknown,
  ): () => void;
  /** `ipcMain.handle` for allowed senders only; refused calls reject. Returns a function that removes the handler. */
  handle<E extends IpcSenderEvent>(
    channel: IpcChannel,
    handler: (event: E, ...args: unknown[]) => unknown,
  ): () => void;
  /** Remove everything registered through this guard. */
  dispose(): void;
}

type Refusal = "not an app page allowed on this channel" | "sent from an embedded frame" | "unexpected arguments";

/** Why a message must be dropped, or null when it may be handled. */
export function refusalReason(
  rule: IpcChannelRule,
  event: IpcSenderEvent,
  args: readonly unknown[],
  registry: TrustedContentsRegistry = trustedContents,
): Refusal | null {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed()) {
    return "not an app page allowed on this channel";
  }
  const role = registry.roleOf(sender);
  if (role === null || !rule.from.includes(role)) {
    return "not an app page allowed on this channel";
  }
  const frame = event.senderFrame;
  const mainFrameId = sender.mainFrame?.frameTreeNodeId;
  if (!frame || typeof mainFrameId !== "number" || frame.frameTreeNodeId !== mainFrameId) {
    return "sent from an embedded frame";
  }
  if (!rule.args(args)) {
    return "unexpected arguments";
  }
  return null;
}

export function guardIpc(
  ipc: IpcMainLike,
  {
    registry = trustedContents,
    warn = (message: string) => console.warn(message),
  }: { registry?: TrustedContentsRegistry; warn?: (message: string) => void } = {},
): GuardedIpc {
  const warned = new Set<string>();
  const cleanups = new Set<() => void>();

  const check = (channel: IpcChannel, event: IpcSenderEvent, args: unknown[]): boolean => {
    const reason = refusalReason(IPC_CHANNELS[channel], event, args, registry);
    if (reason === null) {
      return true;
    }
    const key = `${channel}\u0000${reason}`;
    if (!warned.has(key)) {
      warned.add(key);
      warn(`Ignored a ${channel} message: ${reason}`);
    }
    return false;
  };

  const track = (cleanup: () => void) => {
    const once = () => {
      if (cleanups.delete(once)) {
        cleanup();
      }
    };
    cleanups.add(once);
    return once;
  };

  return {
    on(channel, listener) {
      const rule: IpcChannelRule = IPC_CHANNELS[channel];
      const guarded: Listener = (event, ...args) => {
        if (check(channel, event, args)) {
          return listener(event as never, ...args);
        }
        if ("refusedReturnValue" in rule) {
          event.returnValue = rule.refusedReturnValue;
        }
      };
      ipc.on(channel, guarded);
      return track(() => ipc.removeListener(channel, guarded));
    },
    handle(channel, handler) {
      const guarded: Listener = (event, ...args) => {
        if (!check(channel, event, args)) {
          throw new Error(`${channel} refused`);
        }
        return handler(event as never, ...args);
      };
      ipc.handle(channel, guarded);
      return track(() => ipc.removeHandler(channel));
    },
    dispose() {
      for (const cleanup of [...cleanups]) {
        cleanup();
      }
    },
  };
}
