/**
 * FND-9: the diagnostics zip (design/prototype/HELP.md "Save diagnostics"). Everything is gathered from Lyre itself
 * (diagnosticsBridge.ts passes the sources), scrubbed (scrub.ts) and written into the folder the game master chose.
 * Nothing here can send anything anywhere: this folder imports no network module (diagnostics.test.ts checks).
 */
import fs from "fs";
import path from "path";
import { writeZip } from "../transfer/zip";
import { scrubText, scrubValue } from "./scrub";

export interface DiagnosticsSources {
  /** Lyre's version, Electron and Chrome, the operating system and its version, the architecture, the language. */
  about: () => Record<string, string>;
  /** The recent log lines (logBuffer.ts), oldest first. */
  log: () => string[];
  /** The recent blocked-content warnings. */
  blocked: () => string[];
  /** The settings of the Lyre page and the bots, gathered from the running app (FND-16: no old main window). */
  settings: () => Promise<unknown>;
  /** The user's home folder, written as "~". */
  home: string;
}

const README = `Lyre diagnostics

This file was saved by Lyre's Help > Save diagnostics. Nothing in this file was sent anywhere:
it stays where you saved it until you send it yourself, for example with a bug report.

about.json     Lyre's version, the operating system and its version.
log.txt        The last lines of Lyre's log since it started.
settings.json  Lyre's settings, and each Discord bot's status.
blocked.txt    Warnings about blocked content: pages, addresses, permissions and messages Lyre refused.

Taken out before saving: bot tokens and anything that looks like one, every setting whose name says
token, secret, password, key or credential, and your user folder in paths (written as ~).
Not in it: your music, your library, your bookmarks, the names of people in Discord.
`;

const two = (n: number) => String(n).padStart(2, "0");

/** "Lyre diagnostics 2026-11-06 14-32.zip": the local date and time, with no character Windows refuses. */
export function diagnosticsFileName(at: Date): string {
  return `Lyre diagnostics ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}-${two(at.getMinutes())}.zip`;
}

/** The file's path in `folder`, with " (2)", " (3)"… when one of that name is there already. */
function freePath(folder: string, name: string): string {
  const stem = name.replace(/\.zip$/, "");
  for (let n = 1; ; n++) {
    const candidate = path.join(folder, n === 1 ? name : `${stem} (${n}).zip`);
    if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.part`)) return candidate;
  }
}

const text = (s: string) => Buffer.from(s.replace(/\r?\n/g, "\r\n"), "utf8");

/** Gathers, scrubs and writes the zip; answers its path. */
export async function saveDiagnostics({ folder, sources, at = new Date() }: { folder: string; sources: DiagnosticsSources; at?: Date }): Promise<string> {
  const scrub = { home: sources.home };
  let settings: unknown;
  try {
    settings = await sources.settings();
  } catch (error) {
    settings = { unreadable: error instanceof Error ? error.message : String(error) };
  }
  const json = (value: unknown) => Buffer.from(JSON.stringify(scrubValue(value, scrub), null, 2), "utf8");
  const lines = (list: string[], none: string) => text((list.length ? list.map((l) => scrubText(l, scrub)) : [none]).join("\n") + "\n");
  const target = freePath(folder, diagnosticsFileName(at));
  await writeZip(
    target,
    [
      { name: "README.txt", bytes: text(README), deflate: true },
      { name: "about.json", bytes: json({ saved: at.toISOString(), ...sources.about() }), deflate: true },
      { name: "log.txt", bytes: lines(sources.log(), "(nothing logged yet)"), deflate: true },
      { name: "settings.json", bytes: json(settings), deflate: true },
      { name: "blocked.txt", bytes: lines(sources.blocked(), "(nothing was blocked)"), deflate: true },
    ],
    { at },
  );
  return target;
}
