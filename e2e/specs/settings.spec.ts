/**
 * Settings in Lyre (OUT-8, design round 6 part 2: design/prototype/ROUND6.md, "Your notes on 0.4.0", and
 * src/views/settings.js). Nik asked for proper directions for adding a bot, inviting it to the server before Lyre has
 * its token, and for Settings, tokens and new bots in the new interface. The screen is not built yet, so every check
 * here is expected to fail in the app until "settings" is in support/built.ts.
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { openRoute } from "./support/target";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const bots = (page: Page) => region(page, "Discord bots");
const sheet = (page: Page) => page.getByRole("dialog");

test.describe("Settings", () => {
  // Round 6 part 2 (OUT-8): Settings in Lyre is a round 6 screen, not built in the app yet.
  test("is in the menu, has Back to where Nik was (round 6 part 7), and lists each bot with its status, servers and a masked token", async ({ page }) => {
    expectFailureUntilBuilt("shell", "rooms-settings");
    await openRoute(page, "campaigns");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await expect(page.getByRole("button", { name: "Back to Campaigns" })).toBeVisible();
    const table = bots(page).getByRole("group", { name: "Lyre Table" });
    await expect(table).toContainText("Connected");
    await expect(table).toContainText("The Gull and Lantern, Night court");
    await expect(table).toContainText("••••••••Kq7w");
    await expect(table.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await expect(table.getByRole("button", { name: "Replace the token of Lyre Table" })).toBeVisible();
  });

  test("Disconnect and Connect a bot", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    const side = bots(page).getByRole("group", { name: "Lyre Side" });
    await side.getByRole("button", { name: "Disconnect" }).click();
    await expect(side).toContainText("Not connected");
    await side.getByRole("button", { name: "Connect" }).click();
    await expect(side).toContainText("Connected", { timeout: 5000 });
  });

  test("Replace… takes a new token and shows only its last four characters", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    const side = bots(page).getByRole("group", { name: "Lyre Side" });
    await side.getByRole("button", { name: "Replace the token of Lyre Side" }).click();
    await side.getByLabel("New token for Lyre Side").fill("MTAx.secret-part.wxyz");
    await side.getByRole("button", { name: "Save" }).click();
    await expect(side).toContainText("••••••••wxyz");
    await expect(side).not.toContainText("secret-part");
  });

  test("Remove is behind the bot's ⋯ menu, with an Undo", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "More for Lyre Side" }).click();
    await page.getByRole("menuitem", { name: "Remove Lyre Side" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Side" })).toHaveCount(0);
    await page.getByRole("group", { name: "Undo" }).getByRole("button", { name: "Undo" }).click();
    await expect(bots(page).getByRole("group", { name: "Lyre Side" })).toBeVisible();
  });

  test("the other settings Lyre still needs are here; the rare ones are folded", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    // Round 7: Sound to Discord is set once, so it is folded with the other rare settings.
    for (const name of ["Sound to Discord", "Headphones and speakers", "Remote control", "Keyboard shortcuts", "Website tabs", "Local files"]) {
      await expect(region(page, name).getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "false");
    }
    await region(page, "Sound to Discord").getByRole("button", { name: "Sound to Discord", exact: true }).click();
    // One of the two modes is chosen (the app keeps Kenku FM's default, Lighter on the computer; the prototype's is Best).
    await expect(region(page, "Sound to Discord").getByRole("radio", { checked: true })).toHaveCount(1);
    await region(page, "Website tabs").getByRole("button", { name: "Website tabs", exact: true }).click();
    await expect(region(page, "Website tabs").getByRole("switch", { name: "Use several inputs at once" })).toBeDisabled();
    await region(page, "Website tabs").getByRole("switch", { name: "Microphones and other inputs" }).check();
    await expect(region(page, "Website tabs").getByRole("switch", { name: "Use several inputs at once" })).toBeEnabled();
  });
});

test.describe("Add a bot, in the order Discord needs", () => {
  // Round 6 part 2 (OUT-8): Settings in Lyre is a round 6 screen, not built in the app yet.
  test.beforeEach(() => expectFailureUntilBuilt("rooms-settings"));
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

  test("UX-R11: a wrong Application ID and a missing token are said under their fields; Open the invite stays off", async ({ page }) => {
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    const id = sheet(page).getByLabel("Application ID");
    await id.fill("abc123");
    await expect(id).toHaveValue("abc123");
    await expect(id).toHaveAttribute("aria-invalid", "true");
    await expect(sheet(page)).toContainText("An Application ID is a long number: copy it from General Information.");
    await expect(sheet(page).getByRole("link", { name: "Open the invite" })).toHaveAttribute("aria-disabled", "true");
    await id.fill("123456789012345678");
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await sheet(page).getByRole("button", { name: "Connect", exact: true }).click();
    await expect(sheet(page).getByRole("alert")).toContainText("Paste the token first");
    await expect(sheet(page).getByLabel("Token", { exact: true })).toBeFocused();
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

/* Round 6, part 4 (design/prototype/ROUND6.md "Part 4: review fixes", Could 17): where to find each thing comes before
   the field it goes in, and the token step says Discord shows the token once. */
test.describe("round 6, part 4: Add a bot in the order it is done", () => {
  test("step 2 says where the Application ID is before its field; step 3 says Discord shows the token once", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    await bots(page).getByRole("button", { name: "Add a bot" }).click();
    await sheet(page).getByRole("button", { name: "Next" }).click();
    const where = await sheet(page).getByText("General Information › Application ID › Copy").boundingBox();
    const field = await sheet(page).getByLabel("Application ID").boundingBox();
    expect(where!.y).toBeLessThan(field!.y);
    await sheet(page).getByLabel("Application ID").fill("123456789012345678");
    await sheet(page).getByRole("button", { name: "Next" }).click();
    await expect(sheet(page)).toContainText("Discord shows it once.");
  });
});

/* Round 7 (design/prototype/ROUND7.md): the remote control's secret code (SEC-4), headphones and speakers (PRV-2),
   the default crossfade (PLY-8) and keyboard shortcuts (UX-12). */
const unfold = async (page: Page, name: string) => {
  const b = region(page, name).getByRole("button", { name, exact: true });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  return region(page, name);
};

test.describe("round 7: remote control needs a secret code", () => {
  test.beforeEach(() => expectFailureUntilBuilt("rooms-settings"));

  test("is off by default; on, it shows the code to type on the other device and listens on this computer only", async ({ page }) => {
    await openRoute(page, "settings");
    const box = await unfold(page, "Remote control");
    const on = box.getByRole("switch", { name: "Let other devices control Lyre" });
    await expect(on).not.toBeChecked();
    await expect(box.getByRole("group", { name: "Secret code" })).toHaveCount(0);
    await on.check();
    await expect(box.getByRole("group", { name: "Secret code" })).toContainText(/^.*[A-Z0-9]{4}-[A-Z0-9]{4}/);
    await expect(box.getByRole("radio", { name: "This computer only" })).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: "Saved: remote control on" })).toBeVisible();
  });

  test("Make a new code replaces the code, so the old one stops working", async ({ page }) => {
    await openRoute(page, "settings");
    const box = await unfold(page, "Remote control");
    await box.getByRole("switch", { name: "Let other devices control Lyre" }).check();
    const code = box.getByRole("group", { name: "Secret code" }).locator("output");
    const before = await code.textContent();
    await box.getByRole("button", { name: "Make a new code" }).click();
    await expect(code).not.toHaveText(before ?? "");
    await expect(page.getByRole("status").filter({ hasText: /new remote control code/ })).toBeVisible();
  });

  test("it can listen on the home network instead, for a phone or tablet", async ({ page }) => {
    await openRoute(page, "settings");
    const box = await unfold(page, "Remote control");
    await box.getByRole("switch", { name: "Let other devices control Lyre" }).check();
    await box.getByRole("radio", { name: "Your home network" }).check();
    await expect(box.getByRole("radio", { name: "Your home network" })).toBeChecked();
    await expect(box).toContainText(/192\.168\./);
  });
});

test.describe("round 7: headphones and speakers", () => {
  test("the preview has its own device, remembered; no On air device (lead decision, 7 Nov: heard only through Discord)", async ({ page }) => {
    // The app lists the computer's own devices; test builds add the prototype's stand-ins (src/lyre/audio/standInDevices.ts),
    // since the e2e machine has none. Playing on a stand-in falls back to the default device.
    expectFailureUntilBuilt("live", "rooms-settings");
    await openRoute(page, "settings");
    const box = await unfold(page, "Headphones and speakers");
    await box.getByRole("combobox", { name: "Preview (only you)" }).selectOption("Headset (Arctis 7)");
    await expect(page.getByRole("status").filter({ hasText: "Saved: preview plays on Headset (Arctis 7)" })).toBeVisible();
    await expect(box.getByRole("combobox", { name: "On air, on this computer" })).toHaveCount(0);
  });

  test("one headset can be split: the preview in one ear, On air in the other", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings"); // w6-rooms: passes without Live (it was marked live too)
    await openRoute(page, "settings");
    const box = await unfold(page, "Headphones and speakers");
    await expect(box.getByRole("radio", { name: "Preview in the left ear" })).toHaveCount(0);
    await box.getByRole("switch", { name: "Split one headset" }).check();
    await expect(box.getByRole("radio", { name: "Preview in the left ear" })).toBeChecked();
    await box.getByRole("radio", { name: "Preview in the right ear" }).check();
    await expect(box.getByRole("radio", { name: "Preview in the right ear" })).toBeChecked();
  });
});

test.describe("round 7: crossfade and keyboard shortcuts", () => {
  test("the crossfade between tracks has a default, in Sound to Discord", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings"); // w6-rooms: passes without Live (it was marked live too)
    await openRoute(page, "settings");
    const box = await unfold(page, "Sound to Discord");
    const x = box.getByRole("combobox", { name: "Between tracks" });
    await expect(x).toHaveValue("3");
    await x.selectOption("5");
    await expect(page.getByRole("status").filter({ hasText: "Saved: crossfade between tracks 5 s" })).toBeVisible();
  });

  test("every shortcut is listed with its key; one can be changed by pressing the new key, and reset", async ({ page }) => {
    expectFailureUntilBuilt("shell", "rooms-settings"); // w6-rooms: needs the shell's Find and play, not Live
    await openRoute(page, "settings");
    const box = await unfold(page, "Keyboard shortcuts");
    const palette = box.getByRole("row", { name: /^Find and play/ });
    await expect(palette).toContainText("Ctrl+K");
    await expect(box.getByRole("row", { name: /^Next scene/ })).toContainText("Space");
    await palette.getByRole("button", { name: "Change the key for Find and play" }).click();
    await expect(palette).toContainText("Press the new key");
    await page.keyboard.press("Control+J");
    await expect(palette).toContainText("Ctrl+J");
    await page.keyboard.press("Control+J");
    await expect(page.getByRole("dialog", { name: "Find and play" })).toBeVisible();
    await page.keyboard.press("Escape");
    await box.getByRole("button", { name: "Put back Lyre's keys" }).click();
    await expect(palette).toContainText("Ctrl+K");
  });

  test("a key already in use is refused, and Esc keeps the old key", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings");
    await openRoute(page, "settings");
    const box = await unfold(page, "Keyboard shortcuts");
    const palette = box.getByRole("row", { name: /^Find and play/ });
    await palette.getByRole("button", { name: "Change the key for Find and play" }).click();
    await page.keyboard.press("Shift+Escape");
    await expect(page.getByRole("status").filter({ hasText: /Shift\+Esc is already Fade all/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toContainText("Ctrl+K");
  });

  test("a printable sheet lists every key", async ({ page }) => {
    expectFailureUntilBuilt("rooms-settings"); // w6-rooms: passes without Live (it was marked live too)
    await openRoute(page, "settings");
    const box = await unfold(page, "Keyboard shortcuts");
    await box.getByRole("button", { name: "Printable sheet" }).click();
    const sheetBox = page.getByRole("dialog", { name: "Lyre's keys" });
    await expect(sheetBox.getByRole("table")).toContainText("Fade all"); // UX-R15: one name
    await expect(sheetBox.getByRole("button", { name: "Print" })).toBeVisible();
  });
});

/* 0.5.0 usability review (UX-R16): ROUND6 part 4 #18, the app shows its own version. */
test.describe("Settings shows Lyre's version", () => {
  test("UX-R16: the version is at the top right of Settings", async ({ page }) => {
    await openRoute(page, "settings");
    await expect(page.getByTitle("Lyre version")).toHaveText(/^\d+\.\d+\.\d+/);
  });
});
