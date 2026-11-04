/**
 * The Settings panel in the main window: Discord token field and help link,
 * a refused token (Discord itself cannot be reached from the test machine),
 * Clear website data and the version number.
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
  // error message and the form is usable again. The message is an alert that
  // screen readers can reach while Settings is open.
  // (A refusal is worded plainly, UX finding 5.)
  const failed = /^(Error connecting to bot: |Discord didn't accept this token\.)/;
  await expect(mainWindow.getByRole("alert")).toHaveText(failed, { timeout: 45_000 });
  await expect(connect).toBeEnabled();
  await expect(token).toBeEditable();
  expect(errors.pageErrors).toEqual([]);

  // The message stays until it is closed (WCAG 2.2.1).
  await mainWindow.getByTitle("Close").click();
  await expect(mainWindow.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
});

test("an error message does not cover the Settings Done button", async ({ mainWindow }) => {
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Token").fill("not-a-real-bot-token");
  await settings.getByRole("button", { name: "Connect" }).click();
  await expect(mainWindow.getByRole("alert")).toBeVisible({ timeout: 45_000 });
  await settings.getByRole("button", { name: "Done" }).click({ timeout: 5_000 });
  await expect(settings).toBeHidden();
});

test("Clear website data empties the website tabs' storage, and the version is shown", async ({ app, mainWindow }) => {
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

  const clear = settings.getByRole("button", { name: "Clear website data" });
  await expect(clear).toHaveAccessibleDescription(/^Logs you out of websites in tabs/);
  await clear.click();
  await expect(clear).toBeVisible();
  await expect.poll(cookieCount).toBe(0);
});
