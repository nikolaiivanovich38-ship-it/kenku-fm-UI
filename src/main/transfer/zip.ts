/**
 * DAT-7: the zip layer under .lyre files (docs/data-model.md, "The .lyre file"). Node only, no library.
 *
 * Writing: entries are stored (audio, already compressed) or deflated (JSON), with UTF-8 names and CRC-32. A stored
 * entry is streamed from its source with its sizes in a data descriptor after it, so a large audio file is never held
 * in memory. The zip is written to "<name>.part" and moved into place at the end, so a failed save leaves nothing.
 * No zip64: a .lyre file stays under 4 GB (the caller refuses more before writing).
 *
 * Reading treats the file as hostile (docs/security.md, "w4-transfer"): only the central directory is parsed, within
 * the file's size; names are refused when absolute, with a backslash, or with "." or ".." parts; the number of entries
 * and each entry's size are capped before reading; a deflated entry inflates only up to the size the caller allows
 * and must match its stated size and CRC; encrypted entries and methods other than stored and deflate are refused.
 */
import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import { crc32, deflateRaw, inflateRaw } from "zlib";
import { promisify } from "util";

const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

/** Why a zip cannot be read: not a zip at all, cut off or changed, a name that could leave a folder, or too big. */
export type ZipErrorCode = "not-zip" | "damaged" | "unsafe-name" | "too-big" | "unsupported";

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string,
  ) {
    super(message);
    // The app's bundles compile classes to ES5, where a subclass of Error loses its prototype (errorsBuilt.test.ts).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "ZipError";
  }
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
/** bit 3: sizes in a data descriptor; bit 11: the name is UTF-8. */
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const FLAG_ENCRYPTED = 0x0001;
/** Largest offset or size a zip without zip64 can name. */
export const ZIP_LIMIT = 0xffffffff;

export type ZipInput =
  | { name: string; bytes: Buffer; deflate?: boolean }
  | { name: string; stream: () => Readable };

/** A name with no way out of the folder it is unpacked in: relative, "/" only, no empty, "." or ".." parts. */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** MS-DOS time and date of `at` (local time, as zip tools show them). */
function dosTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

interface Written {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Writes a zip of `entries` at `target`. `allowAnyName` is for tests that make hostile files. */
export async function writeZip(target: string, entries: readonly ZipInput[], options: { at?: Date; allowAnyName?: boolean } = {}): Promise<number> {
  const part = `${target}.part`;
  const { time, date } = dosTime(options.at ?? new Date());
  const handle = await fs.promises.open(part, "w");
  let offset = 0;
  const put = async (chunk: Buffer) => {
    await handle.write(chunk, 0, chunk.length, offset);
    offset += chunk.length;
    if (offset > ZIP_LIMIT) throw new ZipError("too-big", "The file would be larger than 4 GB.");
  };
  const header = (w: Omit<Written, "offset">, local: boolean) => {
    const fixed = Buffer.alloc(local ? 30 : 46);
    let p = 0;
    fixed.writeUInt32LE(local ? LOCAL : CENTRAL, p);
    p += 4;
    if (!local) {
      fixed.writeUInt16LE(20, p); // made by: version 2.0
      p += 2;
    }
    fixed.writeUInt16LE(20, p); // version needed: 2.0 (deflate)
    fixed.writeUInt16LE(w.flags, p + 2);
    fixed.writeUInt16LE(w.method, p + 4);
    fixed.writeUInt16LE(time, p + 6);
    fixed.writeUInt16LE(date, p + 8);
    const sizesLater = local && (w.flags & FLAG_DESCRIPTOR) !== 0;
    fixed.writeUInt32LE(sizesLater ? 0 : w.crc, p + 10);
    fixed.writeUInt32LE(sizesLater ? 0 : w.compressed, p + 14);
    fixed.writeUInt32LE(sizesLater ? 0 : w.size, p + 18);
    fixed.writeUInt16LE(w.name.length, p + 22);
    // Extra field length 0; for the central directory also comment 0, disk 0, attributes 0.
    return Buffer.concat([fixed, w.name]);
  };
  const written: Written[] = [];
  try {
    for (const entry of entries) {
      if (!options.allowAnyName && !isSafeEntryName(entry.name)) throw new ZipError("unsafe-name", `Unsafe name in a zip: ${entry.name}`);
      const name = Buffer.from(entry.name, "utf8");
      const start = offset;
      if ("bytes" in entry) {
        const body = entry.deflate ? await deflateRawAsync(entry.bytes) : entry.bytes;
        const w = { name, flags: FLAG_UTF8, method: entry.deflate ? 8 : 0, crc: crc32(entry.bytes), compressed: body.length, size: entry.bytes.length };
        await put(header(w, true));
        await put(body);
        written.push({ ...w, offset: start });
        continue;
      }
      const flags = FLAG_UTF8 | FLAG_DESCRIPTOR;
      await put(header({ name, flags, method: 0, crc: 0, compressed: 0, size: 0 }, true));
      let crc = 0;
      let size = 0;
      for await (const chunk of entry.stream()) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        crc = crc32(bytes, crc);
        size += bytes.length;
        await put(bytes);
      }
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DESCRIPTOR, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      await put(descriptor);
      written.push({ name, flags, method: 0, crc: crc >>> 0, compressed: size, size, offset: start });
    }
    const centralStart = offset;
    for (const w of written) {
      const central = header(w, false);
      // The local header's offset sits at byte 42 of the fixed part.
      central.writeUInt32LE(w.offset, 42);
      await put(central);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    await put(end);
    await handle.close();
    await fs.promises.rename(part, target);
    return offset;
  } catch (error) {
    await handle.close().catch((): void => undefined);
    await fs.promises.rm(part, { force: true });
    throw error;
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export interface OpenedZip {
  entries: ZipEntry[];
  has(name: string): boolean;
  /** An entry's bytes, refused ("too-big") when it would be over `maxBytes`. */
  read(name: string, maxBytes: number): Promise<Buffer>;
  /** The first `maxBytes` bytes (or fewer) of a stored entry, unchecked: enough to tell what kind of file it is. */
  head(name: string, maxBytes: number): Promise<Buffer>;
  /** Streams a stored entry to `target` (through "<target>.part"), checking its CRC; nothing is left when it fails. */
  copyTo(name: string, target: string): Promise<void>;
  close(): Promise<void>;
}

export interface ZipLimits {
  /** Most entries a file may hold (default 100,000). */
  maxEntries?: number;
  /** Largest central directory read (default 32 MB). */
  maxDirectoryBytes?: number;
}

const damaged = (why: string) => new ZipError("damaged", why);

async function readAt(handle: fs.promises.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw damaged("The file stops part-way.");
  return buffer;
}

/** Opens a zip for reading: its central directory only, checked against the file's size and the limits. */
export async function openZip(file: string, limits: ZipLimits = {}): Promise<OpenedZip> {
  const maxEntries = limits.maxEntries ?? 100_000;
  const maxDirectory = limits.maxDirectoryBytes ?? 32 * 1024 * 1024;
  const handle = await fs.promises.open(file, "r");
  try {
    const fileSize = (await handle.stat()).size;
    if (fileSize < 22) throw new ZipError(fileSize >= 4 && (await readAt(handle, 0, 4)).readUInt32LE(0) === LOCAL ? "damaged" : "not-zip", "Not a zip file.");
    const first = (await readAt(handle, 0, 4)).readUInt32LE(0);
    // The end record sits in the last 22 bytes plus at most a 65,535-byte comment.
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = await readAt(handle, fileSize - tailLength, tailLength);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === END) {
        at = i;
        break;
      }
    }
    if (at < 0) throw first === LOCAL ? damaged("The file stops part-way.") : new ZipError("not-zip", "Not a zip file.");
    const count = tail.readUInt16LE(at + 10);
    const directorySize = tail.readUInt32LE(at + 12);
    const directoryStart = tail.readUInt32LE(at + 16);
    if (count === 0xffff || directorySize === ZIP_LIMIT || directoryStart === ZIP_LIMIT) throw new ZipError("unsupported", "zip64 files are not supported.");
    if (count > maxEntries) throw new ZipError("too-big", "The file holds too many parts.");
    if (directorySize > maxDirectory) throw new ZipError("too-big", "The file's list of parts is too large.");
    if (directoryStart + directorySize > fileSize - tailLength + at) throw damaged("The file's list of parts lies outside it.");
    const directory = await readAt(handle, directoryStart, directorySize);
    const entries: ZipEntry[] = [];
    const names = new Set<string>();
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > directory.length || directory.readUInt32LE(p) !== CENTRAL) throw damaged("The file's list of parts is broken.");
      const flags = directory.readUInt16LE(p + 8);
      const method = directory.readUInt16LE(p + 10);
      const crc = directory.readUInt32LE(p + 16);
      const compressedSize = directory.readUInt32LE(p + 20);
      const size = directory.readUInt32LE(p + 24);
      const nameLength = directory.readUInt16LE(p + 28);
      const extraLength = directory.readUInt16LE(p + 30);
      const commentLength = directory.readUInt16LE(p + 32);
      const offset = directory.readUInt32LE(p + 42);
      if (p + 46 + nameLength + extraLength + commentLength > directory.length) throw damaged("The file's list of parts is broken.");
      const name = directory.subarray(p + 46, p + 46 + nameLength).toString("utf8");
      p += 46 + nameLength + extraLength + commentLength;
      if (!isSafeEntryName(name) || names.has(name)) throw new ZipError("unsafe-name", "The file holds a part with a name Lyre does not accept.");
      if (flags & FLAG_ENCRYPTED) throw new ZipError("unsupported", "The file is encrypted.");
      if (method !== 0 && method !== 8) throw new ZipError("unsupported", "The file is packed in a way Lyre does not read.");
      if (method === 0 && compressedSize !== size) throw damaged("A stored part has two sizes.");
      if (offset + 30 + nameLength + compressedSize > directoryStart) throw damaged("A part lies outside the file.");
      names.add(name);
      entries.push({ name, method, crc, compressedSize, size, offset });
    }
    const byName = new Map(entries.map((e) => [e.name, e]));
    const entryOf = (name: string) => byName.get(name) ?? (() => { throw damaged(`The file has no ${name}.`); })();
    /** Where an entry's data starts: after its local header, which must agree with the directory. */
    const dataStart = async (entry: ZipEntry) => {
      const local = await readAt(handle, entry.offset, 30);
      if (local.readUInt32LE(0) !== LOCAL || local.readUInt16LE(8) !== entry.method) throw damaged("A part's header is broken.");
      const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + entry.compressedSize > directoryStart) throw damaged("A part lies outside the file.");
      return start;
    };
    return {
      entries,
      has: (name) => byName.has(name),
      async read(name, maxBytes) {
        const entry = entryOf(name);
        if (entry.size > maxBytes || entry.compressedSize > maxBytes) throw new ZipError("too-big", `${name} is too large.`);
        const raw = await readAt(handle, await dataStart(entry), entry.compressedSize);
        let bytes: Buffer;
        if (entry.method === 0) bytes = raw;
        else {
          try {
            // Inflates at most one byte more than stated, so a lying size is caught without inflating a bomb.
            bytes = await inflateRawAsync(raw, { maxOutputLength: Math.min(maxBytes, entry.size) + 1 });
          } catch (error) {
            throw (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" ? damaged(`${name} is larger than it says.`) : damaged(`${name} cannot be unpacked.`);
          }
        }
        if (bytes.length !== entry.size || crc32(bytes) >>> 0 !== entry.crc) throw damaged(`${name} was changed or is cut off.`);
        return bytes;
      },
      async head(name, maxBytes) {
        const entry = entryOf(name);
        if (entry.method !== 0) throw new ZipError("unsupported", "Audio parts are stored, not packed.");
        return readAt(handle, await dataStart(entry), Math.min(maxBytes, entry.size));
      },
      async copyTo(name, target) {
        const entry = entryOf(name);
        if (entry.method !== 0) throw new ZipError("unsupported", "Audio parts are stored, not packed.");
        const start = await dataStart(entry);
        const part = `${target}.part`;
        let crc = 0;
        const check = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            crc = crc32(chunk, crc);
            done(null, chunk);
          },
        });
        try {
          const source = entry.size === 0 ? Readable.from([]) : handle.createReadStream({ start, end: start + entry.size - 1, autoClose: false });
          await pipeline(source, check, fs.createWriteStream(part, { flags: "wx" }));
          if (crc >>> 0 !== entry.crc) throw damaged(`${name} was changed or is cut off.`);
          await fs.promises.rename(part, target);
        } catch (error) {
          await fs.promises.rm(part, { force: true });
          throw error;
        }
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close().catch((): void => undefined);
    throw error;
  }
}
