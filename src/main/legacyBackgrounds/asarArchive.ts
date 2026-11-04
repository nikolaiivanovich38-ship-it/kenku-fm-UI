/**
 * Reading single files out of another app's `app.asar`, without Electron's
 * built-in asar support.
 *
 * Electron's patched `fs` opens an archive once and keeps it open for the
 * rest of the session. Holding Kenku FM's `app.asar` open would stop Windows
 * from updating or uninstalling Kenku FM while Cue Desk runs (found by the
 * Windows end-to-end test of 0.1.1). So the archive is read here with plain
 * file reads, each file opened and closed again straight away.
 *
 * Format (as written by @electron/asar): bytes 4–7 hold the size of the
 * header block that starts at byte 8; inside it, bytes 12–15 of the file hold
 * the length of a JSON index that starts at byte 16. A file's data starts at
 * 8 + header size + its `offset`. Files marked `unpacked` live beside the
 * archive in `app.asar.unpacked`.
 */
import path from "path";

/** The plain file functions used: Electron's `original-fs`, or Node's `fs` in tests. */
export interface RawFs {
  promises: {
    open(file: string, flags: string): Promise<{
      read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
      close(): Promise<void>;
    }>;
  };
}

/** Largest index read; Kenku FM's is well under 1 MB. */
const MAX_INDEX_BYTES = 16 * 1024 * 1024;

type IndexNode = {
  files?: Record<string, IndexNode>;
  size?: unknown;
  offset?: unknown;
  unpacked?: unknown;
};

export type AsarFile =
  | { kind: "packed"; position: number; size: number }
  | { kind: "unpacked"; file: string }
  | { kind: "missing" };

async function readRange(rawFs: RawFs, file: string, position: number, length: number): Promise<Buffer> {
  const handle = await rawFs.promises.open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** An opened (and already closed again) archive: its index and where its data starts. */
export class AsarArchive {
  private constructor(
    private readonly rawFs: RawFs,
    readonly archive: string,
    private readonly index: IndexNode,
    private readonly dataStart: number,
  ) {}

  /** Read the archive's index. Throws when the file is not an archive or its index is too large. */
  static async open(rawFs: RawFs, archive: string): Promise<AsarArchive> {
    const head = await readRange(rawFs, archive, 0, 16);
    if (head.length < 16 || head.readUInt32LE(0) !== 4) {
      throw new Error("not an app.asar archive");
    }
    const headerSize = head.readUInt32LE(4);
    const indexLength = head.readUInt32LE(12);
    if (indexLength > MAX_INDEX_BYTES || indexLength + 8 > headerSize) {
      throw new Error("app.asar index too large or damaged");
    }
    const json = (await readRange(rawFs, archive, 16, indexLength)).toString("utf8");
    const index = JSON.parse(json) as IndexNode;
    return new AsarArchive(rawFs, archive, index, 8 + headerSize);
  }

  /** Where a file inside the archive is, by its path with "/" or "\" separators. */
  locate(inner: string): AsarFile {
    let node: IndexNode | undefined = this.index;
    for (const part of inner.split(/[\\/]+/).filter(Boolean)) {
      if (part === "." || part === "..") return { kind: "missing" };
      const children: Record<string, IndexNode> | undefined = node?.files;
      node = children && Object.prototype.hasOwnProperty.call(children, part) ? children[part] : undefined;
      if (node === undefined) return { kind: "missing" };
    }
    if (node.files !== undefined || typeof node.size !== "number") return { kind: "missing" };
    if (node.unpacked === true) {
      return { kind: "unpacked", file: path.join(`${this.archive}.unpacked`, ...inner.split(/[\\/]+/).filter(Boolean)) };
    }
    const offset = Number(node.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(node.size) || node.size < 0) {
      return { kind: "missing" };
    }
    return { kind: "packed", position: this.dataStart + offset, size: node.size };
  }

  /** Read a packed file's bytes (at most `limit`). */
  read(file: Extract<AsarFile, { kind: "packed" }>, limit: number): Promise<Buffer> {
    return readRange(this.rawFs, this.archive, file.position, Math.min(file.size, limit));
  }
}
