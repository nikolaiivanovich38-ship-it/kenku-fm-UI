/**
 * FND-8: keys pressed in Help or the tour stay there, so a screen's single-key shortcuts (Live's Space, / and pad
 * keys) never fire from them. Keys with Ctrl, Alt or Meta, the F keys and Shift+Esc (Live's fade all, which works
 * from anywhere) still reach the screen. The prototype's `keepKeys` (views/help.js) is the same rule.
 */
export function keepKeysHere(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; stopPropagation(): void }): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^F\d/.test(event.key) || (event.key === "Escape" && event.shiftKey)) return;
  event.stopPropagation();
}
