/**
 * Settings in Lyre (OUT-8, design round 6 part 2: design/prototype/ROUND6.md, "Your notes on 0.4.0", and
 * src/views/settings.js). Nik asked for proper directions for adding a bot, inviting it to the server before Lyre has
 * its token, and for Settings, tokens and new bots in the new interface. The screen is not built yet, so every check
 * here is expected to fail in the app until "settings" is in support/built.ts.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { openRoute } from "./support/target";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const bots = (page: Page) => region(page, "Discord bots");
const sheet = (page: Page) => page.getByRole("dialog");

test.describe("Settings", () => {
  test("is in the menu, has no Back when opened from it, and lists each bot with its status, servers and a masked token", async ({ page }) => {
    await openRoute(page, "campaigns");
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await expect(page.getByRole("button", { name: /^Back to / })).toHaveCount(0);
    const table = bots(page).getByRole("group", { name: "Lyre Table" });
    await expect(table).toContainText("Connected");
    await expect(table).toContainText("The Gull and Lantern, Night court");
    await expect(table).toContainText("••••••••Kq7w");
    await expect(table.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await expect(table.getByRole("button", { name: "Replace the token of Lyre Table" })).toBeVisible();
  });

  test("Disconnect and Connect a bot", async ({ page }) => {
    await openRoute(page, "settings");
    const side = bots(page).getByRole("group", { name: "Lyre Side" });
    await side.getByRole("button", { name: "Disconnect" }).click();
    await expect(side).toContainText("Not connected");
    await side.getByRole("button", { name: "Connect" }).click();
    await expect(side).toContainText("Connected", { timeout: 5000 });
  });

  test("Replace… takes a new token and shows only its last four characters", async ({ page }) => {
    await openRoute(page, "settings");
    const side = bots(page).getByRole("group", { name: "Lyre Side" });
    await side.getByRole("button", { name: "Replace the token of Lyre Side" }).click();
    await side.getByLabel("New token for Lyre Side").fill("MTAx.secret-part.wxyz");
    await side.getByRole("button", { name: "Save" }).click();
    await expect(side).toContainText("••••••••wxyz");
    await expect(side).not.toContainText("secret-part");
  });

  test("Remove is behind the bot's ⋯ menu, with an Undo", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "More for Lyre Side" }).click();
    await page.getByRole("menuitem", { name: "Remove Lyre Side" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Side" })).toHaveCount(0);
    await page.getByRole("group", { name: "Undo" }).getByRole("button", { name: "Undo" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Side" })).toBeVisible();
  });

  test("the other settings Lyre still needs are here; the rare ones are folded", async ({ page }) => {
    await openRoute(page, "settings");
    await expect(region(page, "Sound to Discord").getByRole("radio", { name: "Best sound quality" })).toHaveAttribute("aria-checked", "true");
    for (const name of ["Remote control", "Website tabs", "Local files"]) {
      await expect(region(page, name).getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    await region(page, "Website tabs").getByRole("button", { name: "Website tabs", exact: true }).click();
    await expect(region(page, "Website tabs").getByRole("switch", { name: "Use several inputs at once" })).toBeDisabled();
    await region(page, "Website tabs").getByRole("switch", { name: "Microphones and other inputs" }).check();
    await expect(region(page, "Website tabs").getByRole("switch", { name: "Use several inputs at once" })).toBeEnabled();
  });
});

test.describe("Add a bot, in the order Discord needs", () => {
  test("three steps: create it, invite it first, then connect it with its token", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await expect(sheet(page).getByRole("heading")).toHaveText("Add a bot: step 1 of 3");
    await expect(sheet(page).getByRole("list", { name: "Steps" })).toContainText(/Create it.*Invite it.*Connect it/);
    await expect(sheet(page).getByRole("link", { name: "Open the Discord Developer Portal" })).toHaveAttribute("href", "https://discord.com/developers/applications");
    await expect(sheet(page)).toContainText("New Application");
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await expect(sheet(page).getByRole("heading")).toHaveText("Add a bot: step 2 of 3");
    await expect(sheet(page)).toContainText("Invite the bot before you give Lyre its token.");
    await expect(sheet(page)).toContainText("Manage Server");
  });

  test("the Application ID makes the invite with View Channels, Connect and Speak", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    const invite = sheet(page).getByRole("link", { name: "Open the invite" });
    await expect(invite).toHaveAttribute("aria-disabled", "true");
    await sheet(page).getByLabel("Application ID").fill("123456789012345678");
    await expect(invite).toHaveAttribute("href", "https://discord.com/oauth2/authorize?client_id=123456789012345678&scope=bot&permissions=3146752");
    await expect(invite).not.toHaveAttribute("aria-disabled", "true");
  });

  test("the invite can be made by hand: OAuth2 › URL Generator, scope bot, the three permissions, Generated URL", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    const byHand = sheet(page).getByRole("button", { name: "Or make the invite by hand" });
    await expect(byHand).toHaveAttribute("aria-expanded", "false");
    await byHand.click();
    await expect(byHand).toHaveAttribute("aria-expanded", "true");
    await expect(sheet(page)).toContainText("OAuth2 › URL Generator");
    await expect(sheet(page)).toContainText("Scopes: bot");
    await expect(sheet(page)).toContainText("Bot Permissions: View Channels, Connect, Speak");
    await expect(sheet(page)).toContainText("Open the Generated URL, choose your server, Authorize");
  });

  test("the last step takes the token from Bot › Reset Token, connects, and says which servers the bot is in", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await sheet(page).getByLabel("Application ID").fill("123456789012345678");
    await sheet(page).getByRole("link", { name: "Open the invite" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await expect(sheet(page)).toContainText("Bot › Reset Token › Copy");
    await sheet(page).getByLabel("Token", { exact: true }).fill("MTAx.new-bot.abcd");
    await sheet(page).getByRole("button", { name: "Connect", exact: true }).click();
    await expect(sheet(page).getByRole("status")).toContainText("Lyre Third is connected. In The Gull and Lantern.");
    await sheet(page).getByRole("button", { name: "Done" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Third" })).toContainText("••••••••abcd");
  });

  test("a bot connected before it was invited says it is in no server yet, with the invite again", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await sheet(page).getByLabel("Application ID").fill("123456789012345678");
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await sheet(page).getByLabel("Token", { exact: true }).fill("MTAx.new-bot.abcd");
    await sheet(page).getByRole("button", { name: "Connect", exact: true }).click();
    await expect(sheet(page).getByRole("status")).toContainText("It is in no server yet.");
    await expect(sheet(page).getByRole("link", { name: "Invite it" })).toHaveAttribute("href", /client_id=123456789012345678&scope=bot&permissions=3146752$/);
    await sheet(page).getByRole("button", { name: "Done" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Third" })).toContainText("In no server yet");
  });
});
