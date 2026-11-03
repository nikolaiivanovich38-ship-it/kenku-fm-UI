/**
 * Test doubles for HTML drag and drop and the File and Directory Entries API.
 *
 * jsdom implements neither DataTransfer nor FileSystemEntry, so the drop and
 * import tests (BUG-1, BUG-2, BUG-10) build these small fakes instead. They
 * mimic Chromium's behaviour where it matters, notably that a directory
 * reader hands out entries in batches and then an empty array.
 */

/** Creates a File with the given name and OS-reported MIME type. */
export function fakeFile(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

/** A file entry whose `file()` resolves to `file`, or fails when `fail` is set. */
export function fakeFileEntry(
  file: File,
  options: { fail?: boolean } = {}
): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    fullPath: `/${file.name}`,
    file(
      success: (file: File) => void,
      failure?: (error: DOMException) => void
    ) {
      if (options.fail) {
        failure?.(new DOMException("Unreadable", "NotReadableError"));
      } else {
        success(file);
      }
    },
  } as unknown as FileSystemFileEntry;
}

/**
 * A directory entry whose reader returns `children` in batches of
 * `batchSize` (Chromium uses 100) and then an empty array.
 */
export function fakeDirectoryEntry(
  name: string,
  children: FileSystemEntry[],
  options: { batchSize?: number; failRead?: boolean } = {}
): FileSystemDirectoryEntry {
  const batchSize = options.batchSize ?? 100;
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    createReader() {
      let offset = 0;
      return {
        readEntries(
          success: (entries: FileSystemEntry[]) => void,
          failure?: (error: DOMException) => void
        ) {
          if (options.failRead) {
            failure?.(new DOMException("Unreadable", "NotReadableError"));
            return;
          }
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          success(batch);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

/** Shorthand: a file entry for a new fake file. */
export function entryFor(name: string, type = ""): FileSystemFileEntry {
  return fakeFileEntry(fakeFile(name, type));
}

type FakeItem = {
  kind: string;
  type: string;
  webkitGetAsEntry: () => FileSystemEntry | null;
  getAsFile: () => File | null;
};

/**
 * Builds a DataTransfer-like object for fireEvent drag events.
 * - `entries` become file items (as when files or folders are dragged in).
 * - `strings` become non-file items (text or links); their
 *   `webkitGetAsEntry()` returns null, as in Chromium.
 * - `types` defaults to ["Files"] when entries or files are given.
 */
export function fakeDataTransfer(
  init: {
    entries?: FileSystemEntry[];
    files?: File[];
    strings?: string[];
    types?: string[];
  } = {}
) {
  const entries = init.entries ?? [];
  const files = init.files ?? [];
  const strings = init.strings ?? [];
  const items: FakeItem[] = [
    ...entries.map((entry) => ({
      kind: "file",
      type: "",
      webkitGetAsEntry: (): FileSystemEntry | null => entry,
      getAsFile: (): File | null => null,
    })),
    ...strings.map(() => ({
      kind: "string",
      type: "text/plain",
      webkitGetAsEntry: (): FileSystemEntry | null => null,
      getAsFile: (): File | null => null,
    })),
  ];
  const types =
    init.types ??
    [
      ...(entries.length > 0 || files.length > 0 ? ["Files"] : []),
      ...(strings.length > 0 ? ["text/plain"] : []),
    ];
  return {
    types,
    items,
    files,
    dropEffect: "none",
    effectAllowed: "all",
  };
}
