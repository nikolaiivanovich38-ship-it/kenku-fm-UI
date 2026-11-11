/**
 * UX-R4: when the control in use goes away (an entry taken out, a room kicked, a bot added), focus goes to a sensible
 * neighbour instead of falling to the page. Call it as the change is made; it watches for a moment:
 *
 * - by default it waits until the control in use has gone (focus is on the page), then focuses the first of
 *   `selectors` that is drawn by then (or as soon as one is drawn);
 * - with `move`, it focuses the first one as soon as it is drawn, even while the control in use is still there (a new
 *   room's bot button after Add a room).
 *
 * It stops as soon as focus is somewhere else the person chose, when the screen changes (Back or a link: the place
 * opened may have a control of the same name, which is not the neighbour meant), and after `ms`. The neighbour is
 * focused where it is, without scrolling: it takes the place of the control in use, so it is in view already, and a
 * scroll position Back has put back stays as it was (UX-18).
 */
export function focusSoon(selectors: readonly string[], options: { move?: boolean; ms?: number } = {}): void {
  const { move = false, ms = 3000 } = options;
  const from = document.activeElement as HTMLElement | null;
  const until = Date.now() + ms;
  const screen = window.location.hash;
  const lost = (el: Element | null) => !el || el === document.body || !el.isConnected;
  const find = () => {
    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && el !== from && el.isConnected) return el;
    }
    return null;
  };
  const tick = () => {
    if (window.location.hash !== screen) return;
    const active = document.activeElement;
    const stillThere = active === from && !lost(from);
    // Focus moved somewhere else on purpose: leave it there.
    if (!lost(active) && !stillThere) return;
    if (move || !stillThere) {
      const target = find();
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    if (Date.now() < until) setTimeout(tick, 50);
  };
  setTimeout(tick, 0);
}
