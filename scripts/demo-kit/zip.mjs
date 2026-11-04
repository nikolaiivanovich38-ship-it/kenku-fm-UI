// A minimal ZIP writer and reader (deflate or store, no ZIP64), enough for
// the demo kit: a few dozen files, well under 4 GB. Every entry gets the same
// fixed date and the entries are written in the order given, so the same
// files always give a byte-identical archive.
import zlib from "node:zlib";

// 1 November 2026, 12:00, in MS-DOS date and time format.
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 1;
const DOS_TIME = 12 << 11;
const UTF8_NAMES = 0x0800;

/**
 * Build a ZIP archive from `entries` ([{ name, data }], names with "/"
 * separators). Each file is deflated at the highest level, or stored when
 * deflating would not make it smaller.
 */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      throw new Error(`Unsafe name in archive: ${name}`);
    }
    const nameBytes = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: MS-DOS, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra length, comment length, disk number, internal attributes: 0
    central.writeUInt32LE(0x20, 38); // external attributes: "archive", a normal file
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * Read every file in a ZIP archive written by createZip (or any simple
 * archive without ZIP64 or encryption), checking each file's CRC.
 * Returns [{ name, data }] in archive order.
 */
export function readZip(archive) {
  const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("No end-of-archive record");
  const count = archive.readUInt16LE(endAt + 10);
  let at = archive.readUInt32LE(endAt + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error(`Bad central directory entry ${n}`);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localAt = archive.readUInt32LE(at + 42);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`Bad local header for ${name}`);
    const localNameLength = archive.readUInt16LE(localAt + 26);
    const localExtraLength = archive.readUInt16LE(localAt + 28);
    const start = localAt + 30 + localNameLength + localExtraLength;
    const body = archive.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = zlib.inflateRawSync(body);
    else throw new Error(`Unsupported compression ${method} for ${name}`);
    if (data.length !== size) throw new Error(`Wrong size for ${name}`);
    if (zlib.crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.push({ name, data });
  }
  return files;
}
