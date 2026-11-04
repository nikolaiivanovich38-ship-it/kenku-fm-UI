/** Drop files onto an element the way the browser does (a real DataTransfer holding File objects). Works on any target. */
import type { Locator } from "@playwright/test";

export async function dropFiles(target: Locator, names: string[], options: { type?: string } = {}): Promise<void> {
  await target.evaluate(
    (el, { names, type }) => {
      const data = new DataTransfer();
      for (const name of names) data.items.add(new File(["x"], name, { type }));
      const box = el.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 40, clientY: box.top + box.height / 2 };
      const over = document.elementFromPoint(init.clientX, init.clientY) ?? el;
      over.dispatchEvent(new DragEvent("dragenter", init));
      over.dispatchEvent(new DragEvent("dragover", init));
      over.dispatchEvent(new DragEvent("drop", init));
    },
    { names, type: options.type ?? "audio/flac" },
  );
}
