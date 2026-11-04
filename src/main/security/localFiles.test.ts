import { describe, expect, it, vi } from "vitest";
import path from "path";
import {
  LocalFileFolders,
  LocalFileGate,
  isInsideFolder,
  localFilePrompt,
  type FolderStore,
  type LocalFilePrompt,
  type PromptAnswer,
} from "./localFiles";

function memoryStore(initial: string[] = []): FolderStore & { saved: string[] } {
  const store = {
    saved: [...initial],
    get: () => [...store.saved],
    set: (folders: string[]) => {
      store.saved = [...folders];
    },
  };
  return store;
}

describe("isInsideFolder (SEC-15)", () => {
  it.each([
    ["C:\\Music\\rain.html", "C:\\Music", true],
    ["C:\\Music\\Ambience\\rain.html", "C:\\Music", true],
    ["c:\\music\\rain.html", "C:\\Music\\", true],
    ["C:\\Music", "C:\\Music", true],
    ["C:\\Musical\\rain.html", "C:\\Music", false],
    ["C:\\Music\\..\\Windows\\win.ini", "C:\\Music", false],
    ["D:\\Music\\rain.html", "C:\\Music", false],
  ])("windows: %j in %j -> %s", (file, folder, expected) => {
    expect(isInsideFolder(file, folder, path.win32)).toBe(expected);
  });

  it.each([
    ["/home/gm/maps/a.html", "/home/gm/maps", true],
    ["/home/gm/Maps/a.html", "/home/gm/maps", false],
    ["/home/gm/maps-old/a.html", "/home/gm/maps", false],
    ["/etc/passwd", "/home/gm/maps", false],
  ])("posix: %j in %j -> %s", (file, folder, expected) => {
    expect(isInsideFolder(file, folder, path.posix)).toBe(expected);
  });
});

describe("LocalFileFolders (SEC-15)", () => {
  it("remembers, lists and forgets folders, without duplicates", () => {
    const store = memoryStore();
    const folders = new LocalFileFolders(store, path.win32);
    folders.remember("C:\\Music");
    folders.remember("c:\\music\\");
    folders.remember("D:\\Maps");
    expect(folders.list()).toEqual(["C:\\Music", "D:\\Maps"]);
    expect(folders.allows("C:\\Music\\rain.html")).toBe(true);
    expect(folders.allows("E:\\rain.html")).toBe(false);
    folders.forget("C:\\Music");
    expect(store.saved).toEqual(["D:\\Maps"]);
    expect(folders.allows("C:\\Music\\rain.html")).toBe(false);
  });

  it("ignores anything in the saved file that is not an absolute folder path", () => {
    const store = { get: () => ["C:\\Music", 42, "relative\\folder", ""] as unknown as string[], set: vi.fn() };
    const folders = new LocalFileFolders(store, path.win32);
    expect(folders.list()).toEqual(["C:\\Music"]);
  });

  it("never remembers the root of a drive or the whole disk", () => {
    const folders = new LocalFileFolders(memoryStore(), path.win32);
    folders.remember("C:\\");
    expect(folders.list()).toEqual([]);
    const posix = new LocalFileFolders(memoryStore(), path.posix);
    posix.remember("/");
    expect(posix.list()).toEqual([]);
  });
});

describe("LocalFileGate (SEC-15)", () => {
  function setup(answer: PromptAnswer, remembered: string[] = []) {
    const store = memoryStore(remembered);
    const folders = new LocalFileFolders(store, path.win32);
    const ask = vi.fn(async (_prompt: LocalFilePrompt) => answer);
    const gate = new LocalFileGate({ folders, ask, windowsPaths: true });
    return { gate, ask, store };
  }

  it("asks once, with the full path, and opens the file when the user agrees", async () => {
    const { gate, ask } = setup({ response: 0, checkboxChecked: false });
    await expect(gate.approve("file:///C:/My%20Music/rain.html")).resolves.toBe(
      "file:///C:/My%20Music/rain.html",
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({
      message: "Open this file from your computer?",
      detail: expect.stringContaining("C:\\My Music\\rain.html"),
    });
  });

  it("opens nothing when the user cancels", async () => {
    const { gate, store } = setup({ response: 1, checkboxChecked: true });
    await expect(gate.approve("file:///C:/Music/rain.html")).resolves.toBeUndefined();
    expect(store.saved).toEqual([]);
  });

  it("remembers the file's folder when asked to, and then does not ask again", async () => {
    const { gate, ask, store } = setup({ response: 0, checkboxChecked: true });
    await gate.approve("file:///C:/Music/rain.html");
    expect(store.saved).toEqual(["C:\\Music"]);
    await expect(gate.approve("file:///C:/Music/Forest/birds.html")).resolves.toBe(
      "file:///C:/Music/Forest/birds.html",
    );
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a file in a remembered folder", async () => {
    const { gate, ask } = setup({ response: 1, checkboxChecked: false }, ["C:\\Music"]);
    await expect(gate.approve("file:///C:/Music/rain.html")).resolves.toBe("file:///C:/Music/rain.html");
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.com/",
    "file://fileserver/share/rain.html",
    "file:////fileserver/share/rain.html",
    "file:///C:/Music%5C..%5Csecret.txt",
    "javascript:alert(1)",
  ])("refuses %j without asking", async (url) => {
    const { gate, ask } = setup({ response: 0, checkboxChecked: true });
    await expect(gate.approve(url)).resolves.toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it("says a file that is not there cannot be found, without asking or opening a blank tab (UX finding 7)", async () => {
    const onMissing = vi.fn();
    const ask = vi.fn(async () => ({ response: 0, checkboxChecked: false }));
    const gate = new LocalFileGate({
      folders: new LocalFileFolders(memoryStore(["C:\\Music"]), path.win32),
      ask,
      windowsPaths: true,
      fileExists: (filePath) => filePath !== "C:\\Music\\missing.html",
      onMissing,
    });
    await expect(gate.approve("file:///C:/Music/missing.html")).resolves.toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledWith("C:\\Music\\missing.html");
    await expect(gate.approve("file:///C:/Music/rain.html")).resolves.toBe("file:///C:/Music/rain.html");
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("treats a failed prompt as Cancel", async () => {
    const store = memoryStore();
    const gate = new LocalFileGate({
      folders: new LocalFileFolders(store, path.win32),
      ask: () => Promise.reject(new Error("window closed")),
      windowsPaths: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(gate.approve("file:///C:/Music/rain.html")).resolves.toBeUndefined();
  });
});

describe("localFilePrompt", () => {
  it("defaults to Cancel and offers to remember the folder", () => {
    const prompt = localFilePrompt("C:\\Music\\rain.html", "C:\\Music");
    expect(prompt.buttons[prompt.defaultId]).toBe("Cancel");
    expect(prompt.buttons[prompt.cancelId]).toBe("Cancel");
    expect(prompt.buttons[0]).toBe("Open");
    expect(prompt.checkboxLabel).toContain("C:\\Music");
  });
});
