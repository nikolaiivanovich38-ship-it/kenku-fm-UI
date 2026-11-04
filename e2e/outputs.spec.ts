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
    await expect(mainWindow.getByText(/no secure place to save passwords/)).toBeVisible();
    await expect(bot.getByText(/until Lyre closes/)).toBeVisible();
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
    await expect(botSettings(again).getByText("Enter your bot's token")).toBeVisible();
  }
  await second.close();
  expect(filesContaining(userDataDir, token)).toEqual([]);
});

test("a token saved by an older version is moved out of browser storage once, and the bot still connects", async ({
  launchApp,
  userDataDir,
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
  const { app } = next;
  const mainWindow = await next.mainWindow();
  // The bot connects with the moved token, with no action needed.
  await expect(channelButton(mainWindow, "Tavern")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => savedRoot(mainWindow)).not.toContain(token);
  expect(await savedRoot(mainWindow)).not.toContain("multipleOutputsEnabled");
  // WP1 review 11: where the token cannot be encrypted it lasts only this
  // session, and a message box says so straight away.
  // The same rule as botTokenStore's canEncrypt (the backend is named on Linux only).
  const encrypted = await app.evaluate(({ safeStorage }) => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    try {
      return !["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend());
    } catch {
      return true;
    }
  });
  if (!encrypted) {
    await expect(mainWindow.getByRole("alert").filter({ hasText: "kept only until Lyre closes" })).toBeVisible();
  }
  const settings = await openSettings(mainWindow);
  await expect(botSettings(mainWindow).getByLabel("Token")).toHaveValue("");

  // WP1 review 4: the old version stored the token unprotected, and browser
  // storage can keep an overwritten value on disk, so Settings recommends
  // resetting it, once, with a link to Discord's site.
  const notice = settings.getByRole("note").filter({ hasText: "older version" });
  await expect(notice).toContainText("reset the token in the Discord Developer Portal");
  const portal = notice.getByRole("link", { name: "Discord Developer Portal" });
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
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toHaveCount(0);
  await next.close();

  // The leftover the notice is about: Chromium's LevelDB log may still hold
  // the old value, and only there. Recorded here so it is never hidden.
  const leftovers = filesContaining(userDataDir, token);
  const leveldb = path.join("Local Storage", "leveldb");
  expect(leftovers.filter((file) => !file.startsWith(leveldb))).toEqual([]);
  test.info().annotations.push({
    type: "known leftover",
    description: `old token still in: ${leftovers.join(", ") || "nowhere"}`,
  });

  // The notice does not come back once dismissed.
  const third = await launchApp({ env: FAKE_DISCORD_ENV });
  const again = await third.mainWindow();
  const settingsAgain = await openSettings(again);
  await expect(settingsAgain.getByRole("note").filter({ hasText: "older version" })).toHaveCount(0);
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
    await mainWindow.getByRole("button", { name: /^Mute .*Bot 2/ }).click();
    await mainWindow.waitForTimeout(500);
    const dungeon = await packetCount(app, "Dungeon");
    const tavern = await packetCount(app, "Tavern");
    await mainWindow.waitForTimeout(1_500);
    expect(await packetCount(app, "Dungeon")).toBe(dungeon);
    expect(await packetCount(app, "Tavern")).toBeGreaterThan(tavern + 30);
    await mainWindow.getByRole("button", { name: /^Unmute .*Bot 2/ }).click();
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
