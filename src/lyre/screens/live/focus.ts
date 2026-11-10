/**
 * Where focus goes after a change on the Live screen: controls are found by their data-lv (the prototype's data-k), so
 * focus lands on the same control after the screen redraws, or once it is drawn (a box that was folded).
 */
export function focusLive(key: string): void {
  // A menu button keeps its key in data-k (PopMenuButton's dataK).
  const find = () => document.querySelector<HTMLElement>(`#view [data-lv="${key}"], #view [data-k="${key}"]`);
  const now = find();
  if (now) now.focus({ preventScroll: true });
  else setTimeout(() => find()?.focus({ preventScroll: true }));
}

/** Focus a box's header (Alt+1 to Alt+7, F6), scrolled into view. Returns its words, for the screen reader. */
export function focusBox(id: string): string | null {
  const toggle = document.querySelector<HTMLElement>(`#view [data-pane="${id}"] .pane-toggle`);
  if (!toggle) return null;
  toggle.focus();
  toggle.scrollIntoView?.({ block: "nearest" });
  return `${toggle.textContent?.trim() ?? ""}${toggle.getAttribute("aria-expanded") === "false" ? ", folded" : ""}`;
}
