/**
 * BUG-16 (w31-fix) in the packaged app: while configuring a pad, every icon can be chosen, by mouse and by keyboard,
 * and the choice is kept, even when the same icon is clicked again before the library has saved it.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { openLyreRoute } from "./fixtures/lyre";

const SEEDED = { CUE_DESK_LYRE_SEED: "prototype", CUE_DESK_FAKE_DISCORD: "1" };

/** The first pad's icon as the library has it. */
async function savedIcon(lyre: Page): Promise<string> {
  return lyre.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boards = (await (window as any).lyre.api.call("boards", "list", [])) as { id: string; slots: ({ icon: string } | null)[] }[];
    return boards.find((b) => b.id === "weather")?.slots[0]?.icon ?? "";
  });
}

test("every pad icon can be picked in turn by mouse and by keyboard, and each choice is kept (BUG-16)", async ({ launchApp }) => {
  test.setTimeout(120_000);
  const launched = await launchApp({ env: SEEDED });
  const lyre = await openLyreRoute(await launched.mainWindow(), "board/weather");
  const icons = lyre.getByRole("group", { name: /^Icon / });
  await icons.waitFor();
  const radios = icons.getByRole("radio");
  const values = await radios.evaluateAll((all) => all.map((r) => (r as HTMLInputElement).value));
  expect(values.length).toBeGreaterThan(20);

  // By mouse: each icon twice in quick succession (a second click before the first is saved must not be lost).
  for (const [i, value] of values.entries()) {
    const label = icons.locator("label").nth(i);
    await label.click();
    await label.click();
    await expect(radios.nth(i), value).toBeChecked();
    await expect.poll(() => savedIcon(lyre), { message: `${value} saved` }).toBe(value);
  }

  // By keyboard: from the last icon, Left arrow chooses each one before it in turn.
  await radios.nth(values.length - 1).focus();
  for (let i = values.length - 2; i >= 0; i--) {
    await lyre.keyboard.press("ArrowLeft");
    await expect(radios.nth(i), values[i]).toBeChecked();
    await expect(radios.nth(i)).toBeFocused();
  }
  await expect.poll(() => savedIcon(lyre)).toBe(values[0]);
  await expect(icons).toHaveAccessibleName(/^Icon Crossed swords/);
});
