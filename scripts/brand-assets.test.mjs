// Checks the committed Lyre icons and installer images made by
// scripts/brand/generate_assets.py (see docs/brand.md). Run with `yarn test:scripts`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "src", "assets");
const brand = path.join(assets, "brand");
const read = (...parts) => fs.readFileSync(path.join(assets, ...parts));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("latin1"), "PNG", "not a PNG file");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

/**
 * Sizes listed in an .ico file's directory (0 in the file means 256). Each
 * entry's image must start where the directory says, as a PNG or a bitmap
 * header: git once turned the line endings inside .ico files into LF
 * (.gitattributes did not mark them binary), which breaks exactly that.
 */
function icoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1, "not an icon file");
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const entry = 6 + i * 16;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    assert.ok(offset + length <= buffer.length, "icon image runs past the end of the file");
    const image = buffer.subarray(offset, offset + 8);
    const isPng = image.subarray(1, 4).toString("latin1") === "PNG";
    assert.ok(isPng || image.readUInt32LE(0) === 40, `icon image ${i} is neither PNG nor a bitmap`);
    return buffer[entry] || 256;
  }).sort((a, b) => a - b);
}

/** Element types inside an .icns file. */
function icnsTypes(buffer) {
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "icns", "not an icns file");
  assert.equal(buffer.readUInt32BE(4), buffer.length, "icns length field does not match the file");
  const types = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset + 4);
    assert.ok(length >= 8, "broken icns element");
    types.push(buffer.subarray(offset, offset + 4).toString("latin1"));
    offset += length;
  }
  return types;
}

describe("Lyre brand assets", () => {
  it("keeps the three logo concepts, the chosen logo and the wordmark as SVG", () => {
    for (const name of ["concept-a", "concept-b", "concept-c", "logo", "logo-small", "wordmark", "wordmark-on-light"]) {
      const svg = fs.readFileSync(path.join(brand, `${name}.svg`), "utf8");
      assert.match(svg, /^<svg[^>]+viewBox=/, name);
    }
  });

  it("draws the logo with flat colours only, so it stays sharp at small sizes", () => {
    for (const name of ["logo", "logo-small"]) {
      const svg = fs.readFileSync(path.join(brand, `${name}.svg`), "utf8");
      assert.doesNotMatch(svg, /Gradient|<filter|<image/, name);
    }
  });

  it("uses the logo as the app's own icon.svg", () => {
    assert.equal(read("icon.svg").toString("utf8"), fs.readFileSync(path.join(brand, "logo.svg"), "utf8"));
  });

  it("has a PNG icon at every size the packagers and the window use", () => {
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      assert.deepEqual(pngSize(read("icons", `${size}x${size}.png`)), [size, size], `${size}x${size}.png`);
    }
    assert.deepEqual(pngSize(read("icon.png")), [1024, 1024]);
    assert.deepEqual(pngSize(read("player-icon.png")), [64, 64]);
  });

  it("has Windows icons with every size from 16 to 256", () => {
    for (const name of ["icon.ico", "setup.ico"]) {
      assert.deepEqual(icoSizes(read(name)), [16, 24, 32, 48, 64, 128, 256], name);
    }
  });

  it("has valid macOS icons up to 1024 px", () => {
    for (const name of ["icon.icns", "setup.icns"]) {
      const types = icnsTypes(read(name));
      assert.ok(types.includes("ic10"), `${name} lacks the 1024 px image (has ${types.join(", ")})`);
    }
  });

  it("has an installer animation under 1 MB at 320 x 180 that loops", () => {
    const gif = read("loading.gif");
    assert.equal(gif.subarray(0, 6).toString("latin1"), "GIF89a");
    assert.deepEqual([gif.readUInt16LE(6), gif.readUInt16LE(8)], [320, 180]);
    assert.ok(gif.length < 1024 * 1024, `loading.gif is ${gif.length} bytes`);
    assert.ok(gif.includes(Buffer.from("NETSCAPE2.0")), "loading.gif does not loop");
  });
});
