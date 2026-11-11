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
import type { Stream } from "./support/built";
import { expect, expectFailureUntilBuilt, expectFailureUntilScreenBuilt, test } from "./support/test";
import { isWindowMaximised, knownAxeIssues, knownLayoutIssue, lyreIsTheWholeWindow, notLyre, openRoute, pageFillsTheWindow, windowButtonsBox, type Box, type Theme } from "./support/target";

// Injected with page.evaluate: the app's Lyre page has a content policy that refuses added script tags.
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const AXE_SOURCE = fs.readFileSync(AXE_PATH, "utf8");
const AXE_VERSION = "4.14.0";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** `owner` is the spec file (screen) that has to be built for the sweep to be required in the app; `streams`, for a
 *  screen that is new or redesigned in round 6 or 7, names the 0.5.0 streams that build it (BUILD-LIST.md lists the
 *  sweep under the first). */
type Screen = { name: string; route: string; owner: string; streams?: [Stream, ...Stream[]]; prepare?: (page: Page, options: { playing: boolean }) => Promise<void> };

/** Mark a sweep "expected to fail" in the app until its screen (and the streams that build the screen) is built. */
function expectFailureUntilSweptScreenBuilt(screen: Screen): void {
  expectFailureUntilScreenBuilt(screen.owner);
  if (screen.streams) expectFailureUntilBuilt(...screen.streams);
}

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
    // Round 6, part 3: the session's and the campaign's pads and playlists unfolded too. Its second room is found in
    // round 6's one On air box, which the app's Live (0.4.1's) does not have yet.
    name: "Live with a second room and the pads open",
    owner: "live",
    streams: ["live"],
    route: "live",
    prepare: async (page, { playing }) => {
      await page.getByRole("button", { name: "Add a room" }).click();
      await page.getByRole("menuitemradio", { name: /Side room/ }).click();
      await expect(page.getByRole("region", { name: "On air", exact: true }).getByRole("group", { name: "Side room", exact: true })).toContainText(/Silent|Nobody there/);
      // Sound on air redraws the screen every moment, so the keyboard sweep (which marks elements) leaves it silent.
      if (playing) await page.getByRole("button", { name: /^Start: / }).click();
      for (const name of ["Session pads", "Campaign playlists", "Campaign pads"]) {
        const toggle = page.getByRole("region", { name, exact: true }).getByRole("button", { expanded: false }).first();
        if (await toggle.isVisible()) await toggle.click();
      }
    },
  },
  {
    // Round 6, part 2 (SHW-7): a scene unfolded in Live's scene list, with its music, ambience and pad boards.
    name: "Live with a scene unfolded",
    owner: "live",
    streams: ["live"],
    route: "live",
    prepare: async (page) => {
      // Narrow, the list shows only Now and Next until "Show all 6 scenes".
      const all = page.getByRole("button", { name: "Show all 6 scenes" });
      if (await all.isVisible()) await all.click();
      await page.getByRole("button", { name: "Scene 3: The abbey ruins", exact: true }).click();
      await expect(page.getByRole("list", { name: "The abbey ruins: music in play order" })).toBeVisible();
    },
  },
  { name: "Outputs", owner: "outputs", route: "outputs" },
  // Round 6, part 2 (OUT-8): Settings in Lyre.
  { name: "Settings", owner: "settings", streams: ["rooms-settings"], route: "settings" },
  { name: "Look and feel", owner: "look", route: "look" },
  // Round 7 (DAT-10): the Tags screen.
  { name: "Tags", owner: "tags", streams: ["prep"], route: "tags" },
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
      // "After looking": what Lyre found is on the screen (under load the answer can come after the sweep has begun).
      await expect(page.getByRole("button", { name: /^Relink \d+ files?$/ })).toBeVisible();
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

/* 0.5.1 (ROUND8.md, part 2): a campaign's own theme always shows on its page, its sessions and its Live, so Parchment as
   the base theme no longer reaches them. For the Parchment sweep of those screens The Sunken Crown takes Parchment as
   its own theme first, on its page, so the light theme is still checked there. */
const OWN_THEME = /^(campaign\/crown|session\/crown\/|live)/;
async function crownInParchment(page: Page): Promise<void> {
  await openRoute(page, "campaign/crown", { theme: "parchment" });
  await page.getByRole("main").getByRole("combobox", { name: "Theme" }).selectOption({ label: "Parchment" });
}

for (const screen of SCREENS) {
  for (const size of SIZES) {
    for (const { label, theme } of THEMES.filter((t) => size.themes.includes(t.theme))) {
      test(`${screen.name} at ${size.width}×${size.height} in the ${label}: no sideways scroll, no overlapping or cut-off controls, no accessibility failures`, async ({ page }) => {
        expectFailureUntilSweptScreenBuilt(screen);
        await page.setViewportSize(size);
        if (theme === "parchment" && OWN_THEME.test(screen.route)) await crownInParchment(page);
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
    expectFailureUntilSweptScreenBuilt(screen);
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
    expectFailureUntilSweptScreenBuilt(screen);
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
    expectFailureUntilSweptScreenBuilt(screen);
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

// UX-6 (design round 7): no hidden text. Wherever a name is cut short (an ellipsis, or two lines and then an ellipsis),
// its full text is on hover (a title on it or on the row it is in), and keyboard focus on it shows the same text.
// The app's built screens meet it already, apart from these (app run of 7 Nov 2026), which stay marked for the shell
// (UX-6 is one kit behaviour) and the stream that builds their screen; the screens the app does not have are marked by
// their screen and streams as well.
const UX6_NOT_MET_YET: Record<string, { widths: number[]; streams: [Stream, ...Stream[]] }> = {
  Library: { widths: [1920], streams: ["shell"] },
  "Library with a track open": { widths: [960, 1920], streams: ["shell"] },
  "A dynamic playlist": { widths: [960], streams: ["shell"] },
  "Live with a second room and the pads open": { widths: [960, 1920], streams: ["shell", "live"] },
  "Live with a scene unfolded": { widths: [960, 1920], streams: ["shell", "live"] },
  Settings: { widths: [960, 1920], streams: ["shell", "rooms-settings"] },
  "Look and feel": { widths: [960, 1920], streams: ["shell"] },
  Tags: { widths: [960, 1920], streams: ["shell", "prep"] },
};
for (const screen of SCREENS) {
  for (const size of [{ width: 960, height: 1000 }, { width: 1920, height: 1080 }]) {
    test(`${screen.name} at ${size.width}×${size.height}: every name cut short has its full text on hover`, async ({ page }) => {
      expectFailureUntilSweptScreenBuilt(screen);
      const notYet = UX6_NOT_MET_YET[screen.name];
      if (notYet?.widths.includes(size.width)) expectFailureUntilBuilt(...notYet.streams);
      await page.setViewportSize(size);
      await openRoute(page, screen.route);
      await screen.prepare?.(page, { playing: true });
      await page.waitForTimeout(300);
      const hidden = await page.evaluate((ignore) => {
        const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
        const out: string[] = [];
        for (const e of Array.from(document.querySelectorAll<HTMLElement>("main *, [role=region][aria-label='Now playing'] *"))) {
          if (!e.offsetParent || ignore.some((s) => e.closest(s)) || e.closest(".sr-only")) continue;
          const cs = getComputedStyle(e);
          const clamp = cs.getPropertyValue("-webkit-line-clamp");
          const cutX = cs.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1;
          const cutY = clamp !== "" && clamp !== "none" && e.scrollHeight > e.clientHeight + 1;
          if (!cutX && !cutY) continue;
          const text = norm(e.textContent ?? "");
          if (text.length < 3) continue;
          let ok = false;
          for (let n: HTMLElement | null = e; n && n.tagName !== "MAIN"; n = n.parentElement) {
            const t = norm(n.getAttribute("title") ?? "");
            if (t && t.includes(text.slice(0, 40))) { ok = true; break; }
          }
          if (!ok) out.push(text.slice(0, 60));
        }
        return out.slice(0, 10);
      }, notLyre());
      expect(hidden, "names cut short with no way to read the rest").toEqual([]);
    });
  }
}

test("UX-6: keyboard focus on a name cut short shows its full text", async ({ page }) => {
  expectFailureUntilScreenBuilt("library");
  expectFailureUntilBuilt("shell");
  await page.setViewportSize({ width: 960, height: 1000 });
  await openRoute(page, "library");
  const rowEl = page.getByRole("grid", { name: "Tracks" }).getByRole("row", { name: /^Select Very short heroic moment/ });
  await rowEl.focus();
  await expect(page.getByRole("tooltip")).toContainText("Cool vibe! (Don't loop, use as a sting, cue something up after)");
});

/* ---------- 0.5.1: Lyre is the whole window (design/prototype/ROUND8.md, FND-16) ----------
   No Kenku FM tab bar and no Lyre Player tab: the window's own buttons (minimise, maximise, close) sit at the top right
   of Lyre's top strip, drawn by Windows through Electron's titleBarOverlay (the prototype shows a stand-in of the same
   size, about 138×36 px). Nothing of Lyre's is under them. The empty parts of the top strip and of Live's strip drag the
   window, and double-clicking them maximises it; every control in the strips stays a control. Checked at half a 1920
   screen (960 px) and at half a 1920 screen with text at 200 % (960×1040, the window buttons stay their size). */

/** Look and feel › Display › Text size at 200 % (it stays for the rest of the test). */
async function textAt200(page: Page): Promise<void> {
  await openRoute(page, "look");
  const size = page.getByRole("region", { name: "Display", exact: true }).getByRole("slider", { name: "Text size" });
  await size.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(size).toHaveAttribute("aria-valuetext", "200 percent");
}

/** What of Lyre is under the window's buttons: any control, or anything with text of its own, that shows there. */
async function underWindowButtons(page: Page, box: Box): Promise<string[]> {
  return page.evaluate(
    ({ box, ignore }) => {
      const hits = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < box.x + box.width - 0.5 && r.right > box.x + 0.5 && r.top < box.y + box.height - 0.5 && r.bottom > box.y + 0.5;
      const control = "button, a[href], input, select, textarea, [role=button], [role=link], [role=switch], [role=radio], [role=combobox], [tabindex]:not([tabindex='-1'])";
      const out: string[] = [];
      for (const e of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        if (e.closest("[data-window-buttons]") || ignore.some((s) => e.closest(s)) || e.closest(".sr-only")) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
        const ownText = Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        if (!e.matches(control) && !ownText) continue;
        // Only what shows: a box scrolled out of sight inside a scrolling box does not count.
        let r = e.getBoundingClientRect();
        for (let p = e.parentElement; p; p = p.parentElement) {
          if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflow)) continue;
          const q = p.getBoundingClientRect();
          r = new DOMRect(Math.max(r.left, q.left), Math.max(r.top, q.top), Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)), Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)));
        }
        if (hits(r)) out.push(`${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40)}"`);
      }
      return out.slice(0, 8);
    },
    { box, ignore: notLyre() },
  );
}

/** The top strip of the screen: the bar Back sits in (both the prototype and the app call it .viewhead, Live's .lv-top). */
const topStrip = (page: Page) => page.getByRole("main").locator(".viewhead, .lv-top").first();

/** How the strip drags: the strip itself, and every control or text with hover text inside it that would not. */
async function dragProblems(page: Page): Promise<{ strip: string; dragging: string[] }> {
  return topStrip(page).evaluate((strip) => {
    const region = (e: Element) => getComputedStyle(e).getPropertyValue("app-region") || getComputedStyle(e).getPropertyValue("-webkit-app-region");
    const control = "button, a[href], input, select, textarea, label, [role=button], [role=link], [role=switch], [role=radio], [role=combobox], [tabindex]:not([tabindex='-1']), [title]";
    const dragging = Array.from(strip.querySelectorAll<HTMLElement>(control))
      .filter((e) => e.offsetParent !== null && region(e) !== "no-drag")
      .map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || "").trim().slice(0, 40)}"`);
    return { strip: region(strip), dragging: dragging.slice(0, 8) };
  });
}

for (const screen of SCREENS) {
  for (const size of [{ width: 960, height: 1000, at200: false }, { width: 960, height: 1040, at200: true }]) {
    const label = size.at200 ? "at 960×1040 with text at 200 %" : "at 960×1000";
    test(`${screen.name} ${label}: nothing is under the window's buttons; the strip's empty parts drag the window, its controls do not`, async ({ page }) => {
      expectFailureUntilSweptScreenBuilt(screen);
      expectFailureUntilBuilt("retire");
      await page.setViewportSize({ width: size.width, height: size.height });
      if (size.at200) await textAt200(page);
      await openRoute(page, screen.route);
      await screen.prepare?.(page, { playing: true });
      await page.waitForTimeout(300);
      expect.soft(await underWindowButtons(page, await windowButtonsBox(page)), "under the window's buttons").toEqual([]);
      const drag = await dragProblems(page);
      expect.soft(drag.strip, "the top strip drags the window").toBe("drag");
      expect.soft(drag.dragging, "controls in the top strip that would drag the window").toEqual([]);
    });
  }
}

test.describe("0.5.1: Lyre is the whole window", () => {
  test.beforeEach(() => expectFailureUntilBuilt("retire"));

  test("one window, Lyre's page alone: no Kenku FM tab bar, no Lyre Player tab, no website tabs", async ({ page }) => {
    expectFailureUntilScreenBuilt("campaigns");
    await openRoute(page, "campaigns");
    expect(await lyreIsTheWholeWindow(page)).toBe(true);
    await expect(page.getByRole("tab", { name: /Lyre Player|Kenku/ })).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("the window's buttons sit at the top right of the top strip, about 138×36 px, and cannot be reached with Tab", async ({ page }) => {
    expectFailureUntilScreenBuilt("campaigns");
    await openRoute(page, "campaign/crown");
    const box = await windowButtonsBox(page);
    const strip = (await topStrip(page).boundingBox())!;
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.abs(box.x + box.width - width)).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(strip.y + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(strip.y + strip.height + 1);
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.width).toBeLessThanOrEqual(160);
    expect(box.height).toBeGreaterThanOrEqual(28);
    expect(box.height).toBeLessThanOrEqual(44);
    // Tab from the strip's first control to its last never stops under the buttons.
    await page.getByRole("button", { name: /^Back/ }).focus();
    for (let i = 0; i < 12; i++) {
      const r = await page.evaluate(() => document.activeElement?.getBoundingClientRect().toJSON() as DOMRect);
      expect(r.left < box.x + box.width && r.right > box.x && r.top < box.y + box.height && r.bottom > box.y, "focus under the window's buttons").toBe(false);
      await page.keyboard.press("Tab");
    }
  });

  test("double-clicking an empty part of the top strip maximises the window; again puts it back", async ({ page }) => {
    expectFailureUntilScreenBuilt("library");
    await openRoute(page, "library");
    const box = await windowButtonsBox(page);
    expect(await isWindowMaximised(page)).toBe(false);
    // Just left of the window's buttons: the space the strip keeps free for them.
    await page.mouse.dblclick(box.x - 6, box.y + 8);
    await expect.poll(() => isWindowMaximised(page)).toBe(true);
    await page.mouse.dblclick(box.x - 6, box.y + 8);
    await expect.poll(() => isWindowMaximised(page)).toBe(false);
  });

  test("Live's strip drags the window too, and double-clicking its empty part maximises it", async ({ page }) => {
    expectFailureUntilScreenBuilt("live");
    await openRoute(page, "live");
    const drag = await dragProblems(page);
    expect(drag.strip).toBe("drag");
    expect(drag.dragging).toEqual([]);
    const box = await windowButtonsBox(page);
    await page.mouse.dblclick(box.x - 6, box.y + 8);
    await expect.poll(() => isWindowMaximised(page)).toBe(true);
  });

  test("at half a 1920 screen with text at 200 %, the trail is still cut in the middle, clear of the window's buttons", async ({ page }) => {
    expectFailureUntilScreenBuilt("session-planner");
    await page.setViewportSize({ width: 960, height: 1040 });
    await textAt200(page);
    await openRoute(page, "session/crown/s14");
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(nav).toHaveAttribute("title", "Campaigns › The Sunken Crown › Session 14: The Drowned Abbey");
    await expect(nav.getByText("…")).toBeVisible();
    await expect(nav.getByRole("link", { name: "The Sunken Crown" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Campaigns" })).toBeHidden();
    expect(await underWindowButtons(page, await windowButtonsBox(page))).toEqual([]);
    await page.getByRole("link", { name: "The Sunken Crown" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The Sunken Crown");
  });

  test("with Help open, Close help is clear of the window's buttons, at 960 px and with text at 200 %", async ({ page }) => {
    expectFailureUntilScreenBuilt("help");
    for (const at200 of [false, true]) {
      await page.setViewportSize({ width: 960, height: at200 ? 1040 : 1000 });
      if (at200) await textAt200(page);
      await openRoute(page, "library");
      await page.keyboard.press("F1");
      const help = page.getByRole("complementary", { name: "Help", exact: true });
      await expect(help).toBeVisible();
      expect(await underWindowButtons(page, await windowButtonsBox(page))).toEqual([]);
      await help.getByRole("button", { name: "Close help" }).click();
      await expect(help).toHaveCount(0);
    }
  });

  // Nik's 0.5.0 test: "When fully maximised the bottom of the app pushes past the top of my bottom aligned taskbar" and
  // "The right hand side of the window goes beyond the edge of the screen". The page now fills exactly the window's
  // content area, at a 1920 screen's work area with a bottom taskbar and at a small laptop's.
  for (const size of [{ width: 1920, height: 1040 }, { width: 1280, height: 680 }]) {
    test(`at ${size.width}×${size.height} the page fills exactly the window: nothing runs past its right or bottom edge`, async ({ page }) => {
      expectFailureUntilScreenBuilt("campaigns");
      await page.setViewportSize(size);
      await openRoute(page, "campaign/crown");
      const fill = await pageFillsTheWindow(page);
      expect(fill.page, "the page's size is the window's content size").toEqual(fill.content);
      expect(fill.content).toEqual([size.width, size.height]);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const app = document.getElementById("app")?.getBoundingClientRect();
        const bar = document.querySelector(".onairbar")?.getBoundingClientRect();
        return {
          sideways: root.scrollWidth - root.clientWidth,
          down: root.scrollHeight - root.clientHeight,
          appRight: Math.round((app?.right ?? 0) - window.innerWidth),
          appBottom: Math.round((app?.bottom ?? 0) - window.innerHeight),
          barBottom: bar ? Math.round(bar.bottom - window.innerHeight) : 0,
        };
      });
      expect({ sideways: overflow.sideways, down: overflow.down }).toEqual({ sideways: 0, down: 0 });
      for (const edge of ["appRight", "appBottom", "barBottom"] as const) expect(overflow[edge], edge).toBeLessThanOrEqual(0);
    });
  }

  test("a sheet as tall as the window (Add a bot, text at 200 %) keeps its controls clear of the window's buttons", async ({ page }) => {
    expectFailureUntilScreenBuilt("settings");
    await page.setViewportSize({ width: 960, height: 1040 });
    await textAt200(page);
    await openRoute(page, "settings");
    await page.getByRole("region", { name: "Discord bots", exact: true }).getByRole("button", { name: "Add a bot" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await underWindowButtons(page, await windowButtonsBox(page))).toEqual([]);
  });
});

/* ---------- 0.5.1: Lyre's page fits the window's content area (design/prototype/ROUND8.md, part 2) ----------
   Nik, 11 Nov: "When fully maximised the bottom of the app pushes past the top of my bottom aligned taskbar." and "The
   right hand side of the window goes beyond the edge of the screen, rather than stopping at it." Nothing of Lyre's page
   is wider or taller than the window's content area: the page does not scroll, and the menu, the screen and the Now
   playing bar end inside it. Checked on every sweep screen, with a campaign playlist on air (so the Now playing bar
   shows), at a maximised 1920 window above a taskbar (1920×1040) and at a small laptop's (1280×680). */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate((ignore) => {
    const out: string[] = [];
    const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    for (const [what, e] of [["the page", document.documentElement], ["the body", document.body]] as const) {
      if (e.scrollWidth > w + 1) out.push(`${what} is ${e.scrollWidth - w} px wider than the window`);
      if (e.scrollHeight > h + 1) out.push(`${what} is ${e.scrollHeight - h} px taller than the window`);
    }
    const parts = Array.from(document.querySelectorAll<HTMLElement>("main, nav, [role=region][aria-label='Now playing'], body > *")).filter((e) => !ignore.some((s) => e.closest(s)));
    for (const e of parts) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.position === "fixed" && cs.visibility === "hidden") continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = e.getAttribute("aria-label") || e.id || e.tagName.toLowerCase();
      if (r.right > w + 1) out.push(`${name} ends ${Math.round(r.right - w)} px past the right edge`);
      if (r.bottom > h + 1) out.push(`${name} ends ${Math.round(r.bottom - h)} px below the bottom edge`);
    }
    return out;
  }, notLyre());
}

test.describe("0.5.1: Lyre's page fits the window", () => {
  test.beforeEach(() => expectFailureUntilBuilt("retire"));
  for (const size of [{ width: 1920, height: 1040 }, { width: 1280, height: 680 }]) {
    test(`every screen fits a ${size.width}×${size.height} window exactly: nothing wider or taller than it`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize(size);
      await openRoute(page, "campaign/crown");
      await page.getByRole("region", { name: "Campaign playlists", exact: true }).getByRole("button", { name: "Play on air: The Company themes" }).click();
      await expect(page.getByRole("region", { name: "Now playing" })).toBeVisible();
      for (const screen of SCREENS) {
        await openRoute(page, screen.route);
        // The campaign playlist plays on, so no scene is started (a screen's "Start" is then not offered).
        await screen.prepare?.(page, { playing: false });
        await page.waitForTimeout(150);
        expect.soft(await overflow(page), `${screen.name} at ${size.width}×${size.height}`).toEqual([]);
      }
    });
  }
});

/* 0.5.1 (ROUND8.md, part 3). Nik, 11 Nov 20:33: "Let's move the live tab to the top of the left side bar". */
test("0.5.1: Live is the first entry of the menu", async ({ page }) => {
  expectFailureUntilBuilt("feat");
  await openRoute(page, "campaigns");
  const names = await page.getByRole("navigation", { name: "Lyre" }).getByRole("link").allTextContents();
  expect(names[0]).toMatch(/^\s*Live/);
  expect(names[1]).toMatch(/^\s*Campaigns/);
});
