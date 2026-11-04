/**
 * Sweeps: the same four checks on every screen, at the two widths Nik works in (half of a 1920 px screen is 960,
 * a third is 720), in the default theme and in Parchment (the light one):
 *   1. nothing scrolls sideways;
 *   2. no two controls overlap (a control scrolled out of sight inside a scrolling box does not count,
 *      as in design/prototype/tools/shot.js);
 *   3. no button's text is cut off;
 *   4. axe-core 4.14.0 finds no WCAG 2.2 A or AA failure.
 */
import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { knownAxeIssues, notLyre, openRoute, type Theme } from "./support/target";

const AXE_SOURCE = require.resolve("axe-core/axe.min.js");
const AXE_VERSION = "4.14.0";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** `owner` is the spec file (screen) that has to be built for the sweep to be required in the app. */
type Screen = { name: string; route: string; owner: string; prepare?: (page: Page, options: { playing: boolean }) => Promise<void> };

const SCREENS: Screen[] = [
  { name: "Campaigns", owner: "campaigns", route: "campaigns" },
  { name: "One campaign", owner: "campaigns", route: "campaign/crown" },
  {
    name: "Session planner with a scene open",
    owner: "session-planner",
    route: "session/crown/s14",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Scene 3: The abbey ruins" }).click();
    },
  },
  { name: "Library", owner: "library", route: "library" },
  { name: "Library with a track open", owner: "library", route: "library/t44" },
  { name: "Playlists", owner: "playlists", route: "playlists" },
  { name: "A manual playlist", owner: "playlists", route: "playlist/p-abbess" },
  { name: "A dynamic playlist", owner: "playlists", route: "playlist/p-abbey-eerie" },
  { name: "Pad boards", owner: "pad-boards", route: "boards" },
  { name: "A pad board", owner: "pad-boards", route: "board/weather" },
  { name: "Audio profile", owner: "audio-profile", route: "profile/t13" },
  { name: "Live, standby", owner: "live", route: "live" },
  {
    name: "Live with a second room and the pads open",
    owner: "live",
    route: "live",
    prepare: async (page, { playing }) => {
      await page.getByRole("button", { name: "Add a room" }).click();
      await page.getByRole("menuitemradio", { name: /Side room/ }).click();
      await expect(page.getByRole("region", { name: "On air: Side room" })).toContainText("Silent");
      // Sound on air redraws the screen every moment, so the keyboard sweep (which marks elements) leaves it silent.
      if (playing) await page.getByRole("button", { name: /^Start: / }).click();
      await page.getByRole("region", { name: "Pads", exact: true }).getByRole("button", { name: "Pads", exact: true }).click();
    },
  },
  { name: "Outputs", owner: "outputs", route: "outputs" },
  { name: "Look and feel", owner: "look", route: "look" },
];

const SIZES = [
  { width: 960, height: 1000 },
  { width: 720, height: 900 },
];
const THEMES: { label: string; theme: Theme }[] = [
  { label: "default theme", theme: "default" },
  { label: "Parchment theme", theme: "parchment" },
];

test("the axe-core in use is version 4.14.0", () => {
  expect(JSON.parse(fs.readFileSync(path.join(path.dirname(AXE_SOURCE), "package.json"), "utf8")).version).toBe(AXE_VERSION);
});

for (const screen of SCREENS) {
  for (const size of SIZES) {
    for (const { label, theme } of THEMES) {
      test(`${screen.name} at ${size.width}×${size.height} in the ${label}: no sideways scroll, no overlapping or cut-off controls, no accessibility failures`, async ({ page }) => {
        expectFailureUntilBuilt(screen.owner);
        await page.setViewportSize(size);
        await openRoute(page, screen.route, { theme });
        await screen.prepare?.(page, { playing: true });
        await page.waitForTimeout(300);
        const ignore = notLyre();

        const layout = await page.evaluate((ignore) => {
          const skip = (e: Element) => ignore.some((sel) => e.closest(sel));
          // The visible part of an element: its box cut down by every scrolling or clipping ancestor.
          const visible = (e: Element) => {
            const r = e.getBoundingClientRect();
            let a = { l: r.left, t: r.top, r: r.right, b: r.bottom };
            for (let p = e.parentElement; p; p = p.parentElement) {
              const cs = getComputedStyle(p);
              if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
                const q = p.getBoundingClientRect();
                a = { l: Math.max(a.l, q.left), t: Math.max(a.t, q.top), r: Math.min(a.r, q.right), b: Math.min(a.b, q.bottom) };
              }
            }
            return a;
          };
          const name = (e: Element) => ((e.getAttribute("aria-label") ?? e.textContent ?? e.getAttribute("title") ?? e.tagName).trim().slice(0, 30));
          const controls = Array.from(document.querySelectorAll("button, a[href], input, select, textarea")).filter((e) => {
            if (skip(e)) return false;
            const v = visible(e);
            return v.r - v.l > 0 && v.b - v.t > 0 && getComputedStyle(e).visibility !== "hidden";
          });
          const boxes = controls.map(visible);
          const overlaps: string[] = [];
          for (let i = 0; i < controls.length; i++) {
            for (let j = i + 1; j < controls.length; j++) {
              if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
              const a = boxes[i];
              const b = boxes[j];
              const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
              const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
              if (ox > 2 && oy > 2) overlaps.push(`${name(controls[i])} × ${name(controls[j])}`);
            }
          }
          const clipped = Array.from(document.querySelectorAll("button"))
            .filter((e) => !skip(e) && e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 2)
            .map((e) => (e.textContent ?? "").trim().slice(0, 30));
          return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, overlaps, clipped };
        }, ignore);

        expect.soft(layout.sideways, "the page scrolls sideways").toBe(false);
        expect.soft(layout.overlaps, "controls overlap").toEqual([]);
        expect.soft(layout.clipped, "button text is cut off").toEqual([]);

        await page.addScriptTag({ path: AXE_SOURCE });
        const results: string[] = await page.evaluate(
          async ({ tags, ignore }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const axe = (window as any).axe;
            const run = await axe.run({ include: [["body"]], exclude: ignore.map((s) => [s]) }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return run.violations.map((v: any) => `${v.id}: ${v.nodes.length} element(s), e.g. ${v.nodes[0].target.join(" ")}`);
          },
          { tags: TAGS, ignore },
        );
        const known = knownAxeIssues();
        for (const finding of results.filter((r) => known.some((k) => r.startsWith(`${k}:`)))) {
          test.info().annotations.push({ type: "known prototype issue", description: finding });
        }
        expect.soft(
          results.filter((r) => !known.some((k) => r.startsWith(`${k}:`))),
          "accessibility failures (axe-core 4.14.0, WCAG 2.2 A and AA)",
        ).toEqual([]);
      });
    }
  }
}

// The keyboard sweep: Tab walks through the whole screen and reaches every control that is meant to be tabbed to
// (design/prototype/tools/tab-outputs.js and tab-playlists.js). It runs once per screen at 960×1000.
for (const screen of SCREENS) {
  test(`${screen.name}: Tab reaches every control on the screen and does not get stuck`, async ({ page }) => {
    expectFailureUntilBuilt(screen.owner);
    await openRoute(page, screen.route);
    await screen.prepare?.(page, { playing: false });
    const ignore = notLyre();
    // Start at the top of the screen's own area, as a person arriving on the screen does.
    await page.evaluate(() => {
      const m = document.querySelector("main") as HTMLElement;
      m.tabIndex = -1;
      m.focus();
    });
    let leftMain = false;
    for (let i = 0; i < 600 && !leftMain; i++) {
      await page.keyboard.press("Tab");
      leftMain = await page.evaluate((ignore) => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body || ignore.some((s) => a.closest(s))) return true;
        if (!a.closest("main")) return true;
        a.dataset.tabSeen = "1";
        return false;
      }, ignore);
    }
    expect(leftMain, "Tab got stuck inside the screen").toBe(true);
    const missed = await page.evaluate((ignore) => {
      const sel = "main a[href], main button, main input, main select, main textarea";
      return Array.from(document.querySelectorAll<HTMLElement>(sel))
        .filter((e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null && !e.dataset.tabSeen && e.tabIndex >= 0 && !ignore.some((s) => e.closest(s)))
        // A group of radio buttons is one stop on the Tab path (the arrow keys move inside it).
        .filter((e) => !(e instanceof HTMLInputElement && e.type === "radio" && !e.checked))
        .map((e) => `${e.tagName.toLowerCase()} ${e.getAttribute("aria-label") ?? e.id ?? ""} ${(e.textContent ?? "").trim().slice(0, 40)} ${e.getAttribute("type") ?? ""}`);
    }, ignore);
    expect(missed, "controls Tab never reached").toEqual([]);
  });
}
