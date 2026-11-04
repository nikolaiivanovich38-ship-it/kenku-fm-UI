import { app, BrowserWindow, Menu, shell } from "electron";
import { readmeUrl } from "./main/appIdentity";

const isMac = process.platform === "darwin";

// Help > About: the app's name and version, and the credit to Kenku FM that
// its licence (GPL-3.0) asks forks to keep. app.name is productName ("Lyre").
app.setAboutPanelOptions({
  applicationName: app.name,
  applicationVersion: app.getVersion(),
  copyright: "GPL-3.0. Based on Kenku FM by Owlbear Rodeo.",
  ...(readmeUrl() ? { website: readmeUrl() } : {}),
});

const template: any = [
  // { role: 'appMenu' }
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : []),
  // { role: 'fileMenu' }
  {
    label: "File",
    submenu: [
      isMac
        ? { role: "close", accelerator: "Cmd+Shift+W" }
        : { role: "quit", accelerator: "Ctrl+Shift+W" },
    ],
  },
  // { role: 'editMenu' }
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(isMac
        ? [
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { role: "selectAll" },
            { type: "separator" },
            {
              label: "Speech",
              submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
            },
          ]
        : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
    ],
  },
  // { role: 'viewMenu' }
  {
    label: "View",
    submenu: [
      ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      { role: "togglefullscreen" },
    ],
  },
  {
    label: "Tab",
    submenu: [
      {
        label: "New Tab",
        accelerator: isMac ? "Cmd+T" : "Ctrl+T",
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          for (let window of windows) {
            window.webContents.send("BROWSER_VIEW_NEW_TAB");
          }
        },
      },
      {
        label: "Close Tab",
        accelerator: isMac ? "Cmd+W" : "Ctrl+W",
        click: () => {
          const windows = BrowserWindow.getAllWindows();
          for (let window of windows) {
            window.webContents.send("BROWSER_VIEW_CLOSE_TAB");
          }
        },
      },
    ],
  },
  // { role: 'windowMenu' }
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac
        ? [
            { type: "separator" },
            { role: "front" },
            { type: "separator" },
            { role: "window" },
          ]
        : [{ role: "close", accelerator: "Ctrl+Shift+W" }]),
    ],
  },
  {
    role: "help",
    submenu: [
      // FND-1: help points at the fork's README (hidden if no repository is configured).
      ...(readmeUrl()
        ? [
            {
              label: "Learn More",
              click: async () => {
                await shell.openExternal(readmeUrl());
              },
            },
          ]
        : []),
      ...(!isMac ? [{ role: "about" }] : []),
    ],
  },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
