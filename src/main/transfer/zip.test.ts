/**
 * DAT-7: the small zip layer under .lyre files. Written entries open in any zip tool's format (stored or deflated,
 * UTF-8 names, CRC-32); reading treats every file as hostile: sizes and counts are capped before anything is read,
 * and a cut-off or altered file is refused, never half read.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { deflateRawSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZipError, openZip, writeZip } from "./zip";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-zip-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (name: string) => path.join(dir, name);

async function sample(name = "a.zip") {
  await writeZip(file(name), [
    { name: "lyre.json", bytes: Buffer.from('{"hello":"Grüße"}'), deflate: true },
    { name: "audio/0001.flac", stream: () => Readable.from([Buffer.from("abc"), Buffer.from("def")]) },
  ]);
  return file(name);
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
  return "opened";
}

describe("writeZip and openZip", () => {
  it("writes deflated and stored entries and reads them back, checking each entry's CRC", async () => {
    const zip = await openZip(await sample());
    try {
      expect(zip.entries.map((e) => [e.name, e.size])).toEqual([["lyre.json", 19], ["audio/0001.flac", 6]]);
      expect((await zip.read("lyre.json", 100)).toString("utf8")).toBe('{"hello":"Grüße"}');
      const out = file("out.flac");
      await zip.copyTo("audio/0001.flac", out);
      expect(fs.readFileSync(out, "utf8")).toBe("abcdef");
    } finally {
      await zip.close();
    }
  });

  it("never leaves a half-written file: the zip is written beside it and moved into place at the end", async () => {
    const target = file("b.zip");
    await expect(
      writeZip(target, [{ name: "x", stream: () => Readable.from((async function* () { yield Buffer.from("a"); throw new Error("disk gone"); })()) }]),
    ).rejects.toThrow("disk gone");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses a file that is not a zip, one cut off part-way, and one whose bytes were changed", async () => {
    fs.writeFileSync(file("notes.lyre"), "just some text, not a zip");
    expect(await codeOf(openZip(file("notes.lyre")))).toBe("not-zip");

    const whole = fs.readFileSync(await sample());
    fs.writeFileSync(file("cut.lyre"), whole.subarray(0, whole.length - 30));
    expect(await codeOf(openZip(file("cut.lyre")))).toBe("damaged");

    const changed = Buffer.from(whole);
    changed[whole.indexOf("abc")] = "x".charCodeAt(0);
    fs.writeFileSync(file("changed.lyre"), changed);
    const zip = await openZip(file("changed.lyre"));
    expect(await codeOf(zip.copyTo("audio/0001.flac", file("x.flac")))).toBe("damaged");
    expect(fs.existsSync(file("x.flac"))).toBe(false);
    await zip.close();
  });

  it("refuses an entry bigger than the caller allows before inflating it (a zip bomb)", async () => {
    const bomb = Buffer.alloc(50_000_000);
    await writeZip(file("bomb.zip"), [{ name: "lyre.json", bytes: bomb, deflate: true }]);
    expect(fs.statSync(file("bomb.zip")).size).toBeLessThan(100_000);
    const zip = await openZip(file("bomb.zip"));
    expect(await codeOf(zip.read("lyre.json", 1_000_000))).toBe("too-big");
    await zip.close();
  });

  it("refuses a lying size: an entry that inflates to more than its header says", async () => {
    // A hand-made zip whose central directory claims 10 bytes for an entry that inflates to 1,000.
    const data = deflateRawSync(Buffer.alloc(1000, 65));
    await writeZip(file("liar.zip"), [{ name: "lyre.json", bytes: Buffer.alloc(10, 65), deflate: true }]);
    const honest = fs.readFileSync(file("liar.zip"));
    const original = deflateRawSync(Buffer.alloc(10, 65));
    const at = honest.indexOf(original);
    const liar = Buffer.concat([honest.subarray(0, at), data, honest.subarray(at + original.length)]);
    // Move the central directory's offset by the difference so the file still parses.
    const eocd = liar.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    liar.writeUInt32LE(liar.readUInt32LE(eocd + 16) + data.length - original.length, eocd + 16);
    const cdAt = liar.readUInt32LE(eocd + 16);
    liar.writeUInt32LE(data.length, cdAt + 20);
    liar.writeUInt32LE(data.length, 18);
    fs.writeFileSync(file("liar.zip"), liar);
    const zip = await openZip(file("liar.zip"));
    expect(await codeOf(zip.read("lyre.json", 100_000))).toBe("damaged");
    await zip.close();
  });

  it("refuses names that would leave a folder, absolute names and too many entries", async () => {
    for (const name of ["../evil.dll", "audio/../../x", "/etc/passwd", "C:\\Windows\\x.dll", "a\\b", ""]) {
      await writeZip(file("n.zip"), [{ name, bytes: Buffer.from("x") }], { allowAnyName: true });
      expect(await codeOf(openZip(file("n.zip"))), name).toBe("unsafe-name");
    }
    await writeZip(file("many.zip"), Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, bytes: Buffer.from("x") })));
    expect(await codeOf(openZip(file("many.zip"), { maxEntries: 20 }))).toBe("too-big");
  });
});
