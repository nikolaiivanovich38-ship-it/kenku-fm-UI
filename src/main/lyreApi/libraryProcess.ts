/**
 * Entry point of the library's utility process (webpack entry "lyreLibrary"; started by LyreLibraryService).
 * Everything happens in libraryProcessCore.ts; this only connects it to Electron's parent port.
 */
import type { PortLike } from "../../common/lyre/rpc";
import { runLibraryProcess } from "./libraryProcessCore";

const parent = (process as unknown as { parentPort: Electron.ParentPort }).parentPort;

const port: PortLike = {
  postMessage: (message) => parent.postMessage(message),
  onMessage: (listener) => {
    const handler = (event: Electron.MessageEvent) => listener(event.data);
    parent.on("message", handler);
    return () => parent.off("message", handler);
  },
};

runLibraryProcess(port).done.then(() => process.exit(0));
