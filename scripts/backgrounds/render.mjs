#!/usr/bin/env node
/**
 * Paints Cue Desk's built-in background pictures (paint.mjs) in Playwright's
 * Chromium and saves them as JPEG files in src/player/backgrounds.
 *
 *   node scripts/backgrounds/render.mjs                  # all 23 pictures
 *   node scripts/backgrounds/render.mjs tavern stars     # only these
 *   node scripts/backgrounds/render.mjs --sheet out.png  # also a contact sheet
 *   node scripts/backgrounds/render.mjs --check          # compare with the saved files, write nothing
 *
 * The pictures are seeded, so the same Chromium build gives the same files.
 * Another Chromium version may differ in a few pixels; --check says which.
 * Fails when a picture is larger than 250 KB or white text on it would be
 * hard to read (contrast under 4.5:1, the WCAG AA level for normal text).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { NAMES } from "./paint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const outDir = path.join(repo, "src", "player", "backgrounds");
const QUALITY = 0.82;
const MAX_BYTES = 250 * 1024;
/** WCAG AA for normal-size text; see `measure` in paint.mjs. */
const MIN_CONTRAST = 4.5;

/** Playwright's own Chromium, or the newest one in its browser folder when versions differ. */
async function launchChromium() {
  const args = ["--disable-gpu", "--force-color-profile=srgb"];
  try {
    return await chromium.launch({ args });
  } catch (error) {
    const roots = [
      process.env.PLAYWRIGHT_BROWSERS_PATH,
      path.join(os.homedir(), ".cache", "ms-playwright"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    ].filter(Boolean);
    const candidates = roots.flatMap((root) => {
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root)
        .filter((dir) => /^chromium-\d+$/.test(dir))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
        .flatMap((dir) =>
          ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-win64/chrome.exe", "chrome-win/chrome.exe"].map(
            (exe) => path.join(root, dir, exe),
          ),
        );
    });
    const found = candidates.find((file) => fs.existsSync(file));
    if (!found) throw error;
    return chromium.launch({ args, executablePath: found });
  }
}

function contactSheetHtml(pictures) {
  const tiles = pictures
    .map(
      ({ name, dataUrl }) => `
      <figure>
        <img src="${dataUrl}" alt="">
        <div class="shade"></div>
        <figcaption>${name}</figcaption>
      </figure>`,
    )
    .join("");
  // Each tile is shown as the player's card shows it: cropped, under the same dark gradient.
  return `<!doctype html><html><body style="margin:0;background:#121212;font:600 22px sans-serif">
    <style>
      main { display:grid; grid-template-columns:repeat(5, 320px); gap:12px; padding:12px; }
      figure { position:relative; margin:0; width:320px; height:200px; overflow:hidden; border-radius:12px; }
      img { width:100%; height:100%; object-fit:cover; }
      .shade { position:absolute; inset:0; background:linear-gradient(0deg, #00000088 30%, #ffffff44 100%); }
      figcaption { position:absolute; left:14px; bottom:12px; color:#fff; }
    </style><main>${tiles}</main></body></html>`;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const sheetIndex = argv.indexOf("--sheet");
  const sheet = sheetIndex >= 0 ? path.resolve(argv[sheetIndex + 1]) : null;
  const wanted = argv.filter((arg, i) => !arg.startsWith("--") && !(sheetIndex >= 0 && i === sheetIndex + 1));
  const unknown = wanted.filter((name) => !NAMES.includes(name));
  if (unknown.length > 0) throw new Error(`Unknown picture name: ${unknown.join(", ")}`);
  const names = wanted.length > 0 ? wanted : NAMES;

  const browser = await launchChromium();
  const problems = [];
  const pictures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ type: "module", content: fs.readFileSync(path.join(here, "paint.mjs"), "utf8") });
    await page.waitForFunction(() => globalThis.cueDeskBackgrounds !== undefined);

    for (const name of names) {
      const started = Date.now();
      const { dataUrl, brightness, contrast } = await page.evaluate(
        ([n, q]) => globalThis.cueDeskBackgrounds.render(n, q),
        [name, QUALITY],
      );
      const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
      const file = path.join(outDir, `${name}.jpg`);
      pictures.push({ name, dataUrl });
      const kb = (bytes.length / 1024).toFixed(0);
      console.log(
        `${name.padEnd(11)} ${kb.padStart(4)} KB  white text contrast: title ${contrast.title}:1, ` +
          `tracks ${contrast.tracks}:1  mean brightness ${brightness.all}  (${Date.now() - started} ms)`,
      );
      if (bytes.length > MAX_BYTES) problems.push(`${name}: ${kb} KB is over ${MAX_BYTES / 1024} KB`);
      for (const [where, ratio] of Object.entries(contrast)) {
        if (ratio < MIN_CONTRAST) problems.push(`${name}: white ${where} text contrast ${ratio}:1 is under ${MIN_CONTRAST}:1`);
      }
      if (check) {
        const saved = fs.existsSync(file) ? fs.readFileSync(file) : null;
        if (!saved || !saved.equals(bytes)) problems.push(`${name}: differs from ${path.relative(repo, file)}`);
      } else {
        fs.writeFileSync(file, bytes);
      }
    }

    if (sheet) {
      await page.setViewportSize({ width: 5 * 332 + 12, height: 800 });
      await page.setContent(contactSheetHtml(pictures));
      await page.screenshot({ path: sheet, fullPage: true });
      console.log(`Contact sheet: ${sheet}`);
    }
  } finally {
    await browser.close();
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}

await main();
