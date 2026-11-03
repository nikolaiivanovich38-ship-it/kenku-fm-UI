/**
 * SEC-7: stop files and links dropped on an app page from navigating it.
 *
 * Chromium's default for a file or link dropped on a page is to open it in
 * that page, which would replace one of the app's privileged pages. Drop zones
 * handle their events before they bubble up to the document, so they keep
 * working; text and links dropped into a text field are also left alone, so
 * the browser inserts them as text. A cancelled drag shows the "no drop"
 * cursor.
 * @returns a function that removes the guard
 */
export function installDocumentDropGuard(doc: Document): () => void {
  const guard = (event: Event) => {
    const dataTransfer = (event as DragEvent).dataTransfer;
    const types = Array.from(dataTransfer?.types ?? []);
    const hasFiles = types.includes("Files");
    if (!hasFiles && isTextField(event.target)) {
      return;
    }
    event.preventDefault();
    // Show the "no drop" cursor instead of promising a drop that does nothing.
    if (dataTransfer) {
      dataTransfer.dropEffect = "none";
    }
  };
  doc.addEventListener("dragover", guard);
  doc.addEventListener("drop", guard);
  return () => {
    doc.removeEventListener("dragover", guard);
    doc.removeEventListener("drop", guard);
  };
}

function isTextField(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || element.isContentEditable;
}
