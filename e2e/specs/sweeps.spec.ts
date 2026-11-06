/**
 * Sweeps: the same four checks on every screen, at the two widths Nik works in (half of a 1920 px screen is 960,
 * a third is 720), in the default theme and in Parchment (the light one):
 *   1. nothing scrolls sideways;
 *   2. no two controls overlap (a control scrolled out of sight inside a scrolling box does not count,
 *      as in design/prototype/tools/shot.js);
 *   3. no button's text is cut off, and no control is cut off at the side by the box it sits in, even once scrolled
 *      into view (BUG-14: the Library's "Clear all" was pushed half out of the Filters box on wide windows; a check
 *      of each button's own text could not see it, and no sweep had a filter on);
 *   4. axe-core 4.14.0 finds no WCAG 2.2 A or AA failure.
 */
import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { knownAxeIssues, knownLayoutIssue, notLyre, openRoute, type Theme } from "./support/target";

// Injected with page.evaluate: the app's Lyre page has a content policy that refuses added script tags.
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const AXE_SOURCE = fs.readFileSync(AXE_PATH, "utf8");
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
  {
    // BUG-14: with a filter on, the Filters box has a summary, a count and "Clear all" in its header.
    name: "Library with a filter on",
    owner: "library",
    route: "library",
    prepare: async (page) => {
      const filters = page.getByRole("region", { name: "Filters", exact: true });
      const toggle = filters.getByRole("button", { name: "Filters", exact: true });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await filters.getByRole("group", { name: "Mood" }).getByRole("button", { name: /^Grief/ }).click();
      await expect(filters.getByRole("button", { name: "Clear all" })).toBeVisible();
    },
  },
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
  {
    // Round 6, part 2 (SHW-7): a scene unfolded in Live's scene list, with its music, ambience and pad boards.
    name: "Live with a scene unfolded",
    owner: "round 6",
    route: "live",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Scene 3: The abbey ruins", exact: true }).click();
      await expect(page.getByRole("list", { name: "The abbey ruins: music in play order" })).toBeVisible();
    },
  },
  { name: "Outputs", owner: "outputs", route: "outputs" },
  // Round 6, part 2 (OUT-8): Settings in Lyre, with the Add a bot stepper's second step showing.
  { name: "Settings", owner: "settings", route: "settings" },
  {
    name: "Add a bot, step 2",
    owner: "settings",
    route: "settings",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add a bot" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Or make the invite by hand" }).click();
    },
  },
  { name: "Look and feel", owner: "look", route: "look" },
  // Round 5 (design/prototype/ROUND5.md): the three new screens, with their tables and choices showing.
  {
    name: "Back up, move or share, with a file open",
    owner: "library-files",
    route: "backup",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Choose a file…" }).click();
    },
  },
  { name: "What came across from Kenku FM", owner: "library-files", route: "moved" },
  {
    name: "Find missing files, after looking in a folder",
    owner: "library-files",
    route: "relink",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Look there" }).click();
    },
  },
];

const BOTH: Theme[] = ["default", "parchment"];
const SIZES: { width: number; height: number; themes: Theme[] }[] = [
  // The half and third of a 1920 screen Nik works in: both themes.
  { width: 960, height: 1000, themes: BOTH },
  { width: 720, height: 900, themes: BOTH },
  // Full screen: default theme.
  { width: 1280, height: 800, themes: ["default"] },
  { width: 1920, height: 1080, themes: ["default"] },
  { width: 2560, height: 1440, themes: ["default"] },
];
const THEMES: { label: string; theme: Theme }[] = [
  { label: "default theme", theme: "default" },
  { label: "Parchment theme", theme: "parchment" },
];

test("the axe-core in use is version 4.14.0", () => {
  expect(JSON.parse(fs.readFileSync(path.join(path.dirname(AXE_PATH), "package.json"), "utf8")).version).toBe(AXE_VERSION);
});

/** The layout checks: sideways scroll, overlapping controls, cut-off button text, controls cut off at the side. */
async function layoutProblems(page: Page) {
  const ignore = notLyre();
  return page.evaluate((ignore) => {
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
          const name = (e: Element) => (e.getAttribute("aria-label") || e.textContent?.trim() || e.getAttribute("title") || e.tagName).trim().slice(0, 30);
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
          // BUG-14: each control, scrolled into view, must show its whole width, and getting it into view must not
          // need a box that a person cannot scroll (overflow hidden or clip: a script can scroll it, a person cannot).
          // The Library's "Clear all" sat half outside the Filters box, which clips; scrolling it into view slid the
          // whole box sideways instead. A box drawn as its children only (display: contents) clips nothing. Each
          // control's boxes are put back after it, so the other checks see the screen as it was.
          const clips = (cs: CSSStyleDeclaration, axis: "X" | "Y") => cs.display !== "contents" && /(hidden|clip)/.test(axis === "X" ? cs.overflowX : cs.overflowY);
          const shownWidth = (e: Element) => {
            const r = e.getBoundingClientRect();
            let l = Math.max(r.left, 0);
            let rt = Math.min(r.right, window.innerWidth);
            for (let p = e.parentElement; p; p = p.parentElement) {
              const cs = getComputedStyle(p);
              if (cs.display === "contents" || !/(auto|scroll|hidden|clip)/.test(cs.overflowX)) continue;
              const q = p.getBoundingClientRect();
              l = Math.max(l, q.left);
              rt = Math.min(rt, q.right);
            }
            return rt - l;
          };
          const cut: string[] = [];
          for (const e of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"))) {
            if (skip(e) || e.offsetParent === null || getComputedStyle(e).visibility === "hidden") continue;
            const before = e.getBoundingClientRect();
            if (before.width < 4 || before.height < 4) continue;
            const boxes: [Element, number, number][] = [[document.scrollingElement ?? document.documentElement, window.scrollX, window.scrollY]];
            for (let p: Element | null = e.parentElement; p; p = p.parentElement) boxes.push([p, p.scrollLeft, p.scrollTop]);
            e.scrollIntoView({ block: "nearest", inline: "nearest" });
            const width = e.getBoundingClientRect().width;
            const shown = shownWidth(e);
            const forced = boxes.some(([p, left, top]) => {
              if (p === document.scrollingElement) return false;
              const cs = getComputedStyle(p);
              return (clips(cs, "X") && Math.abs(p.scrollLeft - left) > 1) || (clips(cs, "Y") && Math.abs(p.scrollTop - top) > 1);
            });
            if (shown < width - 2 || forced) cut.push(`${name(e)} (${forced ? "only reached by sliding a box that does not scroll" : `${Math.max(0, Math.round(shown))} of ${Math.round(width)} px shown`})`);
            for (const [p, left, top] of boxes) {
              p.scrollLeft = left;
              p.scrollTop = top;
            }
          }
          return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, overlaps, clipped, cut };
  }, ignore);
}

/** axe-core 4.14.0 with the WCAG 2.2 A and AA tags; returns one line per failing rule. */
async function axeProblems(page: Page): Promise<string[]> {
  const ignore = notLyre();
        await page.evaluate(AXE_SOURCE);
        return page.evaluate(
          async ({ tags, ignore }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const axe = (window as any).axe;
            const run = await axe.run({ include: [["body"]], exclude: ignore.map((s) => [s]) }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return run.violations.map((v: any) => `${v.id}: ${v.nodes.length} element(s), e.g. ${v.nodes[0].target.join(" ")}`);
          },
          { tags: TAGS, ignore },
        );
}

for (const screen of SCREENS) {
  for (const size of SIZES) {
    for (const { label, theme } of THEMES.filter((t) => size.themes.includes(t.theme))) {
      test(`${screen.name} at ${size.width}×${size.height} in the ${label}: no sideways scroll, no overlapping or cut-off controls, no accessibility failures`, async ({ page }) => {
        expectFailureUntilBuilt(screen.owner);
        await page.setViewportSize(size);
        await openRoute(page, screen.route, { theme });
        await screen.prepare?.(page, { playing: true });
        await page.waitForTimeout(300);
        const layout = await layoutProblems(page);
        expect.soft(layout.sideways, "the page scrolls sideways").toBe(false);
        expect.soft(layout.overlaps, "controls overlap").toEqual([]);
        expect.soft(layout.clipped, "button text is cut off").toEqual([]);
        if (layout.cut.length && knownLayoutIssue(screen.name, size.width, "cut")) {
          test.info().annotations.push({ type: "known prototype issue", description: `cut off: ${layout.cut.join("; ")}` });
        } else {
          expect.soft(layout.cut, "controls cut off at the side, even when scrolled into view").toEqual([]);
        }
        const results = await axeProblems(page);
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

// Responsive sweeps. The prototype changes layout at these widths of the app (see the container queries in
// design/prototype/src/views/*.css, layoutFor() in live.js and the rail in core.js): 760 (campaign session rows),
// 820 (Live: one column below, two from here), 900 (campaigns two columns, pad board stacked, narrow Live strip),
// 1100 (the menu rail folds to icons), 1180 (Outputs two columns), 1200 (Live three columns, campaigns three).
const BREAKPOINTS = [760, 820, 900, 1100, 1180, 1200];
const WIDTHS = Array.from(
  new Set([
    ...Array.from({ length: 25 }, (_, i) => 600 + i * 80), // 600 … 2520
    2560,
    ...BREAKPOINTS.flatMap((b) => [b - 1, b, b + 1]),
  ]),
).sort((a, b) => a - b);

/** How many columns of boxes the screen shows, counted from where its top-level boxes start. */
async function columnCount(page: Page, what: "regions" | "articles" | "outputs"): Promise<number> {
  if (what === "outputs") {
    // Outputs: rooms on the left and the list of voice channels on the right (2), or the channels below the rooms (1).
    return page.evaluate(() => {
      const left = (e: Element | null) => e?.getBoundingClientRect().left ?? 0;
      const rooms = left(document.querySelector("main [role=region]:not([aria-label='All voice channels']), main section[aria-label]:not([aria-label='All voice channels'])"));
      const chans = left(document.querySelector("main [aria-label='All voice channels']"));
      return Math.abs(rooms - chans) > 24 ? 2 : 1;
    });
  }
  return page.evaluate((what) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>(what === "articles" ? "main article" : "main [role=region], main section[aria-label]"));
    const top = all.filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 40 && !e.parentElement?.closest(what === "articles" ? "article" : "[role=region], section[aria-label]"));
    const xs: number[] = [];
    for (const e of top) {
      const x = e.getBoundingClientRect().left;
      if (!xs.some((v) => Math.abs(v - x) < 24)) xs.push(x);
    }
    return xs.length;
  }, what);
}

/** What the design says about the number of columns at a width (undefined: the design does not say). */
const COLUMNS: Record<string, { what: "regions" | "articles" | "outputs"; expected: (w: number) => number; edges: number[] }> = {
  "Live, standby": { what: "regions", expected: (w) => (w >= 1200 ? 3 : w >= 820 ? 2 : 1), edges: [820, 1200] },
  Campaigns: { what: "articles", expected: (w) => (w >= 1200 ? 3 : w >= 900 ? 2 : 1), edges: [900, 1200] },
  Outputs: { what: "outputs", expected: (w) => (w >= 1180 ? 2 : 1), edges: [1180] },
  "A pad board": { what: "regions", expected: (w) => (w > 900 ? 2 : 1), edges: [900, 901] },
};

for (const screen of SCREENS) {
  test(`${screen.name}: resized from 600 to 2560 px wide, nothing scrolls sideways, overlaps or is cut off${COLUMNS[screen.name] ? ", and the columns change where the design says" : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    expectFailureUntilBuilt(screen.owner);
    await page.setViewportSize({ width: WIDTHS[0], height: 1000 });
    await openRoute(page, screen.route);
    await screen.prepare?.(page, { playing: false });
    const found: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(60);
      const l = await layoutProblems(page);
      if (l.sideways) {
        if (knownLayoutIssue(screen.name, width, "sideways")) test.info().annotations.push({ type: "known prototype issue", description: `${width}: scrolls sideways` });
        else found.push(`${width}: scrolls sideways`);
      }
      if (l.overlaps.length) found.push(`${width}: overlap ${l.overlaps.slice(0, 3).join("; ")}`);
      if (l.clipped.length) found.push(`${width}: cut-off text ${l.clipped.slice(0, 3).join("; ")}`);
      if (l.cut.length) {
        if (knownLayoutIssue(screen.name, width, "cut")) test.info().annotations.push({ type: "known prototype issue", description: `${width}: cut off ${l.cut.join("; ")}` });
        else found.push(`${width}: cut off at the side ${l.cut.slice(0, 3).join("; ")}`);
      }
      const rule = COLUMNS[screen.name];
      if (rule) {
        const w = await page.evaluate(() => document.documentElement.clientWidth);
        // Exactly on a breakpoint the app's own width (a pixel less than the window) decides; only check either side.
        // The screen re-lays itself out a moment after the window changes: give it up to a second.
        let n = rule.edges.includes(w) ? rule.expected(w) : await columnCount(page, rule.what);
        for (let i = 0; i < 20 && n !== rule.expected(w); i++) {
          await page.waitForTimeout(50);
          n = await columnCount(page, rule.what);
        }
        if (n !== rule.expected(w)) found.push(`${width}: ${n} columns, the design says ${rule.expected(w)}`);
      }
    }
    expect(found).toEqual([]);
  });
}

// A short window (1280×600): the page scrolls, so every control can be brought into view and is not covered.
for (const screen of SCREENS) {
  test(`${screen.name}: in a short window (1280×600) the page scrolls to every control`, async ({ page }) => {
    expectFailureUntilBuilt(screen.owner);
    await page.setViewportSize({ width: 1280, height: 600 });
    await openRoute(page, screen.route);
    await screen.prepare?.(page, { playing: false });
    const ignore = notLyre();
    const unreachable = await page.evaluate((ignore) => {
      const bad: string[] = [];
      const controls = Array.from(document.querySelectorAll<HTMLElement>("main button, main a[href], main input, main select, main textarea"));
      for (const e of controls) {
        if (e.offsetParent === null || ignore.some((s) => e.closest(s)) || (e as HTMLButtonElement).disabled) continue;
        const r0 = e.getBoundingClientRect();
        if (r0.width === 0 || r0.height === 0 || getComputedStyle(e).visibility === "hidden") continue;
        e.scrollIntoView({ block: "center", inline: "nearest" });
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const inView = r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
        if (!inView || !hit || !(e === hit || e.contains(hit) || hit.contains(e))) bad.push((e.getAttribute("aria-label") ?? e.textContent ?? e.tagName).trim().slice(0, 40));
      }
      return bad.slice(0, 8);
    }, ignore);
    expect(unreachable, "controls that cannot be scrolled into view").toEqual([]);
  });
}
