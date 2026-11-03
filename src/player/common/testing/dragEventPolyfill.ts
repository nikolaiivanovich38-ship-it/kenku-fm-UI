/**
 * jsdom has no DragEvent, so Testing Library falls back to a plain Event and
 * drops `relatedTarget`. The drag-overlay tests (BUG-1) need relatedTarget to
 * tell "left the window" (null) from "moved onto a child element", so this
 * installs a minimal DragEvent built on jsdom's MouseEvent.
 */
export function installDragEventPolyfill() {
  if (typeof window.DragEvent === "function") {
    return;
  }
  class DragEventPolyfill extends MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  }
  Object.defineProperty(window, "DragEvent", {
    configurable: true,
    writable: true,
    value: DragEventPolyfill,
  });
}
