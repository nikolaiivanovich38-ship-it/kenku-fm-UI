/**
 * Drop files onto an element the way the browser does (a real DataTransfer holding File objects). Works on any target.
 * w51-fix2: like the browser, it drops only when the dragover was taken and its drop effect is not "none" (the page's
 * drop guard used to turn a drop zone's "copy" to "none", and the Library took no drop from Windows Explorer).
 */
import { test, type Locator } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

import { writeAudioFile } from "../../fixtures/audio";

export async function dropFiles(target: Locator, names: string[], options: { type?: string } = {}): Promise<void> {
  if (test.info().project.name === "app") {
    await dropFilesFromDisk(target, names);
    return;
  }
  await target.evaluate(
    (el, { names, type }) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File(["x"], name, { type }));
      const box = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 40, clientY: box.top + box.height / 2 };
      const over = document.elementFromPoint(init.clientX, init.clientY) ?? el;
      over.dispatchEvent(new DragEvent("dragenter", init));
      // As the browser: a drop happens only where the dragover was taken and its drop effect is not "none".
      data.dropEffect = "copy";
      const taken = !over.dispatchEvent(new DragEvent("dragover", init));
      if (taken && data.dropEffect !== "none") over.dispatchEvent(new DragEvent("drop", init));
    },
    { names, type: options.type ?? "audio/flac" },
  );
}

/**
 * The app imports a dropped file from where it is on disk (the Lyre page's preload asks Electron's
 * webUtils.getPathForFile), and a File made in the page is nowhere on disk. So the app project writes small files with
 * those names to a new temporary folder, hands them to a file input as a file chooser would, and drops those File
 * objects. The importer refuses files that are not audio (UX review 3), so audio names get short real audio files
 * (fixtures/audio.ts) and other names a line of text.
 */
async function dropFilesFromDisk(target: Locator, names: string[]): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyre-drop-"));
  const paths = names.map((name) => {
    const file = path.join(dir, name);
    if (/\.(wav|mp3|flac|ogg|m4a|aiff?|wma|opus)$/i.test(name)) writeAudioFile(file);
    else fs.writeFileSync(file, "x");
    return file;
  });
  const page = target.page();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.id = "lyre-spec-drop";
    input.style.display = "none";
    document.body.append(input);
  });
  await page.locator("#lyre-spec-drop").setInputFiles(paths);
  await target.evaluate((el) => {
    const input = document.getElementById("lyre-spec-drop") as HTMLInputElement;
    const data = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) data.items.add(file);
    input.remove();
    const box = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 40, clientY: box.top + box.height / 2 };
    const over = document.elementFromPoint(init.clientX, init.clientY) ?? el;
    over.dispatchEvent(new DragEvent("dragenter", init));
    data.dropEffect = "copy";
    const taken = !over.dispatchEvent(new DragEvent("dragover", init));
    if (taken && data.dropEffect !== "none") over.dispatchEvent(new DragEvent("drop", init));
  });
}
