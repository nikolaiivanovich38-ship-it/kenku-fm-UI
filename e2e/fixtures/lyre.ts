/**
 * WP5: steps for the new interface page (the "Lyre" tab), shared by e2e/lyre.spec.ts and the acceptance specs'
 * app branch (e2e/specs/support/target.ts). Kept free of the app fixture so both can use it.
 */
import { expect, type Page } from "@playwright/test";

/** The Lyre page's document title (the main window's is "Lyre", the old player's "Lyre Player"). */
export const LYRE_PAGE_TITLE = "Lyre Interface";

/** Where the new interface remembers its look (src/lyre/shell/settings.ts SHELL_SETTINGS_KEY). */
const SHELL_SETTINGS_KEY = "lyre-shell";

/** The app's main window and the Lyre page, found among the app's pages (they share one browser context). */
async function appPages(page: Page): Promise<{ main: Page; lyre: Page }> {
  let main: Page | undefined;
  let lyre: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const candidate of page.context().pages()) {
          const title = await candidate.title().catch(() => "");
          if (title === "Lyre") main = candidate;
          if (title === LYRE_PAGE_TITLE) lyre = candidate;
        }
        return Boolean(main && lyre);
      },
      { message: "the main window and the Lyre page", timeout: 30_000 },
    )
    .toBe(true);
  return { main: main as Page, lyre: lyre as Page };
}

/** Choose the "Lyre" tab in the main window, so the new interface is in front. Returns the Lyre page. */
export async function openLyreTab(page: Page): Promise<Page> {
  const { main, lyre } = await appPages(page);
  await main.getByRole("list", { name: "Tabs" }).getByRole("button", { name: "Lyre", exact: true }).click();
  await lyre.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
  return lyre;
}

/**
 * Open the Lyre tab at a route ("campaign/crown", "profile/t13/sc:crown:s14:sc3"), in a theme: "default" follows
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
      localStorage.setItem(key, JSON.stringify({ ...saved, theme: choice }));
      window.location.hash = `#/${path}`;
      window.location.reload();
    },
    [SHELL_SETTINGS_KEY, route, theme === "parchment" ? "parchment" : "campaign"] as const,
  );
  await lyre.waitForLoadState("domcontentloaded");
  await lyre.getByRole("main").getByRole("heading", { level: 1 }).waitFor();
  return lyre;
}
