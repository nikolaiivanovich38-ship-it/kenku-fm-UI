import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { backgroundsFrom, randomBackgroundFrom } from "./backgroundList";

/**
 * The 23 names Kenku FM stored on playlists and soundboards. Cue Desk ships a
 * picture of its own under each, so libraries brought over from Kenku FM keep
 * a picture without any change to their data. "butterflys" is spelled as
 * Kenku FM spelled it.
 */
const KENKU_NAMES = [
  "autumn", "beach", "butterflys", "castle", "cathedral", "dragon", "haunted", "lines",
  "mountain", "sand", "skulls", "sky", "smoke", "sparks", "stars", "tavern", "texture",
  "town", "tree", "veins", "volcano", "war", "winter",
];

/** A stand-in for webpack's require.context over this folder. */
function fakeContext(files: Record<string, unknown>) {
  const context = (key: string) => files[key];
  context.keys = () => Object.keys(files);
  return context;
}

describe("built-in background pictures", () => {
  it("are named after their files, with 'blank' always offered", () => {
    const list = backgroundsFrom(
      fakeContext({ "./tavern.jpg": "abc123.jpg", "./butterflys.jpg": { default: "def456.jpg" } }),
      "blank.png",
    );
    expect(list).toEqual({ tavern: "abc123.jpg", butterflys: "def456.jpg", blank: "blank.png" });
  });

  it("keep only 'blank' when the folder has no pictures", () => {
    expect(backgroundsFrom(fakeContext({}), "blank.png")).toEqual({ blank: "blank.png" });
  });

  it("skip entries that are not a picture address", () => {
    const list = backgroundsFrom(fakeContext({ "./odd.jpg": 42, "./empty.jpg": "" }), "blank.png");
    expect(list).toEqual({ blank: "blank.png" });
  });

  it("choose a real picture for new playlists, and blank only when there is none", () => {
    const list = { tavern: "a.jpg", stars: "b.jpg", blank: "blank.png" };
    for (let i = 0; i < 50; i++) {
      expect(["tavern", "stars"]).toContain(randomBackgroundFrom(list));
    }
    expect(randomBackgroundFrom({ blank: "blank.png" })).toBe("blank");
  });

  it("ship one JPEG for each of Kenku FM's 23 names, small enough for the installer", () => {
    const files = fs.readdirSync(__dirname).filter((file) => /\.(png|jpe?g|svg|webp)$/i.test(file));
    expect(files.sort()).toEqual(KENKU_NAMES.map((name) => `${name}.jpg`));
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(__dirname, file));
      expect(bytes.subarray(0, 3).toString("hex"), file).toBe("ffd8ff");
      expect(bytes.length, file).toBeLessThanOrEqual(250 * 1024);
    }
  });

  it("say where the pictures come from and under which licence", () => {
    const note = fs.readFileSync(path.join(__dirname, "LICENSE.md"), "utf8");
    expect(note).toMatch(/original/i);
    expect(note).toMatch(/GPL-3\.0/);
    expect(note).toContain("scripts/backgrounds");
  });
});
