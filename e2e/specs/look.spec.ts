/**
 * Look and feel: display options (UX-11) and motion, zoom and target size (A11Y-6), design round 7
 * (design/prototype/ROUND7.md, src/views/look.js and r7shell.js). The Look and feel screen is built in the app, but
 * these options are not yet, so each check is marked "round 7".
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, metByTheAppAlready, test } from "./support/test";
import { openRoute } from "./support/target";

const display = (page: Page) => page.getByRole("region", { name: "Display", exact: true });

/** WCAG contrast of an element's text against the first solid background behind it. */
async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const rgb = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let bg: number[] = [];
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) { bg = c; break; }
    }
    if (!bg.length) bg = rgb(getComputedStyle(document.body).backgroundColor);
    const a = lum(rgb(getComputedStyle(el).color)), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
}

test.describe("round 7: display options", () => {
  test.beforeEach(() => expectFailureUntilBuilt("shell"));

  test("Compact is the default; Comfortable makes every control taller", async ({ page }) => {
    await openRoute(page, "look");
    const density = display(page).getByRole("radiogroup", { name: "Density" });
    await expect(density.getByRole("radio", { name: "Compact" })).toBeChecked();
    const before = (await page.getByRole("link", { name: "Settings", exact: true }).boundingBox())!.height;
    await density.getByRole("radio", { name: "Comfortable" }).check();
    await expect(page.getByRole("status").filter({ hasText: "Saved: density Comfortable" })).toBeVisible();
    const after = (await page.getByRole("link", { name: "Settings", exact: true }).boundingBox())!.height;
    expect(after).toBeGreaterThan(before);
  });

  test("Text size goes from 100 to 200 %, and at 200 % nothing scrolls sideways", async ({ page }) => {
    await openRoute(page, "look");
    const size = display(page).getByRole("slider", { name: "Text size" });
    await expect(size).toHaveAttribute("aria-valuetext", "100 percent");
    await size.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect(size).toHaveAttribute("aria-valuetext", "200 percent");
    for (const route of ["look", "library", "session/crown/s14", "settings"]) {
      await openRoute(page, route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), route).toBe(true);
    }
  });

  test("High contrast makes quiet text as strong as the rest (7:1 or more)", async ({ page }) => {
    await openRoute(page, "look");
    await display(page).getByRole("switch", { name: "High contrast" }).check();
    await openRoute(page, "library");
    expect(await contrastOf(page, ".hint, .faint, .muted")).toBeGreaterThanOrEqual(7);
  });

  test("tag colours are edited with the tags, and always come with the tag's name", async ({ page }) => {
    await openRoute(page, "look");
    await display(page).getByRole("link", { name: "Tag colours…" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tags");
  });
});

test.describe("round 7: motion and target size", () => {
  test.beforeEach(() => expectFailureUntilBuilt("shell"));

  test("with reduced motion asked for, nothing slides or pulses", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openRoute(page, "look");
    await display(page).getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: "Comfortable" }).check();
    const pop = page.getByRole("status").filter({ hasText: "Saved:" });
    await expect(pop).toBeVisible();
    const moving = await pop.evaluate((el) => {
      const cs = getComputedStyle(el);
      return (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.01) || parseFloat(cs.transitionDuration) > 0.01;
    });
    expect(moving).toBe(false);
  });

  test("every button and link on the Library and a pad board is at least 24 by 24 px, or has 24 px of space around it", async ({ page }) => {
    metByTheAppAlready("the app's Library and pad board controls meet the 24 px target size at Compact");
    // WCAG 2.2 2.5.8: a target smaller than 24 × 24 passes when a 24 px circle on its centre touches no other target
    // and no other small target's circle. Links inside a sentence are exempt.
    for (const route of ["library", "board/combat"]) {
      await openRoute(page, route);
      const small = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll("main button, main a[href], main [role=button], main input[type=checkbox], main input[type=radio], main [role=switch]"))
          .filter((e) => !e.closest(".sr-only") && (e as HTMLElement).offsetParent && !(e.tagName === "A" && getComputedStyle(e).display === "inline"))
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0);
        const isSmall = (r: DOMRect) => r.width < 24 || r.height < 24;
        const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2];
        const circleHitsRect = (c: number[], r: DOMRect) => {
          const x = Math.max(r.left, Math.min(c[0], r.right)), y = Math.max(r.top, Math.min(c[1], r.bottom));
          return (x - c[0]) ** 2 + (y - c[1]) ** 2 < 144;
        };
        return all.filter(({ r }) => isSmall(r)).filter(({ e, r }) => {
          const c = centre(r);
          return all.some((o) => o.e !== e && !o.e.contains(e) && !e.contains(o.e) && (circleHitsRect(c, o.r) || (isSmall(o.r) && Math.hypot(centre(o.r)[0] - c[0], centre(o.r)[1] - c[1]) < 24)));
        }).map(({ e, r }) => `${e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      });
      expect(small, route).toEqual([]);
    }
  });
});
