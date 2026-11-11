/**
 * WP5: steps for the Lyre page, shared by the e2e specs and the acceptance specs' app branch
 * (e2e/specs/support/target.ts). Kept free of the app fixture so both can use it. FND-16 (0.5.1): the Lyre page is
 * the window's own page; there is no Lyre tab to choose any more.
 */
import { expect, type Page } from "@playwright/test";

/** The Lyre page's document title, which is the window's title too. */
export const LYRE_PAGE_TITLE = "Lyre";

/** Where the new interface remembers its look (src/lyre/shell/settings.ts SHELL_SETTINGS_KEY). */
const SHELL_SETTINGS_KEY = "lyre-shell";

/** The Lyre page, found among the app's pages (the hidden capture window, "Audio Capture", may come first). */
async function lyrePage(page: Page): Promise<Page> {
  let lyre: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const candidate of page.context().pages()) {
          if ((await candidate.title().catch(() => "")) === LYRE_PAGE_TITLE) lyre = candidate;
        }
        return Boolean(lyre);
      },
      { message: "the Lyre page", timeout: 30_000 },
    )
    .toBe(true);
  return lyre as Page;
}

/**
 * The Lyre page, once its screen shows. Named for the "Lyre" tab it chose until 0.5.0. FND-8: on a first start the
 * Lyre page shows its tour; it is skipped (and so remembered as seen) unless `keepTour`.
 */
export async function openLyreTab(page: Page, options: { keepTour?: boolean } = {}): Promise<Page> {
  const lyre = await lyrePage(page);
  await lyre.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
  if (!options.keepTour) {
    const skip = lyre.getByRole("dialog", { name: TOUR_NAME }).getByRole("button", { name: "Skip" });
    if (await skip.isVisible()) await skip.click();
  }
  return lyre;
}

/** The tour's popover is named by its step: "Lyre's places 1 of 5". */
const TOUR_NAME = /\d of \d$/;

/**
 * Open the Lyre page at a route ("campaign/crown", "profile/t13/sc:crown:s14:sc3"), in a theme: "default" follows
 * each campaign's own, "parchment" uses Parchment everywhere (as chosen in Look and feel). The page reloads with the
 * remembered theme, so it opens at the route as a person would find it.
 */
export async function openLyreRoute(page: Page, route: string, theme: "default" | "parchment" = "default"): Promise<Page> {
  const lyre = await openLyreTab(page);
  await lyre.evaluate(
    ([key, path, choice]) => {
      let saved: Record<string, unknown>;
      try {
        saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        saved = {};
      }
      // tour: the first-run tour (FND-8) counts as seen, so it covers nothing in the tests.
      localStorage.setItem(key, JSON.stringify({ ...saved, theme: choice, tour: "done" }));
      window.location.hash = `#/${path}`;
      window.location.reload();
    },
    [SHELL_SETTINGS_KEY, route, theme === "parchment" ? "parchment" : "campaign"] as const,
  );
  await lyre.waitForLoadState("domcontentloaded");
  await lyre.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
  return lyre;
}
