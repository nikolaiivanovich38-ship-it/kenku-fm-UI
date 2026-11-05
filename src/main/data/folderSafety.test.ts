/**
 * Folders the library refuses to add or watch (security review 5): a whole drive, the system's folders, the
 * profile folder itself and its program data, and network shares typed as \\server paths, which the data layer
 * already refuses for the library itself.
 */
import { describe, expect, it } from "vitest";

import { openLibrary } from "./library";
import { addRoot } from "./repo/roots";
import { unsafeFolderReason } from "./paths";
import { makeTempFolder } from "./test/helpers";

const windowsEnv = { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", ProgramData: "C:\\ProgramData", USERPROFILE: "C:\\Users\\Nik", APPDATA: "C:\\Users\\Nik\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Nik\\AppData\\Local" };
const reason = (folder: string) => unsafeFolderReason(folder, { env: windowsEnv, home: "/home/nik" });

describe("unsafeFolderReason", () => {
  it("refuses a whole drive or the whole disk", () => {
    for (const folder of ["C:\\", "d:/", "E:", "/"]) expect(reason(folder), folder).toMatch(/whole drive/);
  });

  it("refuses network shares", () => {
    for (const folder of ["\\\\server\\share", "//server/share/Music", "\\\\?\\UNC\\server\\share"]) expect(reason(folder), folder).toMatch(/network/);
  });

  it("refuses the system's folders and anything in them", () => {
    for (const folder of ["C:\\Windows", "c:\\windows\\System32", "C:\\Program Files\\Lyre", "C:\\Program Files (x86)", "C:\\ProgramData\\x", "/etc", "/usr/share/sounds", "/proc/1", "/System"]) {
      expect(reason(folder), folder).toMatch(/system/);
    }
  });

  it("refuses the profile folder itself, the folder of all profiles, and program data in the profile", () => {
    for (const folder of ["C:\\Users\\Nik", "C:\\Users", "C:\\Users\\Nik\\AppData\\Roaming\\lyre", "/home/nik", "/home"]) expect(reason(folder), folder).toMatch(/profile|user/);
  });

  it("allows ordinary folders, inside the profile too", () => {
    for (const folder of ["C:\\Users\\Nik\\Music", "H:\\Audio\\Scores", "/home/nik/Music", "/tmp/lyre-x", "/media/usb/Sfx"]) expect(reason(folder), folder).toBeNull();
  });
});

describe("addRoot refuses unsafe folders (security review 5)", () => {
  it("refuses a drive root and a network share", () => {
    const temp = makeTempFolder();
    const library = openLibrary({ folder: temp.folder });
    expect(() => addRoot(library.store, { name: "All", path: "/" })).toThrow(/whole drive/);
    expect(() => addRoot(library.store, { name: "Share", path: "\\\\server\\share" })).toThrow(/network/);
    library.close();
    temp.cleanup();
  });
});
