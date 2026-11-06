/**
 * Outputs: the rooms (Discord voice channels) the bots play into, and moving a bot between them on the fly
 * (design/prototype/tools/op-flow.js, tab-outputs.js and src/views/outputs.js).
 * A room is named after its voice channel; each shows which bot is in it, who hears it and its volume.
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { joinRoom, openRoute } from "./support/target";

const room = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const channels = (page: Page) => page.getByRole("region", { name: "All voice channels", exact: true });

test.describe("the rooms", () => {
  test("shows a box for each bot that is in a room, named after the room, with its bot, where it is and who hears it", async ({ page }) => {
    await openRoute(page, "outputs");
    const table = room(page, "Table");
    await expect(table.getByText("Silent")).toBeVisible();
    await expect(table).toContainText("via Lyre Table");
    await expect(table.getByRole("button", { name: "Room The Gull and Lantern › Table" })).toBeVisible();
    await expect(table).toContainText("Hears it");
    await expect(table).toContainText("5 people: Nik, Aster, Bram, Corin, Dalia");
  });

  test("a bot that is not in a room has its own box saying Not in a room, with a way to choose one", async ({ page }) => {
    await openRoute(page, "outputs");
    const side = room(page, "Lyre Side");
    await expect(side.getByText("Not in a room")).toBeVisible();
    await expect(side.getByRole("button", { name: "Room Choose a room…" })).toBeVisible();
  });

  test("the heading counts the bots that are in rooms, and the list of all voice channels shows who is in each", async ({ page }) => {
    await openRoute(page, "outputs");
    await expect(channels(page)).toContainText("6 channels in 2 servers");
    await expect(channels(page)).toContainText("1 of 2 bots in rooms");
    await expect(room(page, "The Gull and Lantern")).toContainText("Table");
    // Round 6 (OUT-7): "Bring a bot to" is "Add bot to"; this check reads either.
    await expect(channels(page).getByRole("button", { name: /^(Bring a bot to|Add bot to) Whispers$/ })).toBeVisible();
    await expect(channels(page).getByText("AFK")).toBeVisible();
  });

  test("the rail shows how many outputs are connected", async ({ page }) => {
    await openRoute(page, "outputs");
    await expect(page.getByRole("link", { name: /^(Outputs|Rooms) \(1\/2\)$/ })).toBeVisible();
  });
});

test.describe("moving a bot between rooms", () => {
  test("a bot that is not in a room can be sent to one from its Room menu, and its box takes the room's name", async ({ page }) => {
    await openRoute(page, "outputs");
    await room(page, "Lyre Side").getByRole("button", { name: "Room Choose a room…" }).click();
    const menu = page.getByRole("menu", { name: "Room for Lyre Side" });
    await expect(menu.getByRole("menuitemradio", { name: /^Table 5 people Lyre Table is here: players would hear it twice/ })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /^Whispers Empty: nobody would hear it/ })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: /^Side room/ }).click();
    await expect(room(page, "Side room")).toBeVisible({ timeout: 5000 });
    await expect(room(page, "Side room")).toContainText("via Lyre Side");
    await expect(room(page, "Side room")).toContainText("Nobody here yet");
    await expect(page.getByRole("link", { name: /^(Outputs|Rooms) \(2\/2\)$/ })).toBeVisible();
  });

  test("a bot that is already in a room is moved to another room on the fly; its old room goes", async ({ page }) => {
    await openRoute(page, "outputs");
    await room(page, "Table").getByRole("button", { name: /^Room / }).click();
    await page.getByRole("menuitemradio", { name: /^Whispers/ }).click();
    await expect(room(page, "Whispers")).toBeVisible({ timeout: 5000 });
    await expect(room(page, "Table")).toHaveCount(0);
    await expect(room(page, "Whispers")).toContainText("via Lyre Table");
  });

  test("the Room menu works from the keyboard: Enter opens it, arrows choose, Enter moves the bot", async ({ page }) => {
    await openRoute(page, "outputs");
    await room(page, "Lyre Side").getByRole("button", { name: /^Room / }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Room for Lyre Side" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^(Outputs|Rooms) \(2\/2\)$/ })).toBeVisible({ timeout: 5000 });
  });

  test("Bring… (round 6: Add bot) on a voice channel in the list brings a bot there", async ({ page }) => {
    expectFailureUntilBuilt("round 6"); // OUT-7: one click with one free bot, no menu
    await openRoute(page, "outputs");
    await channels(page).getByRole("button", { name: "Add bot to Whispers" }).click();
    await expect(room(page, "Whispers")).toBeVisible({ timeout: 5000 });
  });

  test("two bots can swap rooms with one button once both are in rooms", async ({ page }) => {
    await openRoute(page, "outputs");
    await joinRoom(page, "Lyre Side", "Side room");
    await page.getByRole("button", { name: "Swap rooms" }).click();
    await expect(room(page, "Table")).toContainText("via Lyre Side", { timeout: 5000 });
    await expect(room(page, "Side room")).toContainText("via Lyre Table", { timeout: 5000 });
  });

  test("Leave takes a bot out of its room and gives it a Not in a room box again", async ({ page }) => {
    await openRoute(page, "outputs");
    // Round 6 (OUT-7): Leave is Kick (×); this check reads either.
    await room(page, "Table").getByRole("button", { name: /^(Lyre Table: leave Table|Kick Lyre Table from Table)$/ }).click();
    await expect(room(page, "Table")).toHaveCount(0);
    await expect(room(page, "Lyre Table").getByText("Not in a room")).toBeVisible();
  });

  test("a bot that joins from Discord shows up at once", async ({ page }) => {
    await openRoute(page, "outputs");
    await joinRoom(page, "Lyre Side", "Whispers");
    await expect(room(page, "Whispers")).toContainText("via Lyre Side");
  });
});

test.describe("mute, volume and test", () => {
  test("Mute stops a room being heard and the status says Muted", async ({ page }) => {
    await openRoute(page, "outputs");
    const table = room(page, "Table");
    await table.getByRole("button", { name: "Mute Table" }).click();
    await expect(table.getByText("Muted")).toBeVisible();
  });

  test("each room has a volume slider that works from the keyboard and shows its percentage", async ({ page }) => {
    await openRoute(page, "outputs");
    const volume = room(page, "Table").getByRole("slider", { name: "Volume" });
    await expect(volume).toHaveValue("85");
    await volume.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(volume).toHaveValue("80");
    await expect(room(page, "Table")).toContainText("80%");
  });

  test("Test plays a short chime in that room only and says so", async ({ page }) => {
    await openRoute(page, "outputs");
    await room(page, "Table").getByRole("button", { name: "Test Table: a short chime in this room only" }).click();
    await expect(page.getByText("Test chime in Table only (5 people there)")).toBeVisible();
  });
});

test.describe("outputs and the live game", () => {
  test("the Prep | Live switch is here too, with Prep pressed", async ({ page }) => {
    // Ends on Live's On air box.
    expectFailureUntilBuilt("live");
    await openRoute(page, "outputs");
    const modes = page.getByRole("group", { name: "Prep or live" });
    await expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await modes.getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("region", { name: "On air", exact: true }).getByRole("group", { name: "Table", exact: true })).toBeVisible();
  });

  test("a room that a bot is moved to on the Outputs screen also gets its On air box in Live", async ({ page }) => {
    expectFailureUntilBuilt("live");
    await openRoute(page, "outputs");
    await joinRoom(page, "Lyre Side", "Whispers");
    await page.getByRole("group", { name: "Prep or live" }).getByRole("button", { name: "Live" }).click();
    await expect(page.getByRole("region", { name: "On air", exact: true }).getByRole("group", { name: "Whispers", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "On air", exact: true }).getByRole("group", { name: "Table", exact: true })).toBeVisible();
  });
});

/* Round 6, part 2 (design/prototype/ROUND6.md, "Your notes on 0.4.0"): Nik found Bring… confusing and too many
   clicks. Each voice channel has Add bot and each bot in it a Kick (×). Not built yet. */
test.describe("round 6: Add bot and Kick in the voice channels", () => {
  test.beforeEach(() => expectFailureUntilBuilt("round 6"));

  test("OUT-7: no Bring…; each bot in a channel has its own Kick, and a channel with no bot has Add bot", async ({ page }) => {
    await openRoute(page, "outputs");
    await expect(channels(page).getByRole("button", { name: /^Bring/ })).toHaveCount(0);
    await expect(channels(page).getByRole("button", { name: "Kick Lyre Table from Table" })).toBeVisible();
    await expect(channels(page).getByRole("button", { name: "Add bot to Table" })).toHaveCount(0);
    await expect(channels(page).getByRole("button", { name: "Add bot to Side room" })).toBeVisible();
  });

  test("OUT-7: with one free bot, Add bot puts it in the channel in one click; Kick takes it out in one", async ({ page }) => {
    await openRoute(page, "outputs");
    await channels(page).getByRole("button", { name: "Add bot to Side room" }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(room(page, "Side room")).toContainText("via Lyre Side", { timeout: 5000 });
    await channels(page).getByRole("button", { name: "Kick Lyre Side from Side room" }).click();
    await expect(room(page, "Side room")).toHaveCount(0);
    await expect(room(page, "Lyre Side").getByText("Not in a room")).toBeVisible();
  });

  test("OUT-7: with two free bots, Add bot offers a short choice of them", async ({ page }) => {
    await openRoute(page, "outputs");
    await channels(page).getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    await channels(page).getByRole("button", { name: "Add bot to Whispers" }).click();
    const menu = page.getByRole("menu", { name: "Add a bot to Whispers" });
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await menu.getByRole("menuitem", { name: /^Lyre Side/ }).click();
    await expect(room(page, "Whispers")).toContainText("via Lyre Side", { timeout: 5000 });
  });

  test("OUT-7: kicking a bot the players are hearing asks nothing, and Undo puts it back with its music", async ({ page }) => {
    await openRoute(page, "campaign/crown");
    await page.getByRole("region", { name: "Campaign playlists", exact: true }).getByRole("button", { name: "Play on air: The Company themes" }).click();
    await page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: /^(Outputs|Rooms)/ }).click();
    await channels(page).getByRole("button", { name: "Kick Lyre Table from Table" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(room(page, "Table")).toHaveCount(0);
    await page.getByRole("group", { name: "Undo" }).getByRole("button", { name: "Undo" }).click();
    await expect(room(page, "Table")).toContainText("Epic choir hero anthem", { timeout: 5000 });
  });

  test("OUT-8, UX-18: Tokens and new bots opens Settings, and Back returns to Outputs", async ({ page }) => {
    await openRoute(page, "outputs");
    await page.getByRole("link", { name: "Tokens and new bots" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await page.getByRole("button", { name: /^Back to (Outputs|Rooms)$/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Outputs|Rooms)$/);
  });
});

/* Round 6, part 4 (design/prototype/ROUND6.md "Part 4: review fixes", Should 13; Nik, 6 Nov 13:55: "room"
   everywhere, and Outputs is renamed Rooms). The address stays #/outputs. */
test.describe("round 6, part 4: the screen is Rooms", () => {
  test("the menu, the screen's title and Back say Rooms", async ({ page }) => {
    expectFailureUntilBuilt("round 6");
    await openRoute(page, "outputs");
    await expect(page.getByRole("navigation", { name: "Lyre" }).getByRole("link", { name: "Rooms (1/2)" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rooms");
    await page.getByRole("link", { name: "Tokens and new bots" }).click();
    await expect(page.getByRole("button", { name: "Back to Rooms" })).toBeVisible();
  });
});
