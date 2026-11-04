import { contextBridge, ipcRenderer } from "electron";

import {
  BrowserViewKind,
  BrowserViewManagerPreload,
} from "./preload/managers/BrowserViewManagerPreload";
import type { OutputsState } from "./common/outputs";

const viewManager = new BrowserViewManagerPreload();

type Channel =
  | "ERROR"
  | "FATAL_ERROR"
  | "MESSAGE"
  | "INFO"
  | "SHOW_CONTROLS"
  | "BROWSER_VIEW_DID_NAVIGATE"
  | "BROWSER_VIEW_TITLE_UPDATED"
  | "BROWSER_VIEW_FAVICON_UPDATED"
  | "BROWSER_VIEW_MEDIA_STARTED_PLAYING"
  | "BROWSER_VIEW_MEDIA_PAUSED"
  | "BROWSER_VIEW_NEW_TAB"
  | "BROWSER_VIEW_CLOSE_TAB"
  | "PLAYER_REMOTE_ENABLED"
  | "OUTPUTS_STATE";

const validChannels: Channel[] = [
  "ERROR",
  "FATAL_ERROR",
  "MESSAGE",
  "INFO",
  "SHOW_CONTROLS",
  "BROWSER_VIEW_DID_NAVIGATE",
  "BROWSER_VIEW_TITLE_UPDATED",
  "BROWSER_VIEW_FAVICON_UPDATED",
  "BROWSER_VIEW_MEDIA_STARTED_PLAYING",
  "BROWSER_VIEW_MEDIA_PAUSED",
  "BROWSER_VIEW_NEW_TAB",
  "BROWSER_VIEW_CLOSE_TAB",
  "PLAYER_REMOTE_ENABLED",
  "OUTPUTS_STATE",
];

// Offer each loaded view's audio for Discord. PERF-4: the main process
// captures it only while broadcasting and while the view plays sound.
ipcRenderer.on("BROWSER_VIEW_LOADED", (_, viewId: number) => {
  ipcRenderer.send("AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM", viewId);
});

/**
 * OUT-1 / SEC-5: outputs (this computer and Discord bots). The main process
 * holds the bot tokens; this page can set, replace or remove one and see
 * whether a bot has one, but never read it.
 */
const outputs = {
  getState: (): Promise<OutputsState> => ipcRenderer.invoke("OUTPUTS_GET_STATE"),
  /** Log in every bot that has a saved token (at start, as Kenku FM did). */
  connectSaved: () => ipcRenderer.send("OUTPUTS_CONNECT_SAVED"),
  addBot: (): Promise<string> => ipcRenderer.invoke("BOT_ADD"),
  removeBot: (botId: string) => ipcRenderer.send("BOT_REMOVE", botId),
  /** Resolves true when the token is remembered after a restart. */
  setToken: (botId: string, token: string): Promise<boolean> => ipcRenderer.invoke("BOT_SET_TOKEN", botId, token),
  removeToken: (botId: string) => ipcRenderer.send("BOT_REMOVE_TOKEN", botId),
  /** SEC-5 migration: hand the token saved by an older version to the main process. */
  importLegacyToken: (token: string) => ipcRenderer.send("BOT_IMPORT_LEGACY_TOKEN", token),
  connect: (botId: string) => ipcRenderer.send("BOT_CONNECT", botId),
  disconnect: (botId: string) => ipcRenderer.send("BOT_DISCONNECT", botId),
  joinChannel: (botId: string, channelId: string) => ipcRenderer.send("BOT_JOIN_CHANNEL", botId, channelId),
  leaveChannel: (botId: string, channelId: string) => ipcRenderer.send("BOT_LEAVE_CHANNEL", botId, channelId),
  /** `outputId`: "local" for this computer, or a bot id. */
  setMuted: (outputId: string, muted: boolean) => ipcRenderer.send("OUTPUT_SET_MUTED", outputId, muted),
};

const api = {
  outputs,
  createBrowserView: async (
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    kind?: BrowserViewKind,
  ): Promise<number> => {
    const viewId = await viewManager.createBrowserView(
      url,
      x,
      y,
      width,
      height,
      kind,
    );
    return viewId;
  },
  removeBrowserView: (id: number) => {
    viewManager.removeBrowserView(id);
    ipcRenderer.send("AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM", id);
  },
  removeAllBrowserViews: () => {
    viewManager.removeAllBrowserViews();
    ipcRenderer.send("AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS");
  },
  hideBrowserView: (id: number) => {
    viewManager.hideBrowserView(id);
  },
  showBrowserView: (id: number) => {
    viewManager.showBrowserView(id);
  },
  setBrowserViewBounds: (
    id: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    viewManager.setBrowserViewBounds(id, x, y, width, height);
  },
  loadURL: (id: number, url: string) => {
    viewManager.loadURL(id, url);
  },
  goForward: (id: number) => {
    viewManager.goForward(id);
  },
  goBack: (id: number) => {
    viewManager.goBack(id);
  },
  reload: (id: number) => {
    viewManager.reload(id);
  },
  on: (channel: Channel, callback: (...args: any[]) => any) => {
    if (validChannels.includes(channel)) {
      const newCallback = (_: any, ...args: any[]) => callback(args);
      ipcRenderer.on(channel, newCallback);
    }
  },
  removeAllListeners: (channel: Channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  playerGetURL: (): string => {
    return ipcRenderer.sendSync("PLAYER_GET_URL");
  },
  /** Registers a player view with the remote manager so it can send it commands  */
  playerRegisterView: (viewId: number) => {
    ipcRenderer.send("PLAYER_REGISTER_VIEW", viewId);
  },
  playerStartRemote: (address: string, port: string) => {
    ipcRenderer.send("PLAYER_START_REMOTE", address, port);
  },
  playerStopRemote: () => {
    ipcRenderer.send("PLAYER_STOP_REMOTE");
  },
  setMuted: (id: number, muted: boolean) => {
    ipcRenderer.send("AUDIO_CAPTURE_SET_MUTED", id, muted);
  },
  startExternalAudioCapture: (deviceId: string) => {
    ipcRenderer.send("AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE", deviceId);
  },
  stopExternalAudioCapture: (deviceId: string) => {
    ipcRenderer.send("AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE", deviceId);
  },
  /** PERF-4: applied the next time a broadcast starts (an output joins a voice channel). */
  setStreamingMode: (streamingMode: "lowLatency" | "performance") => {
    ipcRenderer.send("AUDIO_CAPTURE_SET_STREAMING_MODE", streamingMode);
  },
  toggleMaximize: () => {
    ipcRenderer.send("WINDOW_TOGGLE_MAXIMIZE");
  },
  minimize: () => {
    ipcRenderer.send("WINDOW_MINIMIZE");
  },
  close: () => {
    ipcRenderer.send("WINDOW_CLOSE");
  },
  clearCache: () => {
    return ipcRenderer.invoke("CLEAR_CACHE");
  },
  platform: ipcRenderer.sendSync("GET_PLATFORM") as string,
  version: ipcRenderer.sendSync("GET_VERSION") as string,
};

declare global {
  interface Window {
    kenku: typeof api;
  }
}

contextBridge.exposeInMainWorld("kenku", api);
