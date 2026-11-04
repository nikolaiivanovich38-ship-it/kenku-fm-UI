import fs from "fs";
import os from "os";
import path from "path";
import { createPackage } from "@electron/asar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AsarArchive } from "./asarArchive";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "asar-archive-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function archiveOf(files: Record<string, string>): Promise<string> {
  const src = path.join(root, "src");
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fs.writeFileSync(path.join(src, name), content);
  }
  const archive = path.join(root, "app.asar");
  await createPackage(src, archive);
  return archive;
}

describe("AsarArchive", () => {
  it("reads files from an archive made by @electron/asar", async () => {
    const archive = await archiveOf({
      ".webpack/renderer/a.png": "PICTURE",
      ".webpack/renderer/player_window/index.js": "bundle text",
    });
    const asar = await AsarArchive.open(fs, archive);
    const picture = asar.locate(".webpack/renderer/a.png");
    expect(picture.kind).toBe("packed");
    if (picture.kind !== "packed") return;
    expect((await asar.read(picture, 100)).toString()).toBe("PICTURE");
    const bundle = asar.locate(".webpack\\renderer\\player_window\\index.js");
    if (bundle.kind !== "packed") throw new Error("bundle not found");
    expect((await asar.read(bundle, 100)).toString()).toBe("bundle text");
  });

  it("never reads more than the limit", async () => {
    const archive = await archiveOf({ "big.jpg": "0123456789" });
    const asar = await AsarArchive.open(fs, archive);
    const file = asar.locate("big.jpg");
    if (file.kind !== "packed") throw new Error("not found");
    expect((await asar.read(file, 4)).toString()).toBe("0123");
  });

  it("reports missing files, folders and paths that try to leave the archive", async () => {
    const archive = await archiveOf({ "dir/a.jpg": "x", "constructor/b.jpg": "y" });
    const asar = await AsarArchive.open(fs, archive);
    for (const inner of ["dir/none.jpg", "dir", "../app.asar", "dir/../dir/a.jpg", "toString"]) {
      expect(asar.locate(inner).kind, inner).toBe("missing");
    }
    expect(asar.locate("constructor/b.jpg").kind).toBe("packed");
  });

  it("refuses a file that is not an archive", async () => {
    const notArchive = path.join(root, "app.asar");
    fs.writeFileSync(notArchive, "just text, long enough to have a header");
    await expect(AsarArchive.open(fs, notArchive)).rejects.toThrow(/not an app.asar/);
  });

  it("refuses an index that claims to be huge", async () => {
    const head = Buffer.alloc(16);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(0xfffffff0, 4);
    head.writeUInt32LE(0xfffffff0, 8);
    head.writeUInt32LE(0xffffffe0, 12);
    const file = path.join(root, "app.asar");
    fs.writeFileSync(file, head);
    await expect(AsarArchive.open(fs, file)).rejects.toThrow(/too large/);
  });
});
