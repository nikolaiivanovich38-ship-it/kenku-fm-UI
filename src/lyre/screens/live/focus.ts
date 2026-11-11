import { focusSoon } from "../../kit/focusSoon";

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

/**
 * UX-R4: once the control in use goes, focus the first of these controls (by data-lv or data-k) that is drawn, never
 * the page. `move`: focus it as soon as it is drawn (a new room's bot button). See kit/focusSoon.
 */
export function focusLiveSoon(keys: readonly string[], options?: { move?: boolean; ms?: number }): void {
  focusSoon(
    keys.flatMap((key) => [`#view [data-lv="${key}"]`, `#view [data-k="${key}"]`]),
    options,
  );
}

/** Focus a box's header (Alt+1 to Alt+7, F6), scrolled into view. Returns its words, for the screen reader. */
export function focusBox(id: string): string | null {
  const toggle = document.querySelector<HTMLElement>(`#view [data-pane="${id}"] .pane-toggle`);
  if (!toggle) return null;
  toggle.focus();
  toggle.scrollIntoView?.({ block: "nearest" });
  return `${toggle.textContent?.trim() ?? ""}${toggle.getAttribute("aria-expanded") === "false" ? ", folded" : ""}`;
}
