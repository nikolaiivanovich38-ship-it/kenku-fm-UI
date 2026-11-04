import path from "path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_APP_DATA_DIR_ENV,
  findRendererFolders,
  localAppDataFolder,
  MAX_BACKGROUND_ENTRIES,
  parseBackgroundMap,
} from "./kenkuInstall";

/**
 * Text in the shape of Kenku FM 1.5.5's player bundle
 * (`.webpack/renderer/player_window/index.js`), cut down to two pictures.
 */
const KENKU_155_BUNDLE =
  'var a={"./autumn.jpg":78209,"./tavern.jpg":5512};function o(e){var t=s(e);return r(t)}' +
  ',78209:(e,t,r)=>{"use strict";e.exports=r.p+"8141457778d3d8eb6c2b.jpg"}' +
  ',5512:(e,t,r)=>{"use strict";e.exports=r.p+"0a1b2c3d4e5f60718293.jpg"}' +
  ',99:(e,t,r)=>{"use strict";e.exports=r.p+"ffffffffffffffffffff.png"}';

describe("parseBackgroundMap", () => {
  it("reads the picture names and their hashed files from Kenku FM 1.5.5's bundle", () => {
    expect(parseBackgroundMap(KENKU_155_BUNDLE)).toEqual([
      { name: "autumn", file: "8141457778d3d8eb6c2b.jpg" },
      { name: "tavern", file: "0a1b2c3d4e5f60718293.jpg" },
    ]);
  });

  it("copes with whitespace, other variable names and function syntax", () => {
    const text = [
      'var map = {\n  "./sky.png" : 12,\n  "./town.webp": 34,\n  "./lines.svg":56 };',
      '12: (module, __unused_exports, __webpack_require__) => {\n  "use strict";\n  module.exports = __webpack_require__.p + "aa11.png";\n}',
      "34:function(a,b,c){'use strict';a.exports=c.p+'bb22.webp'}",
      '56:($,_,n)=>{$.exports=n.p+"cc33.svg"}',
    ].join(",\n");
    expect(parseBackgroundMap(text)).toEqual([
      { name: "sky", file: "aa11.png" },
      { name: "town", file: "bb22.webp" },
      { name: "lines", file: "cc33.svg" },
    ]);
  });

  it("ignores entries that are not pictures", () => {
    const text =
      '{"./index.ts":1,"./notes.txt":2,"./stars.jpeg":3}' +
      ',1:(e,t,r)=>{"use strict";e.exports=r.p+"x.ts"}' +
      ',2:(e,t,r)=>{"use strict";e.exports=r.p+"y.txt"}' +
      ',3:(e,t,r)=>{"use strict";e.exports=r.p+"z.jpeg"}';
    expect(parseBackgroundMap(text)).toEqual([{ name: "stars", file: "z.jpeg" }]);
  });

  it("ignores a picture whose file is not a picture", () => {
    const text = '{"./stars.jpg":3},3:(e,t,r)=>{"use strict";e.exports=r.p+"z.js"}';
    expect(parseBackgroundMap(text)).toEqual([]);
  });

  it("refuses names and files that leave the folder", () => {
    const text =
      '{"./../evil.jpg":1,"./sub/dir.jpg":2,"./ok.jpg":3,"./back\\\\slash.jpg":4}' +
      ',1:(e,t,r)=>{"use strict";e.exports=r.p+"a.jpg"}' +
      ',2:(e,t,r)=>{"use strict";e.exports=r.p+"b.jpg"}' +
      ',3:(e,t,r)=>{"use strict";e.exports=r.p+"../../../Windows/c.jpg"}' +
      ',4:(e,t,r)=>{"use strict";e.exports=r.p+"d.jpg"}';
    expect(parseBackgroundMap(text)).toEqual([]);
  });

  it("skips a name whose module is missing and keeps the first of duplicate names", () => {
    const text =
      '{"./sky.jpg":1,"./sky.png":2,"./war.jpg":3}' +
      ',1:(e,t,r)=>{"use strict";e.exports=r.p+"a.jpg"}' +
      ',2:(e,t,r)=>{"use strict";e.exports=r.p+"b.png"}';
    expect(parseBackgroundMap(text)).toEqual([{ name: "sky", file: "a.jpg" }]);
  });

  it("does not take a module id that only ends with the wanted digits", () => {
    const text =
      '{"./sky.jpg":12}' +
      ',512:(e,t,r)=>{"use strict";e.exports=r.p+"wrong.jpg"}' +
      ',12:(e,t,r)=>{"use strict";e.exports=r.p+"right.jpg"}';
    expect(parseBackgroundMap(text)).toEqual([{ name: "sky", file: "right.jpg" }]);
  });

  it("returns nothing for text without a picture map", () => {
    expect(parseBackgroundMap("")).toEqual([]);
    expect(parseBackgroundMap("console.log('hello')")).toEqual([]);
  });
});

/** A fake folder tree: folder path -> entry names. */
function fakeTree(tree: Record<string, string[]>) {
  return async (dir: string) => tree[path.normalize(dir)] ?? [];
}

const LAD = path.normalize("/Users/nik/AppData/Local");
const p = (...parts: string[]) => path.join(LAD, ...parts);
const renderer = (...parts: string[]) => path.join(LAD, ...parts, ".webpack", "renderer");

describe("findRendererFolders", () => {
  it("finds the live Kenku FM install and ignores the uninstalled one (as on the owner's PC)", async () => {
    const listDir = fakeTree({
      [LAD]: ["Discord", "kenku-fm", "kenku-fm-win32-x64", "Temp"],
      [p("kenku-fm")]: [".dead", "app-1.5.5"],
      [p("kenku-fm", "app-1.5.5")]: ["squirrel.exe"],
      [p("kenku-fm-win32-x64")]: ["app-1.5.5", "packages", "Update.exe"],
      [p("kenku-fm-win32-x64", "app-1.5.5")]: ["kenku-fm.exe", "resources"],
      [p("kenku-fm-win32-x64", "app-1.5.5", "resources")]: ["app"],
    });
    expect(await findRendererFolders(LAD, listDir)).toEqual([
      renderer("kenku-fm-win32-x64", "app-1.5.5", "resources", "app"),
    ]);
  });

  it("lists newer versions first, compares versions as numbers, and supports app.asar", async () => {
    const listDir = fakeTree({
      [LAD]: ["kenku-fm"],
      [p("kenku-fm")]: ["app-1.5.5", "app-1.10.0", "app-1.4.0", "app-x", "Update.exe"],
      [p("kenku-fm", "app-1.5.5", "resources")]: ["app"],
      [p("kenku-fm", "app-1.10.0", "resources")]: ["app.asar"],
      [p("kenku-fm", "app-1.4.0", "resources")]: ["app", "app.asar"],
    });
    expect(await findRendererFolders(LAD, listDir)).toEqual([
      renderer("kenku-fm", "app-1.10.0", "resources", "app.asar"),
      renderer("kenku-fm", "app-1.5.5", "resources", "app"),
      // Electron itself loads the "app" folder before "app.asar".
      renderer("kenku-fm", "app-1.4.0", "resources", "app"),
      renderer("kenku-fm", "app-1.4.0", "resources", "app.asar"),
    ]);
  });

  it("finds nothing when Kenku FM is not installed or the folder cannot be read", async () => {
    expect(await findRendererFolders(LAD, fakeTree({ [LAD]: ["Discord", "kenku-fmx"] }))).toEqual([]);
    expect(
      await findRendererFolders(LAD, async () => {
        throw new Error("EACCES");
      }),
    ).toEqual([]);
  });
});

describe("localAppDataFolder", () => {
  const winEnv = { LOCALAPPDATA: "C:\\Users\\nik\\AppData\\Local" };

  it("uses %LOCALAPPDATA% on Windows", () => {
    expect(localAppDataFolder(winEnv, "win32", { isTestBuild: false, testUserData: false })).toBe(
      "C:\\Users\\nik\\AppData\\Local",
    );
  });

  it("looks nowhere on other systems or without %LOCALAPPDATA%", () => {
    expect(localAppDataFolder(winEnv, "linux", { isTestBuild: false, testUserData: false })).toBeNull();
    expect(localAppDataFolder({}, "win32", { isTestBuild: false, testUserData: false })).toBeNull();
    expect(localAppDataFolder({ LOCALAPPDATA: "relative" }, "win32", { isTestBuild: false, testUserData: false })).toBeNull();
  });

  it("honours the test folder only in test builds", () => {
    const env = { ...winEnv, [LOCAL_APP_DATA_DIR_ENV]: "/tmp/fake-local" };
    expect(localAppDataFolder(env, "linux", { isTestBuild: true, testUserData: true })).toBe(path.normalize("/tmp/fake-local"));
    expect(localAppDataFolder(env, "win32", { isTestBuild: false, testUserData: false })).toBe(winEnv.LOCALAPPDATA);
    expect(localAppDataFolder({ [LOCAL_APP_DATA_DIR_ENV]: "relative" }, "linux", { isTestBuild: true, testUserData: false })).toBeNull();
  });

  it("never reads the real computer's Kenku FM during a test run with a throw-away data folder", () => {
    expect(localAppDataFolder(winEnv, "win32", { isTestBuild: true, testUserData: true })).toBeNull();
  });
});

describe("parseBackgroundMap on a hostile bundle (0.1.1 review)", () => {
  it("stays fast when a module-like pattern repeats without closing", () => {
    const bundle = '{"./a.jpg":1}' + "1:(".repeat(240_000);
    const start = performance.now();
    expect(parseBackgroundMap(bundle)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("stays fast with thousands of map entries that have no module", () => {
    const entries = Array.from({ length: 2_000 }, (_, i) => `"./x${i}.jpg":${i + 1}`).join(",");
    const bundle = `{${entries}}` + "x".repeat(4 * 1024 * 1024);
    const start = performance.now();
    expect(parseBackgroundMap(bundle)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it(`returns at most ${"MAX_BACKGROUND_ENTRIES"} pictures`, () => {
    const count = MAX_BACKGROUND_ENTRIES + 50;
    const map = Array.from({ length: count }, (_, i) => `"./p${i}.jpg":${i + 1}`).join(",");
    const modules = Array.from(
      { length: count },
      (_, i) => `,${i + 1}:(e,t,r)=>{"use strict";e.exports=r.p+"f${i}.jpg"}`,
    ).join("");
    expect(parseBackgroundMap(`{${map}}${modules}`)).toHaveLength(MAX_BACKGROUND_ENTRIES);
  });
});
