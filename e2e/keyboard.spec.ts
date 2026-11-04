/**
 * UX review findings 2, 3 and 12: everything works from the keyboard, the
 * keyboard focus is clearly visible, and focus is not lost after an action.
 */
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite, type LocalSite } from "./fixtures/localSite";
import { expectOnScreen, focusRingPixels } from "./fixtures/screen";

let site: LocalSite;
test.beforeEach(async () => {
  site = await startLocalSite({
    "/one": { title: "Page One", body: "<h1>One</h1>" },
    "/two": { title: "Page Two", body: "<h1>Two</h1>" },
    "/three": { title: "Page Three", body: "<h1>Three</h1>" },
  });
});
test.afterEach(async () => {
  await site.close();
});

const sidebar = (mainWindow: Page) => mainWindow.getByRole("navigation", { name: "Sidebar" });
const tab = (mainWindow: Page, title: string) =>
  mainWindow.getByRole("list", { name: "Tabs" }).getByRole("listitem").filter({ hasText: title });

async function openPage(app: ElectronApplication, mainWindow: Page, pathname: string, title: string) {
  await mainWindow.getByRole("button", { name: "New tab", exact: true }).click();
  const address = mainWindow.getByLabel("Web address");
  await address.fill(site.url(pathname));
  await address.press("Enter");
  await pageWithTitle(app, title);
  await expect(tab(mainWindow, title)).toBeVisible();
}

/** Focus `locator` the way a keyboard user does, so :focus-visible applies. */
async function keyboardFocus(page: Page, locator: ReturnType<Page["locator"]>) {
  // A key press first makes Chromium (and MUI) treat the next focus as keyboard focus.
  await page.keyboard.press("Shift");
  await locator.focus();
}

test("keyboard focus shows one clear gold outline, which a mouse click does not (finding 3)", async ({
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  const gear = mainWindow.getByRole("button", { name: "Settings", exact: true });
  await keyboardFocus(mainWindow, gear);
  await expect(gear).toBeFocused();
  await expect.poll(() => focusRingPixels(mainWindow, gear)).toBeGreaterThan(40);

  for (const control of [
    mainWindow.getByRole("button", { name: "New tab", exact: true }),
    mainWindow.getByRole("button", { name: "This Computer", exact: true }),
    sidebar(mainWindow).getByRole("button", { name: "Collapse sidebar" }),
    sidebar(mainWindow).getByRole("button", { name: "Outputs" }),
  ]) {
    await keyboardFocus(mainWindow, control);
    await expect
      .poll(() => focusRingPixels(mainWindow, control), { message: (await control.getAttribute("aria-label")) ?? "" })
      .toBeGreaterThan(40);
  }

  // A click does not draw the outline.
  const bookmarks = sidebar(mainWindow).getByRole("button", { name: "Bookmarks", exact: true });
  await bookmarks.click();
  await bookmarks.click();
  await expect(bookmarks).toBeFocused();
  expect(await focusRingPixels(mainWindow, bookmarks)).toBe(0);

  // Inside Settings too.
  await keyboardFocus(mainWindow, gear);
  await mainWindow.keyboard.press("Enter");
  const done = mainWindow.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Done" });
  // (Polled: the panel fades in, and a half-faded outline is not yet gold.)
  await keyboardFocus(mainWindow, done);
  await expect.poll(() => focusRingPixels(mainWindow, done)).toBeGreaterThan(40);
});

test("Enter and Space press a tab's own buttons instead of picking the tab up (finding 2)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await openPage(app, mainWindow, "/one", "Page One");

  const bookmark = tab(mainWindow, "Page One").getByRole("button", { name: "Bookmark Page One" });
  await keyboardFocus(mainWindow, bookmark);
  await mainWindow.keyboard.press("Enter");
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar(mainWindow).getByRole("button", { name: "Page One", exact: true })).toBeVisible();

  const close = tab(mainWindow, "Page One").getByRole("button", { name: "Close tab Page One" });
  await keyboardFocus(mainWindow, close);
  await mainWindow.keyboard.press("Space");
  await expect(tab(mainWindow, "Page One")).toHaveCount(0);
});

test("a tab moves with the keyboard from its handle, announced by name (finding 2)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  await openPage(app, mainWindow, "/one", "Page One");
  await openPage(app, mainWindow, "/two", "Page Two");
  const titles = () =>
    mainWindow
      .getByRole("list", { name: "Tabs" })
      .getByRole("button", { name: /^Page (One|Two)$/ })
      .allTextContents();
  expect(await titles()).toEqual(["Page One", "Page Two"]);

  const handle = mainWindow.getByRole("button", { name: "Move Page Two" });
  await keyboardFocus(mainWindow, handle);
  await mainWindow.keyboard.press("Space");
  // The tab bar's own live region (the bookmarks list has another).
  const live = mainWindow.locator("[id^='DndLiveRegion']");
  await expect(live.filter({ hasText: "Picked up Page Two." })).toHaveCount(1);
  await mainWindow.keyboard.press("ArrowLeft");
  await expect(live.filter({ hasText: "Page Two is over Page One, number 1 of 2." })).toHaveCount(1);
  await mainWindow.keyboard.press("Space");
  await expect.poll(titles).toEqual(["Page Two", "Page One"]);
  await expect(live.filter({ hasText: "Dropped Page Two. It is now number 1 of 2." })).toHaveCount(1);
  // Never the internal ids the review heard.
  await expect(live.filter({ hasText: "Draggable item" })).toHaveCount(0);
  await mainWindow.waitForTimeout(1_000);
});

test("Move to folder… and Delete folder work from the keyboard, and focus goes to the next item (findings 2, 12)", async ({
  app,
  mainWindow,
  playerView,
}) => {
  await expect(playerView.getByText("Playlists", { exact: true })).toBeVisible();
  for (const [pathname, title] of [
    ["/one", "Page One"],
    ["/two", "Page Two"],
    ["/three", "Page Three"],
  ]) {
    await openPage(app, mainWindow, pathname, title);
    await tab(mainWindow, title).getByRole("button", { name: `Bookmark ${title}` }).click();
  }
  await sidebar(mainWindow).getByRole("button", { name: "New bookmark folder" }).click();
  const dialog = mainWindow.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Folder name").fill("Combat");
  await dialog.getByLabel("Folder name").press("Enter");
  await expect(dialog).toHaveCount(0);

  // Options for Page One, from the keyboard; the menu is on screen over the website.
  const options = sidebar(mainWindow).getByRole("button", { name: "Options for Page One" });
  await keyboardFocus(mainWindow, options);
  await mainWindow.keyboard.press("Enter");
  const move = mainWindow.getByRole("menuitem", { name: "Move to folder…" });
  await expectOnScreen(app, mainWindow, move);
  await move.focus();
  await mainWindow.keyboard.press("Enter");
  await mainWindow.getByRole("menuitem", { name: "Combat" }).focus();
  await mainWindow.keyboard.press("Enter");
  await expect(sidebar(mainWindow).getByRole("group", { name: "Combat" }).getByText("Page One")).toBeVisible();
  // Focus went to the bookmark that came after Page One.
  await expect(sidebar(mainWindow).getByRole("button", { name: "Page Two", exact: true })).toBeFocused();

  // Delete the folder from the keyboard: focus goes to what came after it.
  await keyboardFocus(mainWindow, sidebar(mainWindow).getByRole("button", { name: "Options for folder Combat" }));
  await mainWindow.keyboard.press("Enter");
  await mainWindow.getByRole("menuitem", { name: "Delete folder (keeps its bookmarks)" }).focus();
  await mainWindow.keyboard.press("Enter");
  await expect(sidebar(mainWindow).getByRole("button", { name: "Combat folder" })).toHaveCount(0);
  await expect(sidebar(mainWindow).getByRole("button", { name: "Page Two", exact: true })).toBeFocused();

  // Reorder a bookmark from its handle: Space, Up, Space.
  const order = () => sidebar(mainWindow).getByRole("button", { name: /^Page (One|Two|Three)$/ }).allTextContents();
  // (Page One came back from the folder last.)
  expect(await order()).toEqual(["Page Two", "Page Three", "Page One"]);
  await keyboardFocus(mainWindow, sidebar(mainWindow).getByRole("button", { name: "Move Page One" }));
  await mainWindow.keyboard.press("Space");
  const live = mainWindow.locator("[id^='DndLiveRegion']");
  await expect(live.filter({ hasText: "Picked up Page One. It is number 3 of 3." })).toHaveCount(1);
  await mainWindow.keyboard.press("ArrowUp");
  await expect(live.filter({ hasText: "Page One is over Page Three, number 2 of 3." })).toHaveCount(1);
  await mainWindow.keyboard.press("Space");
  await expect.poll(order).toEqual(["Page Two", "Page One", "Page Three"]);
  await expect(live.filter({ hasText: "Dropped Page One. It is now number 2 of 3." })).toHaveCount(1);
});
