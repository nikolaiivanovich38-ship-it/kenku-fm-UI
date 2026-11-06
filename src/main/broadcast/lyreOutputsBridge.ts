import { ipcMain, shell, type WebContents } from "electron";
import { botInviteUrl, isApplicationId, LYRE_OUTPUTS_STATE, lyreOutputsOf } from "../../common/lyreOutputs";
import { openExternalIfAllowed } from "../security/externalLinks";
import { guardIpc } from "../security/ipcGuard";
import type { OutputManager } from "./OutputManager";

/**
 * w4-outputs: the new interface's Outputs screen, over the same OutputManager the main window's sidebar uses.
 *
 * The Lyre page (role "lyre-view") asks for the outputs (LYRE_OUTPUTS_GET), hears every change
 * (LYRE_OUTPUTS_STATE, once per tick of changes), and moves a bot to a voice channel, takes it out, mutes it,
 * sets its room's volume or tries a failed join again (LYRE_OUTPUT_*).
 *
 * OUT-8 (round 6): Settings in Lyre. The page adds a bot with its token and Application ID, replaces a token,
 * renames, removes (and puts back) a bot, connects and disconnects it, and opens its invite (LYRE_BOT_*). A token goes
 * one way only, into the main process (encrypted there, SEC-5); the page sees its last four characters. The invite is
 * made here from the Application ID, so the page never names an address to open.
 */
export class LyreOutputsBridge {
  private readonly ipc = guardIpc(ipcMain);
  private view?: WebContents;
  private readonly onState = () => this.push();

  private readonly openExternal: (url: string) => Promise<void>;

  constructor(
    private readonly outputs: OutputManager,
    options: { openExternal?: (url: string) => Promise<void> } = {},
  ) {
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.ipc.handle("LYRE_OUTPUTS_GET", () => lyreOutputsOf(this.outputs.state()));
    this.ipc.on("LYRE_OUTPUT_MOVE", (_event, id: string, channelId: string) => void this.outputs.moveBot(id, channelId));
    this.ipc.on("LYRE_OUTPUT_LEAVE", (_event, id: string) => this.outputs.leaveAll(id));
    this.ipc.on("LYRE_OUTPUT_SET_MUTED", (_event, id: string, muted: boolean) => this.outputs.setMuted(id, muted));
    this.ipc.on("LYRE_OUTPUT_SET_VOLUME", (_event, id: string, volume: number) => this.outputs.setRoomVolume(id, volume));
    this.ipc.on("LYRE_OUTPUT_RETRY", (_event, id: string) => void this.outputs.reconnect(id));
    // --- w6-contracts (OUT-8) ---
    this.ipc.handle("LYRE_BOT_ADD", (_event, token: string, applicationId: string | null) => this.outputs.addBotWithToken(token, applicationId));
    this.ipc.handle("LYRE_BOT_SET_TOKEN", (_event, id: string, token: string) => this.outputs.replaceToken(id, token));
    this.ipc.handle("LYRE_BOT_RENAME", (_event, id: string, name: string) => this.outputs.renameBot(id, name));
    this.ipc.handle("LYRE_BOT_SET_APP_ID", (_event, id: string, applicationId: string | null) => this.outputs.setApplicationId(id, applicationId));
    this.ipc.handle("LYRE_BOT_REMOVE", (_event, id: string) => this.outputs.removeBotForUndo(id));
    this.ipc.handle("LYRE_BOT_RESTORE", (_event, id: string) => this.outputs.restoreBot(id));
    this.ipc.on("LYRE_BOT_CONNECT", (_event, id: string) => void this.outputs.connect(id));
    this.ipc.on("LYRE_BOT_DISCONNECT", (_event, id: string) => this.outputs.disconnect(id));
    this.ipc.on("LYRE_BOT_OPEN_INVITE", (_event, applicationId: string) => this.openInvite(applicationId));
    outputs.on("stateChange", this.onState);
  }

  /** The invite in the browser; in a test build the fake Discord admits the bot instead (no browser opens). */
  private openInvite(applicationId: string): void {
    if (!isApplicationId(applicationId) || this.outputs.inviteOpenedByDriver(applicationId)) return;
    openExternalIfAllowed(botInviteUrl(applicationId), this.openExternal);
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
