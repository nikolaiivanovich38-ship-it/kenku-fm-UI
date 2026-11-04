/**
 * UX-10: bookmark folders and the collapsible sidebar. Bookmarks go into
 * folders by drag and drop or with "Move to folder…"; folders open, close,
 * are renamed and deleted (keeping their bookmarks); the sidebar collapses to
 * icons, website views move with it, and both survive a restart.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";

let site: LocalSite;

test.beforeEach(async () => {
  site = await startLocalSite({
    "/one": { title: "Page One", body: "<h1>One</h1>" },
    "/two": { title: "Page Two", body: "<h1>Two</h1>" },
  });
});

test.afterEach(async () => {
  await site.close();
});

const sidebar = (mainWindow: Page) => mainWindow.getByRole("navigation", { name: "Sidebar" });

function tab(mainWindow: Page, title: string) {
  return mainWindow.locator("#controls").getByRole("listitem").filter({ hasText: title });
}

/** Open `path` in a new tab, bookmark it and close the tab again. */
async function bookmarkPage(app: ElectronApplication, mainWindow: Page, path: string, title: string) {
  await mainWindow.getByRole("button", { name: "add tab", exact: true }).click();
  const address = mainWindow.getByLabel("Web address");
  await address.fill(site.url(path));
  await address.press("Enter");
  await pageWithTitle(app, title);
  await tab(mainWindow, title).getByRole("button", { name: "bookmark", exact: true }).click();
  await mainWindow.waitForTimeout(1_500);
  await tab(mainWindow, title).getByRole("button", { name: "close", exact: true }).click();
}

/** Left edge of the website view showing `title`. */
function viewLeft(app: ElectronApplication, title: string): Promise<number | undefined> {
  return app.evaluate(({ BrowserWindow }, pageTitle) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const view of window.contentView.children) {
        const contents = (view as Electron.WebContentsView).webContents;
        if (contents?.getTitle() === pageTitle) {
          return view.getBounds().x;
        }
      }
    }
    return undefined;
  }, title);
}

test("group bookmarks into folders, collapse the sidebar, and keep both after a restart", async ({ launchApp }) => {
  let launched = await launchApp();
  let mainWindow = await launched.mainWindow();
  await expect((await launched.playerView()).getByText("Playlists", { exact: true })).toBeVisible();
  await bookmarkPage(launched.app, mainWindow, "/one", "Page One");
  await bookmarkPage(launched.app, mainWindow, "/two", "Page Two");

  // New folder.
  await sidebar(mainWindow).getByRole("button", { name: "New bookmark folder", exact: true }).click();
  const create = mainWindow.getByRole("dialog", { name: "New folder" });
  await create.getByLabel("Folder name").fill("Combat");
  await create.getByRole("button", { name: "Done", exact: true }).click();
  const folder = sidebar(mainWindow).getByRole("button", { name: "Combat folder", exact: true });
  await expect(folder).toHaveAttribute("aria-expanded", "true");

  // Keyboard alternative to dragging: Move to folder…
  await sidebar(mainWindow).getByRole("button", { name: "Options for Page Two", exact: true }).click();
  await mainWindow.getByRole("menuitem", { name: "Move to folder…" }).click();
  await mainWindow.getByRole("menuitem", { name: "Combat" }).click();
  const combat = sidebar(mainWindow).getByRole("group", { name: "Combat" });
  await expect(combat.getByText("Page Two")).toBeVisible();

  // Drag Page One onto the folder, holding it by its site icon (once the menu
  // has gone, so the pointer reaches the list).
  await expect(mainWindow.getByRole("menu")).toHaveCount(0);
  const source = await sidebar(mainWindow).getByRole("button", { name: "Page One", exact: true }).boundingBox();
  const target = await folder.boundingBox();
  await mainWindow.mouse.move(source!.x + 20, source!.y + source!.height / 2);
  await mainWindow.mouse.down();
  await mainWindow.mouse.move(source!.x + 20, source!.y + source!.height / 2 - 15, { steps: 5 });
  await mainWindow.mouse.move(target!.x + 20, target!.y + target!.height / 2, { steps: 10 });
  await mainWindow.mouse.up();
  await expect(combat.getByText("Page One")).toBeVisible();

  // Close the folder with the keyboard; rename it.
  await folder.focus();
  await mainWindow.keyboard.press("Enter");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar(mainWindow).getByText("Page Two")).toHaveCount(0);
  await sidebar(mainWindow).getByRole("button", { name: "Options for folder Combat", exact: true }).click();
  await mainWindow.getByRole("menuitem", { name: "Rename" }).click();
  const rename = mainWindow.getByRole("dialog", { name: "Rename folder" });
  await rename.getByLabel("Folder name").fill("Battle");
  await rename.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sidebar(mainWindow).getByRole("button", { name: "Battle folder", exact: true })).toBeVisible();

  // Collapse the sidebar: bookmarks become icons and websites move left.
  await sidebar(mainWindow).getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const rail = sidebar(mainWindow).getByRole("list", { name: "Bookmarks" });
  await rail.getByRole("button", { name: "Battle folder", exact: true }).click();
  await mainWindow.getByRole("menuitem", { name: "Page One" }).click();
  await pageWithTitle(launched.app, "Page One");
  await expect.poll(() => viewLeft(launched.app, "Page One")).toBe(56);
  await mainWindow.waitForTimeout(1_500);

  // Restart: the folder and the collapsed sidebar are remembered.
  await launched.close();
  launched = await launchApp();
  mainWindow = await launched.mainWindow();
  await expect((await launched.playerView()).getByText("Playlists", { exact: true })).toBeVisible();
  await expect(sidebar(mainWindow).getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await sidebar(mainWindow).getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(sidebar(mainWindow).getByRole("button", { name: "Battle folder", exact: true })).toBeVisible();

  // Deleting the folder keeps its bookmarks.
  await sidebar(mainWindow).getByRole("button", { name: "Options for folder Battle", exact: true }).click();
  await mainWindow.getByRole("menuitem", { name: "Delete folder (keeps its bookmarks)" }).click();
  await expect(sidebar(mainWindow).getByRole("button", { name: "Page One", exact: true })).toBeVisible();
  await expect(sidebar(mainWindow).getByRole("button", { name: "Page Two", exact: true })).toBeVisible();
});

test("opening Settings from the collapsed sidebar expands it first", async ({ mainWindow, playerView }) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await sidebar(mainWindow).getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await sidebar(mainWindow).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(mainWindow.getByRole("dialog", { name: "Settings" })).toBeVisible();
  // The Settings dialog hides the sidebar from screen readers, so read its width.
  await expect(mainWindow.locator("#sidebar")).toHaveAttribute("data-width", "240");
});
