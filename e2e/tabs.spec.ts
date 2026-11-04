/**
 * Website tabs and bookmarks in the main window, as in Kenku FM: open a page
 * from the address bar, follow a link, back/forward/reload, bookmark it,
 * open and edit the bookmark, close tabs. SEC-6: an address that is not a
 * web page is refused with a message and nothing is opened.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";

let site: LocalSite;

test.beforeEach(async () => {
  site = await startLocalSite({
    "/one": { title: "Page One", body: '<h1>One</h1><a href="/two">Go to page two</a>' },
    "/two": { title: "Page Two", body: "<h1>Two</h1>" },
  });
});

test.afterEach(async () => {
  await site.close();
});

/** A tab in the tab bar. */
function tab(mainWindow: Page, title: string) {
  return mainWindow.locator("#controls").getByRole("listitem").filter({ hasText: title });
}

/** A bookmark in the side bar. */
function bookmark(mainWindow: Page, title: string) {
  return mainWindow.getByRole("navigation").getByRole("listitem").filter({ hasText: title });
}

/**
 * Give the capture window a moment to start recording a tab that has just
 * loaded. Closing a tab while that is still starting logs "Unable to start
 * stream for web view" in the capture window (harmless, also in Kenku FM).
 */
function settleTabCapture(mainWindow: Page) {
  return mainWindow.waitForTimeout(1_500);
}

/** Addresses of every open web page (tabs, player, capture window, main window). */
function openAddresses(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
}

test("open a page in a new tab, follow a link, go back, forward and reload", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  await expect(tab(mainWindow, "New Tab")).toBeVisible();

  const address = mainWindow.getByLabel("Web address");
  await expect(address).toBeFocused();
  await address.fill(site.url("/one"));
  await address.press("Enter");

  const page = await pageWithTitle(app, "Page One");
  await expect(tab(mainWindow, "Page One")).toBeVisible();
  // Plain http pages are marked as not secure.
  await expect(mainWindow.getByText("Not secure")).toBeVisible();

  await page.getByRole("link", { name: "Go to page two" }).click();
  await expect(tab(mainWindow, "Page Two")).toBeVisible();
  await expect(address).toHaveValue(site.url("/two"));

  await mainWindow.getByRole("button", { name: "Back" }).click();
  await expect(tab(mainWindow, "Page One")).toBeVisible();
  await expect(address).toHaveValue(site.url("/one"));

  await mainWindow.getByRole("button", { name: "Forward" }).click();
  await expect(tab(mainWindow, "Page Two")).toBeVisible();
  await expect(address).toHaveValue(site.url("/two"));

  const before = site.hits.get("/two") ?? 0;
  await mainWindow.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => site.hits.get("/two") ?? 0).toBe(before + 1);

  // Closing the tab removes its page and goes back to the player.
  await tab(mainWindow, "Page Two").getByRole("button", { name: "close" }).click();
  await expect(tab(mainWindow, "Page Two")).toHaveCount(0);
  await expect.poll(() => openAddresses(app)).not.toContain(site.url("/two"));
  await expect(mainWindow.getByLabel("Web address")).toHaveCount(0);
});

test("bookmark a page, open, edit and delete the bookmark", async ({ app, mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  const address = mainWindow.getByLabel("Web address");
  await address.fill(site.url("/two"));
  await address.press("Enter");
  await expect(tab(mainWindow, "Page Two")).toBeVisible();

  await tab(mainWindow, "Page Two").getByRole("button", { name: "bookmark" }).click();
  await expect(bookmark(mainWindow, "Page Two")).toBeVisible();

  // Close the tab, then open the page again from the bookmark.
  await tab(mainWindow, "Page Two").getByRole("button", { name: "close" }).click();
  await expect(tab(mainWindow, "Page Two")).toHaveCount(0);
  const hitsBefore = site.hits.get("/two") ?? 0;
  await bookmark(mainWindow, "Page Two").getByText("Page Two").click();
  await expect(tab(mainWindow, "Page Two")).toBeVisible();
  await expect.poll(() => site.hits.get("/two") ?? 0).toBe(hitsBefore + 1);
  await settleTabCapture(mainWindow);
  await tab(mainWindow, "Page Two").getByRole("button", { name: "close" }).click();

  // Edit: a refused address keeps the dialog open with a message.
  await bookmark(mainWindow, "Page Two").getByRole("button", { name: "Options for Page Two" }).click();
  await mainWindow.getByRole("menuitem", { name: "Edit" }).click();
  const edit = mainWindow.getByRole("dialog", { name: "Edit Bookmark" });
  await edit.getByLabel("URL").fill("javascript:alert(1)");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit.getByRole("alert")).toContainText("https:// or http://");
  await edit.getByLabel("URL").fill(site.url("/one"));
  await edit.getByLabel("Name").fill("First page");
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit).toBeHidden();
  await expect(bookmark(mainWindow, "First page")).toBeVisible();

  // The edited bookmark opens the new address.
  await bookmark(mainWindow, "First page").getByText("First page").click();
  await pageWithTitle(app, "Page One");
  await settleTabCapture(mainWindow);
  await tab(mainWindow, "First page").or(tab(mainWindow, "Page One")).getByRole("button", { name: "close" }).click();

  await bookmark(mainWindow, "First page").getByRole("button", { name: "Options for First page" }).click();
  await mainWindow.getByRole("menuitem", { name: "Delete" }).click();
  await expect(bookmark(mainWindow, "First page")).toHaveCount(0);
});

test("a file on a network share is refused with a message and nothing opens", async ({ app, mainWindow, playerView }) => {
  // SEC-15: files on this computer open after a question (e2e/localFiles.spec.ts);
  // network shares never do, because Windows would send the user's login there.
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await mainWindow.getByRole("button", { name: "add tab" }).click();
  const address = mainWindow.getByLabel("Web address");
  await address.fill("file://fileserver/share/passwords.html");
  await address.press("Enter");

  await expect(mainWindow.getByRole("alert")).toContainText("not files in a shared network folder");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await mainWindow.waitForTimeout(1_000);
  const addresses = await openAddresses(app);
  expect(addresses.filter((url) => url.includes("fileserver"))).toEqual([]);

  // Typing again clears the message; a good address then loads.
  await address.fill(site.url("/one"));
  await expect(mainWindow.getByRole("alert")).toHaveCount(0);
  await address.press("Enter");
  await pageWithTitle(app, "Page One");
});
