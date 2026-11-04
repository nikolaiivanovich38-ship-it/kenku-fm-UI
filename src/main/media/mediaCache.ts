/**
 * BUG-10 and PLY-11: Lyre's own audio cache folder (`<data folder>/media-cache`).
 *
 * - Formats the player cannot play (WMA and others, formats.ts) are converted
 *   once, in the background, one file at a time, to FLAC when the source is
 *   lossless and to Opus when it is not. The copy is reused until the source
 *   changes.
 * - A track asked for with `keepLocal` (a long track the player cannot hold
 *   in memory, PLY-11) is copied to this computer's disk in the background;
 *   the original plays until the copy is ready.
 *
 * Copies are keyed by the source's real path, size and modified time, so a
 * changed file is converted again. `sweep()` removes copies whose source has
 * gone or changed, and leftovers of an interrupted job. The folder stays under
 * `capBytes`, dropping what was used longest ago.
 *
 * Safety: files are read only after MediaAccess allowed them (library folders,
 * real paths). Every file this class writes or deletes is named
 * `<40 hex digits>.<extension>` (or that plus `.part`) directly inside the
 * cache folder; names read back from the index are checked against that
 * pattern, so a damaged index cannot point it anywhere else.
 */
import { createHash } from "crypto";
import fs from "fs";
import nodePath from "path";
import { pathToFileURL } from "url";

import type { AudioConverter, ConvertTarget } from "./converter";
import { TARGET_EXTENSION } from "./converter";
import { Conversion, conversionOf } from "./formats";
import { AccessResult, isRefused } from "./mediaAccess";

export type PrepareAnswer = { url: string } | { error: string };

type Allowed = Extract<AccessResult, { ok: true }>;

interface Entry {
  kind: "convert" | "copy";
  source: string;
  size: number;
  mtimeMs: number;
  /** File name inside the cache folder. */
  file: string;
  bytes: number;
  lastUsed: number;
}

/** 8 GB: about 50 hours of converted FLAC. */
export const DEFAULT_CACHE_BYTES = 8_000_000_000;
export const MEDIA_CACHE_FOLDER = "media-cache";

const INDEX = "index.json";
const OWN_FILE = /^[0-9a-f]{40}\.[a-z0-9]{1,5}$/;
const OWN_PART = /^[0-9a-f]{40}\.[a-z0-9]{1,5}\.part$/;

export class MediaCache {
  private readonly folder: string;
  private readonly access: { check(address: string): Promise<AccessResult> };
  private readonly converter: AudioConverter;
  private readonly capBytes: number;
  private readonly windowsPaths: boolean;
  private readonly log: (message: string, error?: unknown) => void;
  private index: Map<string, Entry> | null = null;
  private loading: Promise<Map<string, Entry>> | null = null;
  /** Jobs under way, by key, so one file is never converted or copied twice at once. */
  private readonly jobs = new Map<string, Promise<Entry>>();
  /** Part files being written now; sweep() leaves them alone. */
  private readonly writing = new Set<string>();
  /** One conversion at a time, and one copy at a time, so playback keeps the disk and processor it needs. */
  private readonly queues = { convert: Promise.resolve() as Promise<unknown>, copy: Promise.resolve() as Promise<unknown> };
  private readonly background = new Set<Promise<unknown>>();
  private readonly controller = new AbortController();
  private saving: Promise<void> = Promise.resolve();
  private stamp = 0;

  constructor(options: {
    /** Lyre's cache folder; created when first needed. */
    folder: string;
    access: { check(address: string): Promise<AccessResult> };
    converter: AudioConverter;
    capBytes?: number;
    windowsPaths?: boolean;
    log?: (message: string, error?: unknown) => void;
  }) {
    this.folder = options.folder;
    this.access = options.access;
    this.converter = options.converter;
    this.capBytes = options.capBytes ?? DEFAULT_CACHE_BYTES;
    this.windowsPaths = options.windowsPaths ?? process.platform === "win32";
    this.log = options.log ?? ((message, error) => console.warn(message, error ?? ""));
  }

  /** The address the player should play for `address` (a file: address from the library). */
  async prepare(address: string, { keepLocal }: { keepLocal: boolean }): Promise<PrepareAnswer> {
    const checked = await this.access.check(address);
    if (isRefused(checked)) {
      return { error: checked.message };
    }
    const allowed = checked as Allowed;
    await this.load();
    const conversion = conversionOf(allowed.path);
    if (conversion) {
      try {
        return { url: this.urlOf(await this.converted(allowed, conversion)) };
      } catch (error) {
        this.log(`Could not convert ${allowed.path}`, error);
        return { error: `Could not convert ${nodePath.basename(allowed.path)}.` };
      }
    }
    if (keepLocal) {
      const key = this.keyOf("copy", allowed);
      const copy = await this.ready(key);
      if (copy) {
        return { url: this.urlOf(copy) };
      }
      this.inBackground(this.job(key, "copy", (signal) => this.copy(key, allowed, signal)));
    }
    return { url: pathToFileURL(allowed.path, { windows: this.windowsPaths }).href };
  }

  /** Wait for every background job (tests, and before quitting). */
  async idle(): Promise<void> {
    while (this.background.size > 0) {
      await Promise.allSettled([...this.background]);
    }
    await this.saving;
  }

  /** Remove copies whose source is gone or changed, and leftovers of interrupted jobs. Returns how many files went. */
  async sweep(): Promise<number> {
    const index = await this.load();
    let removed = 0;
    for (const [key, entry] of [...index]) {
      if (this.jobs.has(key)) {
        continue;
      }
      if (!(await this.sourceUnchanged(entry))) {
        if (await this.remove(entry.file)) {
          index.delete(key);
          removed++;
        }
      } else if (!(await exists(this.pathOf(entry.file)))) {
        index.delete(key);
      }
    }
    const referenced = new Set([...index.values()].map((entry) => entry.file));
    for (const name of await this.ownFiles()) {
      const stray = OWN_FILE.test(name) && !referenced.has(name);
      const leftover = OWN_PART.test(name) && !this.writing.has(name);
      if ((stray || leftover) && (await this.remove(name))) {
        removed++;
      }
    }
    await this.save();
    return removed;
  }

  /** Empty the cache (Settings > Clear audio cache), leaving jobs under way to finish. */
  async clear(): Promise<void> {
    const index = await this.load();
    for (const [key, entry] of [...index]) {
      if (!this.jobs.has(key) && (await this.remove(entry.file))) {
        index.delete(key);
      }
    }
    for (const name of await this.ownFiles()) {
      if ((OWN_FILE.test(name) || OWN_PART.test(name)) && !this.writing.has(name) && ![...index.values()].some((e) => e.file === name)) {
        await this.remove(name);
      }
    }
    await this.save();
  }

  /** Stop jobs under way (quitting). */
  close(): void {
    this.controller.abort();
  }

  private async converted(allowed: Allowed, conversion: Conversion): Promise<Entry> {
    const key = this.keyOf("convert", allowed);
    return (await this.ready(key)) ?? this.job(key, "convert", (signal) => this.convert(key, allowed, conversion, signal));
  }

  private async convert(key: string, allowed: Allowed, conversion: Conversion, signal: AbortSignal): Promise<Entry> {
    let target: ConvertTarget;
    if (conversion === "check") {
      target = (await this.converter.isLossless(allowed.path, signal)) ? "flac" : "opus";
    } else {
      target = conversion === "lossless" ? "flac" : "opus";
    }
    const file = `${key}${TARGET_EXTENSION[target]}`;
    await this.produce(file, (part) => this.converter.convert({ input: allowed.path, output: part, target, signal }));
    return this.add(key, { kind: "convert", source: allowed.path, size: allowed.size, mtimeMs: allowed.mtimeMs, file });
  }

  private async copy(key: string, allowed: Allowed, signal: AbortSignal): Promise<Entry> {
    const extension = nodePath.extname(allowed.path).toLowerCase();
    const file = `${key}${/^\.[a-z0-9]{1,5}$/.test(extension) ? extension : ".bin"}`;
    await this.produce(file, async (part) => {
      if (signal.aborted) {
        throw new Error("Cancelled");
      }
      await fs.promises.copyFile(allowed.path, part);
    });
    return this.add(key, { kind: "copy", source: allowed.path, size: allowed.size, mtimeMs: allowed.mtimeMs, file });
  }

  /** Run `work` once per key, in its queue. */
  private job(key: string, queue: keyof MediaCache["queues"], work: (signal: AbortSignal) => Promise<Entry>): Promise<Entry> {
    const running = this.jobs.get(key);
    if (running) {
      return running;
    }
    const run = this.queues[queue].then(() => work(this.controller.signal));
    this.queues[queue] = run.catch((): undefined => undefined);
    const tracked = run.finally(() => this.jobs.delete(key));
    this.jobs.set(key, tracked);
    return tracked;
  }

  private inBackground(work: Promise<unknown>) {
    const tracked = work
      .catch((error) => this.log("Could not keep a copy of a track on this computer", error))
      .finally(() => this.background.delete(tracked));
    this.background.add(tracked);
  }

  /** Write `file` through a part file, so a half-written file is never played. */
  private async produce(file: string, write: (partPath: string) => Promise<void>): Promise<void> {
    await fs.promises.mkdir(this.folder, { recursive: true });
    const partName = `${file}.part`;
    const part = this.pathOf(partName);
    this.writing.add(partName);
    try {
      await fs.promises.rm(part, { force: true });
      await write(part);
      await fs.promises.rename(part, this.pathOf(file));
    } catch (error) {
      await fs.promises.rm(part, { force: true }).catch((): undefined => undefined);
      throw error;
    } finally {
      this.writing.delete(partName);
    }
  }

  private async add(key: string, fields: Omit<Entry, "bytes" | "lastUsed">): Promise<Entry> {
    const index = await this.load();
    const entry: Entry = { ...fields, bytes: (await fs.promises.stat(this.pathOf(fields.file))).size, lastUsed: this.nextStamp() };
    index.set(key, entry);
    await this.keepUnderCap(key);
    // Saved before the copy is used, so it is known after a restart.
    await this.save();
    return entry;
  }

  /** The finished copy for `key`, marked as just used, or undefined. */
  private async ready(key: string): Promise<Entry | undefined> {
    const index = await this.load();
    const entry = index.get(key);
    if (!entry) {
      return undefined;
    }
    if (!(await exists(this.pathOf(entry.file)))) {
      index.delete(key);
      void this.save();
      return undefined;
    }
    entry.lastUsed = this.nextStamp();
    void this.save();
    return entry;
  }

  private async keepUnderCap(keep: string) {
    const index = await this.load();
    let total = [...index.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    const oldestFirst = [...index].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of oldestFirst) {
      if (total <= this.capBytes) {
        return;
      }
      if (key !== keep && !this.jobs.has(key) && (await this.remove(entry.file))) {
        index.delete(key);
        total -= entry.bytes;
      }
    }
  }

  private async sourceUnchanged(entry: Entry): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(entry.source);
      return stat.isFile() && stat.size === entry.size && stat.mtimeMs === entry.mtimeMs;
    } catch {
      return false;
    }
  }

  /** Delete one of the cache's own files; false when it could not be deleted (for example, playing on Windows). */
  private async remove(name: string): Promise<boolean> {
    if (!OWN_FILE.test(name) && !OWN_PART.test(name)) {
      return false;
    }
    try {
      await fs.promises.rm(this.pathOf(name), { force: true });
      return true;
    } catch (error) {
      this.log(`Could not remove ${name} from the audio cache`, error);
      return false;
    }
  }

  private async ownFiles(): Promise<string[]> {
    try {
      return await fs.promises.readdir(this.folder);
    } catch {
      return [];
    }
  }

  private pathOf(name: string): string {
    // Names are checked against OWN_FILE / OWN_PART (no separators), so this stays inside the folder.
    return nodePath.join(this.folder, name);
  }

  private urlOf(entry: Entry): string {
    return pathToFileURL(this.pathOf(entry.file), { windows: this.windowsPaths }).href;
  }

  private keyOf(kind: Entry["kind"], allowed: Allowed): string {
    const path = this.windowsPaths ? allowed.path.toLowerCase() : allowed.path;
    return createHash("sha256").update(`${kind}\0${path}\0${allowed.size}\0${allowed.mtimeMs}`).digest("hex").slice(0, 40);
  }

  private nextStamp(): number {
    this.stamp = Math.max(Date.now(), this.stamp + 1);
    return this.stamp;
  }

  private load(): Promise<Map<string, Entry>> {
    if (this.index) {
      return Promise.resolve(this.index);
    }
    this.loading ??= (async () => {
      const index = new Map<string, Entry>();
      try {
        const saved = JSON.parse(await fs.promises.readFile(this.pathOf(INDEX), "utf8")) as { entries?: Record<string, unknown> };
        for (const [key, value] of Object.entries(saved.entries ?? {})) {
          if (/^[0-9a-f]{40}$/.test(key) && isEntry(value)) {
            index.set(key, value);
            this.stamp = Math.max(this.stamp, value.lastUsed);
          }
        }
      } catch {
        // No index yet, or a damaged one: start empty; sweep() removes unknown files.
      }
      this.index = index;
      return index;
    })();
    return this.loading;
  }

  /** Save the index (atomically, one save at a time). */
  private save(): Promise<void> {
    const index = this.index;
    if (!index) {
      return this.saving;
    }
    this.saving = this.saving.then(async () => {
      // The folder is made with the first copy; if it has gone since, there is nothing to describe.
      if (!(await exists(this.folder))) {
        return;
      }
      try {
        const temporary = this.pathOf(`${INDEX}.tmp`);
        await fs.promises.writeFile(temporary, JSON.stringify({ version: 1, entries: Object.fromEntries(index) }));
        await fs.promises.rename(temporary, this.pathOf(INDEX));
      } catch (error) {
        this.log("Could not save the audio cache's index", error);
      }
    });
    return this.saving;
  }
}

function isEntry(value: unknown): value is Entry {
  const entry = value as Partial<Entry> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry.kind === "convert" || entry.kind === "copy") &&
    typeof entry.source === "string" &&
    typeof entry.file === "string" &&
    OWN_FILE.test(entry.file) &&
    [entry.size, entry.mtimeMs, entry.bytes, entry.lastUsed].every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.promises.stat(path);
    return true;
  } catch {
    return false;
  }
}
