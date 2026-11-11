/**
 * FND-9: Lyre's recent log, kept in memory only, for Save diagnostics. Lyre writes no log file: the main process's
 * console and the app pages' warnings are recorded here as they happen, the last lines kept, and only written out
 * when the game master saves diagnostics (scrubbed first, diagnosticsZip.ts).
 */

export type LogLevel = "info" | "warn" | "error";

export class LogBuffer {
  private readonly kept: string[] = [];

  constructor(private readonly limit: number) {}

  add(level: LogLevel, text: string, at: Date = new Date()): void {
    // One line per entry, so a stack trace does not push everything else out.
    this.kept.push(`${at.toISOString()} ${level} ${text.replace(/\s*\n\s*/g, " | ").slice(0, 2000)}`);
    if (this.kept.length > this.limit) this.kept.splice(0, this.kept.length - this.limit);
  }

  lines(): string[] {
    return this.kept.slice();
  }
}

/**
 * Pages, addresses, permissions, files and messages Lyre refused (the main process's own words: "Blocked …",
 * "Refused to …", "Ignored a … message", "Denied …"), and Chromium's Content-Security-Policy refusals.
 */
export function isBlockedWarning(text: string): boolean {
  return /^(Blocked|Refused|Ignored a|Denied)\b/.test(text) || /Content[ -]Security[ -]Policy/i.test(text);
}

function format(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

type ConsoleLike = Record<"log" | "info" | "warn" | "error", (...args: unknown[]) => void>;

/** Records what the main process writes to its console; it is still written as before. */
export function captureConsole(target: ConsoleLike, log: LogBuffer, blocked: LogBuffer): void {
  const levels: [keyof ConsoleLike, LogLevel][] = [
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [method, level] of levels) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...args);
      try {
        const text = format(args);
        log.add(level, text);
        if (level !== "info" && isBlockedWarning(text)) blocked.add(level, text);
      } catch {
        // Recording must never break the app's own logging.
      }
    };
  }
}

/**
 * What a page's console message adds to the log: an app page's warnings and errors (`page` is its role, as
 * trustedContents names it), and of a website tab (`page` null) only what was blocked, never its own messages,
 * which could hold what the game master was doing there.
 */
export function pageConsoleLine(message: { level: string; message: string; page: string | null }): { log: string; blocked: boolean } | null {
  const blocked = isBlockedWarning(message.message);
  if (message.page === null) return blocked ? { log: `website tab: ${message.message}`, blocked } : null;
  if (message.level !== "warning" && message.level !== "error") return null;
  return { log: `page ${message.page}: ${message.message}`, blocked };
}
