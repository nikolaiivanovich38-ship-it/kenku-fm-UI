/**
 * Round 5 (design/prototype/ROUND5.md, src/views/transfer.js): the library as a file (DAT-7), what came across from
 * Kenku FM, and finding missing files (DAT-8). Three new screens, reached from the ⋯ beside Add tracks in the Library.
 * The sample library has three files that moved (t19, t26, t37); the sample file to open is "Curse of Strahd from Sam.lyre".
 */
import type { Page } from "@playwright/test";
import { expect, expectFailureUntilBuilt, test } from "./support/test";
import { arriveFromKenkuFM, openRoute } from "./support/target";
import { dropFiles } from "./support/drop";

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.describe("DAT-7 back up, move or share", () => {
  test("saves the whole library to one file, without the audio files unless asked", async ({ page }) => {
    // The message names the file and its real size; the prototype's "2 MB" was a made-up figure (lead's decision, 6 Nov).
    await openRoute(page, "backup");
    const save = region(page, "Save to a file");
    await expect(save.getByRole("radio", { name: /^The whole library/ })).toBeChecked();
    await expect(save.getByRole("checkbox", { name: /^Include the audio files/ })).not.toBeChecked();
    await save.getByRole("button", { name: "Save to a file…" }).click();
    await expect(save.getByRole("status")).toContainText(/Saved Lyre library \d{4}-\d{2}-\d{2}\.lyre \(\d+(\.\d+)? (KB|MB)\)/);
  });

  test("saves one playlist, campaign, session, scene, pad board or the tags, with the audio files if ticked", async ({ page }) => {
    await openRoute(page, "backup");
    const save = region(page, "Save to a file");
    await expect(save.getByRole("radio")).toHaveCount(7);
    await save.getByRole("radio", { name: /^One playlist/ }).check();
    await save.getByRole("combobox", { name: "Which playlist" }).selectOption({ label: "The Abbess" });
    await save.getByRole("checkbox", { name: /^Include the audio files/ }).check();
    await expect(save).toContainText("About 45 MB");
    await save.getByRole("button", { name: "Save to a file…" }).click();
    await expect(save.getByRole("status")).toContainText("Saved The Abbess.lyre (45 MB)");
  });

  test("opening a file shows what is in it, and each duplicate can be skipped, merged or kept as well", async ({ page }) => {
    await openRoute(page, "backup");
    const open = region(page, "Open a file");
    await open.getByRole("button", { name: "Choose a file…" }).click();
    await expect(open).toContainText("Curse of Strahd from Sam.lyre");
    const items = open.getByRole("list", { name: "What is in the file" }).getByRole("listitem");
    await expect(items).toHaveCount(7);
    const gothic = open.getByRole("radiogroup", { name: "Playlist Gothic dread: you have this already" });
    await expect(gothic.getByRole("radio", { name: "Skip" })).toHaveAttribute("aria-checked", "true");
    await gothic.getByRole("radio", { name: "Merge" }).click();
    await expect(gothic.getByRole("radio", { name: "Merge" })).toHaveAttribute("aria-checked", "true");
    await open.getByRole("button", { name: "Keep both for every item you have already" }).click();
    await expect(open.getByRole("radio", { name: "Keep both", checked: true })).toHaveCount(3);
    await open.getByRole("button", { name: "Bring in" }).click();
    await expect(open.getByRole("status")).toContainText("Brought in Curse of Strahd");
    await expect(open.getByRole("status")).toContainText('3 copies named "(from Sam)"');
  });

  test("a file that is not a Lyre file, or is damaged, is refused with a clear message and nothing changes", async ({ page }) => {
    await openRoute(page, "backup");
    const open = region(page, "Open a file");
    await dropFiles(open.getByText("Drop a Lyre file here, or"), ["notes.txt"], { type: "text/plain" });
    await expect(open.getByRole("alert")).toHaveText('"notes.txt" is not a Lyre file. Lyre opens files saved with Save to a file (they end in .lyre).');
    await dropFiles(open.getByText("Drop a Lyre file here, or"), ["broken.lyre"], { type: "application/octet-stream" });
    await expect(open.getByRole("alert")).toContainText('"broken.lyre" is damaged');
    await expect(open.getByRole("alert")).toContainText("Nothing was brought in.");
    await expect(open.getByRole("button", { name: "Bring in" })).toHaveCount(0);
  });
});

test.describe("what came across from Kenku FM", () => {
  test("says what was copied and where it is now, which files Lyre cannot find, and what did not come across", async ({ page }) => {
    await openRoute(page, "moved");
    const what = region(page, "What came across");
    await expect(what).toContainText("Kenku FM 1.5.5");
    // The Bookmarks row changed in 0.5.1 (checked below with the Bookmarks box).
    const rows = what.getByRole("row");
    for (const [i, text] of [/In Kenku FM\s*How many\s*Now in Lyre/, /Playlists\s*9\s*Playlists \(Manual\)/, /Tracks\s*212\s*Library/, /Soundboards\s*4\s*Pad boards/, /Sounds\s*37\s*Pads on those boards/].entries()) {
      await expect(rows.nth(i)).toHaveText(text);
    }
    await expect(region(page, "Files Lyre cannot find").getByRole("listitem")).toHaveCount(3);
    await expect(region(page, "Not brought across")).toContainText("The play queue and what was playing");
    await region(page, "Files Lyre cannot find").getByRole("link", { name: "Find them…" }).click();
    await expect(page.getByRole("heading", { name: "Find missing files", level: 1 })).toBeVisible();
  });
});

/* 0.5.1 (design/prototype/ROUND8.md): website tabs are gone from Lyre (Nik, 11 Nov: "Keep the code, remove them from
   the interface"), so the old bookmarks are listed once on What came across, each with Copy. */
test.describe("0.5.1: the old bookmarks, to copy", () => {
  test.beforeEach(() => expectFailureUntilBuilt("retire"));

  test("a Bookmarks box lists each bookmark's title and address with Copy, and says websites can't be opened in Lyre for now", async ({ page }) => {
    await openRoute(page, "moved");
    await expect(region(page, "What came across").getByRole("row", { name: /^Bookmarks/ })).toHaveText(/Bookmarks\s*6\s*Listed to copy/);
    const box = region(page, "Bookmarks");
    await expect(box).toContainText("Websites can't be opened in Lyre for now.");
    const items = box.getByRole("list", { name: "Bookmarks from Kenku FM" }).getByRole("listitem");
    await expect(items).toHaveCount(6);
    await expect(items.first()).toContainText("YouTube");
    await expect(items.first()).toContainText("https://www.youtube.com/");
    await items.first().getByRole("button", { name: "Copy the address of YouTube" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Copied: https://www.youtube.com/" })).toBeVisible();
  });

  test("with no bookmarks, there is no Bookmarks box and no Bookmarks row", async ({ page }) => {
    await arriveFromKenkuFM(page, { bookmarks: [] }, "moved");
    await expect(region(page, "What came across")).toBeVisible();
    await expect(region(page, "Bookmarks")).toHaveCount(0);
    await expect(region(page, "What came across").getByRole("row", { name: /^Bookmarks/ })).toHaveCount(0);
  });

  test("bookmarks brought from Kenku FM are the ones listed", async ({ page }) => {
    await arriveFromKenkuFM(page, { bookmarks: [{ title: "Tabletop Audio", url: "https://tabletopaudio.com/" }] }, "moved");
    const items = region(page, "Bookmarks").getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Tabletop Audio");
    await expect(items.first()).toContainText("https://tabletopaudio.com/");
  });
});

test.describe("DAT-8 find missing files", () => {
  test("looks in a folder, matches by file name and size, and asks before relinking", async ({ page }) => {
    await openRoute(page, "relink");
    await expect(region(page, "Missing files").getByRole("row")).toHaveCount(4);
    const look = region(page, "Look in a folder");
    await look.getByRole("textbox", { name: "Look in this folder (and the folders inside it)" }).fill("E:\\Music\\Scores");
    await look.getByRole("button", { name: "Look there" }).click();
    await expect(look.getByRole("checkbox", { name: "Relink Storm and dark romance, swells - villain's tragic backstory" })).toBeChecked();
    await expect(look.getByRole("checkbox", { name: "Relink Ominous song, the villain's calling card (short)" })).not.toBeChecked();
    await expect(look).toContainText("Same name and size");
    await expect(look).toContainText("Same name, different size: check it");
    await expect(look).toContainText("Not in that folder");
    await look.getByRole("button", { name: "Relink 1 file" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Relinked 1 file to E:\\Music\\Scores." }).first()).toBeVisible();
    await expect(region(page, "Missing files").getByRole("row")).toHaveCount(3);
  });

  test("Undo puts the files back as missing", async ({ page }) => {
    await openRoute(page, "relink");
    await region(page, "Look in a folder").getByRole("button", { name: "Look there" }).click();
    await region(page, "Look in a folder").getByRole("button", { name: "Relink 1 file" }).click();
    await page.getByRole("group", { name: "Undo" }).getByRole("button", { name: "Undo" }).click();
    await expect(region(page, "Missing files").getByRole("row")).toHaveCount(4);
  });
});
