/**
 * Round 10 (design/prototype/ROUND10.md, Themes; the prototype's tools/check-contrast.js, applied to the app's own
 * tokens): every theme's text and status colours keep 4.5:1, a filled button keeps 3:1 against the page, focus keeps
 * 3:1, and no theme's buttons are within 30° of On air's red (Nik, 18 Nov: Hearth's orange became iron teal,
 * Parchment's oxblood ink blue), so the red On air light is the one red on the screen.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

type Palette = Record<string, string>;

function themesOf(css: string): Record<string, Palette> {
  const blocks: Record<string, Palette> = {};
  const re = /(?:\[data-theme="(\w+)"\]|:root, \[data-theme="(\w+)"\])\s*\{([^}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const theme = m[1] || m[2];
    blocks[theme] = {};
    for (const d of m[3].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) blocks[theme][d[1]] = d[2];
  }
  return blocks;
}

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hue = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
  const x = Math.max(r, g, b);
  const d = x - Math.min(r, g, b);
  if (d === 0) return 0;
  if (x === r) return (60 * ((g - b) / d) + 360) % 360;
  return x === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
};
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(d, 360 - d);
};

/** Every failure in one theme, in words. */
function contrastProblems(v: Palette): string[] {
  const out: string[] = [];
  const text = ["ink", "ink-2", "ink-3", "accent-text", "onair", "ok", "warn", "danger", "music", "amb", "fx", "preview", "mood", "motif", "scenetype"];
  for (const k of text) {
    for (const s of ["bg", "surface", "surface-2", "surface-3"]) {
      // Status and lane colours are not used as text on --surface-3 (selected rows use --ink).
      if (s === "surface-3" && !k.startsWith("ink")) continue;
      const r = ratio(v[k], v[s]);
      if (r < 4.5) out.push(`${k} on ${s} ${r.toFixed(2)}`);
    }
  }
  for (const fill of ["accent", "accent-hover"]) if (ratio(v["accent-ink"], v[fill]) < 4.5) out.push(`accent-ink on ${fill}`);
  for (const s of ["bg", "surface", "surface-2"]) if (ratio(v.accent, v[s]) < 3) out.push(`a button's fill on ${s}`);
  if (hueGap(v.accent, v.onair) < 30) out.push(`the accent is ${hueGap(v.accent, v.onair).toFixed(0)}° from On air's red`);
  for (const s of ["surface", "surface-2"]) if (ratio(v.focus, v[s]) < 3) out.push(`focus on ${s}`);
  return out;
}

const THEMES = themesOf(fs.readFileSync(path.join(__dirname, "tokens.css"), "utf8"));

describe("the five themes' colours (round 10)", () => {
  it("has the five themes", () => {
    expect(Object.keys(THEMES).sort()).toEqual(["candle", "elysium", "fern", "hearth", "parchment"]);
  });

  it.each(Object.keys(THEMES))("%s: text 4.5:1, buttons 3:1 against the page, focus 3:1, buttons away from On air's red", (theme) => {
    expect(contrastProblems(THEMES[theme])).toEqual([]);
  });

  it("Hearth and Iron's buttons are iron teal and Parchment's ink blue (Nik, 18 Nov)", () => {
    expect(THEMES.hearth.accent).toBe("#6cc3b2");
    expect(THEMES.parchment.accent).toBe("#1f3d70");
  });

  it("On air is the same red family in all five themes", () => {
    for (const v of Object.values(THEMES)) expect(hue(v.onair) < 15 || hue(v.onair) > 345).toBe(true);
  });
});
