/**
 * The Settings panel in the main window: Discord token field and help link,
 * a refused token (Discord itself cannot be reached from the test machine),
 * Clear website data and the version number.
 */
import packageJson from "../package.json";
import identity from "../src/main/appIdentity.json";
import { test, expect } from "./fixtures/app";

/** Lyre's own Discord set-up steps, in its README on GitHub. */
const DISCORD_HELP = `https://github.com/${identity.github.owner}/${identity.github.repo}#connect-your-discord-bot`;

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
  await expect(help).toHaveAttribute("href", DISCORD_HELP);
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
    .toEqual([DISCORD_HELP]);

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
  const alert = mainWindow.getByRole("alert");
  await expect(alert).toHaveText(failed, { timeout: 45_000 });
  await expect(token).toBeEditable();
  if ((await alert.textContent())?.startsWith("Discord didn't accept")) {
    // A refused token is forgotten (UX finding 5), so Connect waits for a new one.
    await expect(token).not.toHaveAttribute("placeholder", "Saved");
    await expect(connect).toBeDisabled();
    await token.fill("another-token");
  }
  await expect(connect).toBeEnabled();
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

test("Remote control is described in plain words and links only to the Stream Deck plugin's guide", async ({
  mainWindow,
}) => {
  await mainWindow.getByRole("button", { name: "Settings" }).click();
  const settings = mainWindow.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText("What is Kenku Remote?")).toHaveCount(0);
  await expect(settings.getByText(/Lets a Stream Deck or another program control the player/)).toBeVisible();
  await expect(settings.getByText(/Works with the existing Kenku FM Stream Deck plugin/)).toBeVisible();
  await expect(settings.getByRole("link", { name: "About the Kenku FM Stream Deck plugin" })).toHaveAttribute(
    "href",
    "https://www.kenku.fm/docs/using-kenku-remote",
  );
  // No other link in Settings leads to Kenku FM's website.
  const hrefs = await settings.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.filter((href) => href?.includes("kenku.fm"))).toEqual(["https://www.kenku.fm/docs/using-kenku-remote"]);
});
