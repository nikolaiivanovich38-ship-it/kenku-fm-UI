/**
 * The Settings panel in the main window: Discord token field and help link,
 * a refused token (Discord itself cannot be reached from the test machine),
 * Clear Cache and the version number.
 */
import packageJson from "../package.json";
import { test, expect } from "./fixtures/app";

test("Discord token: help link, and a bad token shows an error without breaking anything", async ({
  app,
  mainWindow,
  errors,
}) => {
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();

  const token = settings.getByLabel("Token");
  await expect(token).toBeEditable();
  await expect(token).toHaveAttribute("type", "password");

  // The help link goes to the system browser (SEC-10 allows https links only).
  const help = settings.getByRole("link", { name: "Where do I get my token?" });
  await expect(help).toHaveAttribute("href", "https://kenku.fm/docs/getting-a-discord-token");
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { openedLinks: string[] }).openedLinks = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await help.click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { openedLinks: string[] }).openedLinks))
    .toEqual(["https://kenku.fm/docs/getting-a-discord-token"]);

  // Connect stays disabled until a token is typed.
  const connect = settings.getByRole("button", { name: "Connect" });
  await expect(connect).toBeDisabled();
  await token.fill("not-a-real-bot-token");
  await expect(connect).toBeEnabled();
  await connect.click();

  // Either Discord refuses the token or cannot be reached: both end in an
  // error message and the form is usable again. The message is an alert, but
  // the open Settings dialog hides the rest of the window from screen
  // readers, so it is found by its text here (see docs/testing.md).
  await expect(mainWindow.getByText(/^Error connecting to bot: /)).toBeVisible({ timeout: 45_000 });
  await expect(connect).toBeEnabled();
  await expect(token).toBeEditable();
  expect(errors.pageErrors).toEqual([]);

  // The message stays until it is closed (WCAG 2.2.1); it covers the
  // dialog's Done button meanwhile (see the next test), so close it first.
  await mainWindow.getByTitle("Close").click();
  await expect(mainWindow.getByText(/^Error connecting to bot: /)).toHaveCount(0);
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
});

test("an error message does not cover the Settings Done button", async ({ mainWindow }) => {
  test.fail(
    true,
    "Known UX issue: the error toast (bottom left, no auto-hide since 4b6d863) sits on top of the Settings " +
      "dialog's Done button until the user closes it.",
  );
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Token").fill("not-a-real-bot-token");
  await settings.getByRole("button", { name: "Connect" }).click();
  await expect(mainWindow.getByText(/^Error connecting to bot: /)).toBeVisible({ timeout: 45_000 });
  await settings.getByRole("button", { name: "Done" }).click({ timeout: 5_000 });
  await expect(settings).toBeHidden();
});

test("Clear Cache empties the website tabs' storage, and the version is shown", async ({ app, mainWindow }) => {
  // A cookie that a website tab would have stored.
  await app.evaluate(async ({ session }) => {
    await session
      .fromPartition("persist:tabs")
      .cookies.set({ url: "https://example.com", name: "visited", value: "yes", expirationDate: 4_000_000_000 });
  });
  const cookieCount = () =>
    app.evaluate(async ({ session }) => (await session.fromPartition("persist:tabs").cookies.get({})).length);
  expect(await cookieCount()).toBe(1);

  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText(`v${packageJson.version}`, { exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "Clear Cache" }).click();
  await expect(settings.getByRole("button", { name: "Clear Cache" })).toBeVisible();
  await expect.poll(cookieCount).toBe(0);
});
