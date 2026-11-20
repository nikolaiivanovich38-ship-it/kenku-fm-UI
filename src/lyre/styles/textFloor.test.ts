/**
 * Round 10 (design/prototype/ROUND10.md K, "12 px floor for text"): no CSS of the Lyre page sets text under 12 px, in
 * pixels or as a font size token. A quick companion to the sweep that reads every screen as drawn in all five themes
 * (e2e/specs/sweeps.spec.ts "no text under 12 px"), which also catches sizes made smaller by other means.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const FLOOR_PX = 12;
const LYRE = path.resolve(__dirname, "..");

function cssFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? cssFiles(full) : e.name.endsWith(".css") ? [full] : [];
  });
}

describe("the 12 px floor for text (ROUND10.md K)", () => {
  it("no font size under 12 px in any of the Lyre page's CSS files", () => {
    const small: string[] = [];
    for (const file of cssFiles(LYRE)) {
      const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/(?:font-size\s*:\s*|font\s*:[^;{}]*?\s)(\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) < FLOOR_PX) small.push(`${path.relative(LYRE, file)}: ${m[0].trim()}`);
      }
    }
    expect(small).toEqual([]);
  });

  it("the font size tokens are 12 px or more", () => {
    const tokens = fs.readFileSync(path.join(LYRE, "styles", "tokens.css"), "utf8");
    const sizes = [...tokens.matchAll(/--(fs[\w-]*):\s*(\d+(?:\.\d+)?)px/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter(([, px]) => px < FLOOR_PX)).toEqual([]);
  });
});
