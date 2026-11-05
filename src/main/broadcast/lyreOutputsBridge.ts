import { ipcMain, type WebContents } from "electron";
import { LYRE_OUTPUTS_STATE, lyreOutputsOf } from "../../common/lyreOutputs";
import { guardIpc } from "../security/ipcGuard";
import type { OutputManager } from "./OutputManager";

/**
 * w4-outputs: the new interface's Outputs screen, over the same OutputManager the main window's sidebar uses.
 *
 * The Lyre page (role "lyre-view") asks for the outputs (LYRE_OUTPUTS_GET), hears every change
 * (LYRE_OUTPUTS_STATE, once per tick of changes), and moves a bot to a voice channel, takes it out, mutes it,
 * sets its room's volume or tries a failed join again (LYRE_OUTPUT_*). Logging bots in and their tokens stay in the
 * main window's Settings, so no token, and no way to set one, reaches the Lyre page (SEC-5).
 */
export class LyreOutputsBridge {
  private readonly ipc = guardIpc(ipcMain);
  private view?: WebContents;
  private readonly onState = () => this.push();

  constructor(private readonly outputs: OutputManager) {
    this.ipc.handle("LYRE_OUTPUTS_GET", () => lyreOutputsOf(this.outputs.state()));
    this.ipc.on("LYRE_OUTPUT_MOVE", (_event, id: string, channelId: string) => void this.outputs.moveBot(id, channelId));
    this.ipc.on("LYRE_OUTPUT_LEAVE", (_event, id: string) => this.outputs.leaveAll(id));
    this.ipc.on("LYRE_OUTPUT_SET_MUTED", (_event, id: string, muted: boolean) => this.outputs.setMuted(id, muted));
    this.ipc.on("LYRE_OUTPUT_SET_VOLUME", (_event, id: string, volume: number) => this.outputs.setRoomVolume(id, volume));
    this.ipc.on("LYRE_OUTPUT_RETRY", (_event, id: string) => void this.outputs.reconnect(id));
    outputs.on("stateChange", this.onState);
  }

  /** The Lyre page opened (or opened again): it hears every change from now on, starting with the state now. */
  setView(view: WebContents): void {
    this.view = view;
    this.push();
  }

  destroy(): void {
    this.outputs.off("stateChange", this.onState);
    this.ipc.dispose();
    this.view = undefined;
  }

  private push() {
    const view = this.view;
    if (view && !view.isDestroyed()) {
      view.send(LYRE_OUTPUTS_STATE, lyreOutputsOf(this.outputs.state()));
    }
  }
}
