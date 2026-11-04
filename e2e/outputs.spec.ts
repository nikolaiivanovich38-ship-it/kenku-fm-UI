/**
 * WP2 SEC-5 and OUT-1: Discord bot tokens are kept by the main process
 * (encrypted, or for the session only) and never in plain text on disk; a
 * token saved by an older version is moved there once; any number of bots,
 * each in its own channel, can be muted one by one. Uses the fake Discord
 * (fixtures/discord.ts).
 */
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { test, expect, pageWithTitle } from "./fixtures/app";
import { startLocalSite } from "./fixtures/localSite";
import { expectOnScreen } from "./fixtures/screen";
import {
  FAKE_DISCORD_ENV,
  TONE_PAGE,
  botSettings,
  channelButton,
  connectFakeBot,
  openSettings,
  openTab,
  packetCount,
} from "./fixtures/discord";

/** Every file under `folder` that contains `text` (as UTF-8 or UTF-16, as LevelDB may store it). */
function filesContaining(folder: string, text: string): string[] {
  const needles = [Buffer.from(text, "utf8"), Buffer.from(text, "utf16le")];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        if (needles.some((needle) => content.includes(needle))) {
          found.push(path.relative(folder, full));
        }
      }
    }
  };
  walk(folder);
  return found;
}

function savedRoot(mainWindow: Page): Promise<string> {
  return mainWindow.evaluate(() => localStorage.getItem("persist:root") ?? "");
}

test("a bot token typed in Settings never reaches browser storage or the disk in plain text", async ({
  launchApp,
  userDataDir,
}) => {
  const token = "fake-token-NEVER-IN-PLAIN-TEXT-0123456789";
  const first = await launchApp({ env: FAKE_DISCORD_ENV });
  const mainWindow = await first.mainWindow();
  await connectFakeBot(mainWindow, token);
  expect(await savedRoot(mainWindow)).not.toContain(token);

  await openSettings(mainWindow);
  const bot = botSettings(mainWindow);
  const encrypted = await bot.getByText("A token is saved, encrypted on this computer.", { exact: false }).isVisible();
  if (!encrypted) {
    // No keyring (Linux test machines): kept for this session only, and said so.
    await expect(mainWindow.getByText(/Tokens are forgotten when you close the app/)).toBeVisible();
    await expect(bot.getByText(/for this session only/)).toBeVisible();
  }
  await first.close();
  expect(filesContaining(userDataDir, token)).toEqual([]);

  // After a restart the token is still there only if it could be encrypted.
  const second = await launchApp({ env: FAKE_DISCORD_ENV });
  const again = await second.mainWindow();
  await openSettings(again);
  if (encrypted) {
    await expect(botSettings(again).getByRole("button", { name: "Disconnect" })).toBeVisible();
  } else {
    await expect(botSettings(again).getByText(/^Your bot's password/)).toBeVisible();
  }
  await second.close();
  expect(filesContaining(userDataDir, token)).toEqual([]);
});

test("a token saved by an older version is moved out of browser storage once, and the bot still connects", async ({
  launchApp,
}) => {
  const token = "fake-token-FROM-OLD-VERSION-42";
  const old = await launchApp({ env: FAKE_DISCORD_ENV });
  const oldWindow = await old.mainWindow();
  await old.playerView();
  // What Kenku FM / Cue Desk 0.1 saved: the token and "Multiple Outputs" in the settings.
  await oldWindow.waitForTimeout(1_000);
  await oldWindow.evaluate((value) => {
    const root = JSON.parse(localStorage.getItem("persist:root") ?? "{}");
    const settings = JSON.parse(root.settings ?? "{}");
    root.settings = JSON.stringify({ ...settings, discordToken: value, multipleOutputsEnabled: true });
    root._persist = JSON.stringify({ version: 4, rehydrated: true });
    localStorage.setItem("persist:root", JSON.stringify(root));
  }, token);
  await old.close();

  const next = await launchApp({ env: FAKE_DISCORD_ENV });
  const mainWindow = await next.mainWindow();
  // The bot connects with the moved token, with no action needed.
  await expect(channelButton(mainWindow, "Tavern")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => savedRoot(mainWindow)).not.toContain(token);
  expect(await savedRoot(mainWindow)).not.toContain("multipleOutputsEnabled");
  await openSettings(mainWindow);
  await expect(botSettings(mainWindow).getByLabel("Token")).toHaveValue("");
});

test("two bots join two voice channels of one server, and each can be muted on its own", async ({
  launchApp,
}) => {
  test.setTimeout(90_000);
  const site = await startLocalSite({ "/tone": TONE_PAGE });
  try {
    const launched = await launchApp({ env: FAKE_DISCORD_ENV });
    const { app } = launched;
    const mainWindow = await launched.mainWindow();
    await launched.playerView();
    const settings = await openSettings(mainWindow);
    // OUT-1 replaces the old switch.
    await expect(settings.getByText("Multiple Outputs")).toHaveCount(0);

    // The guided step explains why and links to Discord's developer portal.
    await settings.getByRole("button", { name: "Add a second bot" }).click();
    const guide = mainWindow.getByRole("dialog", { name: "Add a second bot" });
    await expect(guide).toContainText("only one voice channel per server");
    const portal = guide.getByRole("link", { name: "Discord Developer Portal" });
    await expect(portal).toHaveAttribute("href", "https://discord.com/developers/applications");
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { openedLinks: string[] }).openedLinks = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    await portal.click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { openedLinks: string[] }).openedLinks))
      .toEqual(["https://discord.com/developers/applications"]);
    await guide.getByRole("button", { name: "Add bot" }).click();
    await expect(botSettings(mainWindow, "Bot 2")).toBeVisible();
    await settings.getByRole("button", { name: "Done" }).click();
    // Let Settings finish closing, or connectFakeBot sees it still fading out.
    await expect(settings).toBeHidden();

    await connectFakeBot(mainWindow, "fake-token-1", "Bot 1");
    await connectFakeBot(mainWindow, "fake-token-2", "Bot 2");
    await channelButton(mainWindow, "Tavern", "Bot 1").click();
    await channelButton(mainWindow, "Dungeon", "Bot 2").click();
    await expect(channelButton(mainWindow, "Tavern", "Bot 1")).toHaveAttribute("aria-pressed", "true");
    await expect(channelButton(mainWindow, "Dungeon", "Bot 2")).toHaveAttribute("aria-pressed", "true");

    await openTab(mainWindow, site.url("/tone"));
    const tone = await pageWithTitle(app, "Tone");
    await tone.evaluate(() => (window as unknown as { playTone(): void }).playTone());
    await expect.poll(() => packetCount(app, "Tavern"), { timeout: 10_000 }).toBeGreaterThan(20);
    await expect.poll(() => packetCount(app, "Dungeon"), { timeout: 10_000 }).toBeGreaterThan(20);

    // Mute the second bot: the Dungeon gets nothing more, the Tavern still does.
    const muteBot2 = mainWindow.getByRole("button", { name: /^Mute .*Bot 2/ });
    await muteBot2.click();
    await expect(muteBot2).toHaveAttribute("aria-pressed", "true");
    await mainWindow.waitForTimeout(500);
    const dungeon = await packetCount(app, "Dungeon");
    const tavern = await packetCount(app, "Tavern");
    await mainWindow.waitForTimeout(1_500);
    expect(await packetCount(app, "Dungeon")).toBe(dungeon);
    expect(await packetCount(app, "Tavern")).toBeGreaterThan(tavern + 30);
    await muteBot2.click();
    await expect(muteBot2).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => packetCount(app, "Dungeon"), { timeout: 10_000 }).toBeGreaterThan(dungeon + 20);
  } finally {
    await site.close();
  }
});

test("each output shows its status, reconnects by itself and explains failures (OUT-2, BUG-6)", async ({ launchApp }) => {
  test.setTimeout(90_000);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  await connectFakeBot(mainWindow);
  const bot = mainWindow.getByRole("group", { name: /\(Bot 1\)$/ });
  const chip = bot.getByRole("status");
  await expect(chip).toHaveText("Ready");
  await expect(mainWindow.getByRole("button", { name: "This Computer", exact: true })).toBeVisible();

  await channelButton(mainWindow, "Tavern").click();
  await expect(chip).toHaveText("Connected");
  await expect(bot).toContainText("In Tavern");

  // The network drops: the bot says so and tries again by itself.
  const setNetworkDown = (down: boolean) =>
    app.evaluate((_electron, value) => {
      (globalThis as unknown as { __cueDeskFakeDiscord: { setNetworkDown(down: boolean): void } }).__cueDeskFakeDiscord.setNetworkDown(value);
    }, down);
  await setNetworkDown(true);
  await expect(chip).toHaveText("Reconnecting…");
  await expect(bot).toContainText("Trying again in");
  await setNetworkDown(false);
  await expect(chip).toHaveText("Connected", { timeout: 15_000 });

  // A channel the bot may not join: a plain reason, kept until dismissed.
  await channelButton(mainWindow, "Tavern").click();
  await expect(chip).toHaveText("Ready");
  await channelButton(mainWindow, "Locked Room").click();
  await expect(chip).toHaveText("Error");
  await expect(bot).toContainText("lacks the Connect permission");
  await expect(mainWindow.getByRole("alert")).toContainText("cannot join “Locked Room”");
  await expect(bot.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await mainWindow.getByTitle("Close").click();
  await expect(mainWindow.getByRole("alert")).toHaveCount(0);
  await expect(bot).toContainText("lacks the Connect permission");

  // Leaving a Stage channel really leaves it (BUG-7).
  await channelButton(mainWindow, "Stage").click();
  await expect(channelButton(mainWindow, "Stage")).toHaveAttribute("aria-pressed", "true");
  await expect(chip).toHaveText("Connected");
  await channelButton(mainWindow, "Stage").click();
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { __cueDeskFakeDiscord: { connectionsIn(id: string): unknown[] } }).__cueDeskFakeDiscord.connectionsIn("903")
            .length,
      ),
    )
    .toBe(0);
  await expect(chip).toHaveText("Ready");
});

const setNetworkDown = (app: import("@playwright/test").ElectronApplication, down: boolean) =>
  app.evaluate((_electron, value) => {
    (globalThis as unknown as { __cueDeskFakeDiscord: { setNetworkDown(down: boolean): void } }).__cueDeskFakeDiscord.setNetworkDown(
      value,
    );
  }, down);

test("a refused token is explained in plain words and not kept; the message goes once a good token connects (findings 4, 5)", async ({
  launchApp,
}) => {
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  const settings = await openSettings(mainWindow);
  const bot = botSettings(mainWindow);
  const token = bot.getByLabel("Token");
  // The field says what a token is and where to find it.
  await expect(token).toHaveAccessibleDescription("Your bot's password, from the Bot page in the Discord Developer Portal.");

  // Enter in the field presses Connect.
  await token.fill("not-a-real-token");
  await token.press("Enter");
  const alert = settings.getByRole("alert");
  await expect(alert).toHaveText(
    "Discord didn't accept this token. Copy it again from the Bot page in the Discord Developer Portal.",
  );
  await expectOnScreen(app, mainWindow, alert);
  // Nothing was kept: no "Saved" token, and the explanation is back.
  await expect(token).not.toHaveAttribute("placeholder", "Saved");
  await expect(token).toHaveAccessibleDescription(/^Your bot's password/);
  await expect(bot.getByRole("button", { name: "Remove token" })).toHaveCount(0);

  await token.fill("fake-token-1");
  await token.press("Enter");
  await expect(bot.getByRole("button", { name: "Disconnect" })).toBeVisible();
  // Fixed, so the message closed by itself.
  await expect(mainWindow.getByRole("alert")).toHaveCount(0);
});

test("while a bot reconnects, the wait counts down and Try now reconnects at once (finding 6)", async ({ launchApp }) => {
  test.setTimeout(90_000);
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  await connectFakeBot(mainWindow);
  const bot = mainWindow.getByRole("group", { name: /\(Bot 1\)$/ });
  const chip = bot.getByRole("status");
  await channelButton(mainWindow, "Tavern").click();
  await expect(chip).toHaveText("Connected");

  await setNetworkDown(app, true);
  await expect(chip).toHaveText("Reconnecting…");
  const seconds = async () => Number(/Trying again in (\d+) s/.exec(await bot.innerText())?.[1] ?? -1);
  // Wait for a wait of a few seconds, then see it count down.
  await expect.poll(seconds, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  const first = await seconds();
  await mainWindow.waitForTimeout(1_600);
  const later = await seconds();
  expect(later).toBeGreaterThan(0);
  expect(later).toBeLessThan(first);

  // The network is back: Try now does not wait for the countdown.
  await setNetworkDown(app, false);
  await bot.getByRole("button", { name: "Try now" }).click();
  await expect(chip).toHaveText("Connected", { timeout: 3_000 });
  await expect(bot.getByRole("button", { name: "Try now" })).toHaveCount(0);
});

test("the collapsed sidebar shows each output with its status, and mutes it (finding 9)", async ({ launchApp }) => {
  const launched = await launchApp({ env: FAKE_DISCORD_ENV });
  const { app } = launched;
  const mainWindow = await launched.mainWindow();
  await launched.playerView();
  await connectFakeBot(mainWindow);
  await channelButton(mainWindow, "Tavern").click();
  await expect(channelButton(mainWindow, "Tavern")).toHaveAttribute("aria-pressed", "true");
  // Why This Computer switched itself off.
  await expect(mainWindow.getByText(/^So you don't hear everything twice, This Computer turns off/)).toBeVisible();

  const sidebar = mainWindow.getByRole("navigation", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  const outputs = sidebar.getByRole("group", { name: "Outputs" });
  const local = outputs.getByRole("button", { name: "This Computer" });
  const fakeBot = outputs.getByRole("button", { name: "Mute Fake Bot 1 (Bot 1)" });
  await expectOnScreen(app, mainWindow, local);
  await expectOnScreen(app, mainWindow, fakeBot);
  await expect(local).toHaveAttribute("aria-pressed", "false");
  await expect(fakeBot).toHaveAttribute("data-status", "success");
  await expect(fakeBot).toHaveAccessibleDescription("Connected");

  // A bot that drops out is noticed.
  await setNetworkDown(app, true);
  await expect(fakeBot).toHaveAttribute("data-status", "warning");
  await expect(fakeBot).toHaveAccessibleDescription("Reconnecting…");
  await setNetworkDown(app, false);
  await expect(fakeBot).toHaveAttribute("data-status", "success", { timeout: 15_000 });

  await fakeBot.click();
  await expect(fakeBot).toHaveAttribute("aria-pressed", "true");
  await local.click();
  await expect(local).toHaveAttribute("aria-pressed", "true");
});
