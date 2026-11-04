/**
 * UX finding 12: after an action removes or moves the item that had focus
 * (Move to folder…, Delete folder), focus goes to the item that came after it,
 * or to the section's heading, instead of being lost to the page.
 *
 * Mark the parts of a list with data attributes:
 * - `data-focus-section` on the list's container,
 * - `data-focus-heading` on the control that heads it,
 * - `data-focus-item` on each item (a folder includes its bookmarks),
 * - `data-focus-row="<id>"` on each item's main control.
 */
export function focusNextRowLater(from: Element | null): void {
  const section = from?.closest<HTMLElement>("[data-focus-section]");
  const item = from?.closest("[data-focus-item]");
  if (!section || !item) {
    return;
  }
  const rows = () => Array.from(section.querySelectorAll<HTMLElement>("[data-focus-row]"));
  const next = rows().find(
    (row) => !item.contains(row) && Boolean(item.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  const key = next?.dataset.focusRow;
  // After React has drawn the change, and after the closing menu has tried to
  // give focus back to its (now removed) button.
  setTimeout(() => {
    const target = (key && rows().find((row) => row.dataset.focusRow === key)) || null;
    (target ?? section.querySelector<HTMLElement>("[data-focus-heading]"))?.focus();
  }, 0);
}
