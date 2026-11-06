/**
 * FND-9: the app's one recent log, started first thing in src/index.ts so it holds the start-up too. The main
 * process's console and the pages' console messages (pageConsoleLine: app pages' warnings and errors, and of a
 * website only what was blocked) go into two buffers that Save diagnostics reads. In memory only.
 */
import { app } from "electron";
import { trustedContents } from "../security/trustedContents";
import { LogBuffer, captureConsole, pageConsoleLine } from "./logBuffer";

export interface DiagnosticsLog {
  log: LogBuffer;
  blocked: LogBuffer;
}

/** The last 500 lines of the log and the last 200 blocked-content warnings. */
export const diagnosticsLog: DiagnosticsLog = { log: new LogBuffer(500), blocked: new LogBuffer(200) };

let started = false;

export function startDiagnosticsLog(): DiagnosticsLog {
  if (started) return diagnosticsLog;
  started = true;
  captureConsole(console as unknown as Parameters<typeof captureConsole>[0], diagnosticsLog.log, diagnosticsLog.blocked);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", (event) => {
      const line = pageConsoleLine({ level: event.level, message: event.message, page: trustedContents.roleOf(contents) });
      if (!line) return;
      const level = event.level === "error" ? "error" : "warn";
      diagnosticsLog.log.add(level, line.log);
      if (line.blocked) diagnosticsLog.blocked.add(level, line.log);
    });
  });
  return diagnosticsLog;
}
