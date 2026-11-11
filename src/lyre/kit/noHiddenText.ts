/**
 * UX-6 (design round 7, r7shell.js): no hidden text, as one kit behaviour for every screen. Names wrap to two lines
 * where they can (cards: ui.css), then are cut with an ellipsis; wherever a name is cut short its full text is the
 * hover text (added after each drawing when neither it nor the row it is in has it), and keyboard focus on it, or on
 * the row or button holding it, shows the same text in a small tooltip under it. The shell installs both on the work
 * area and the Now playing bar (Shell.tsx).
 */

const KEY_LENGTH = 40;

function norm(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Whether an element's text is cut short now: an ellipsis on one line, or more than its clamped lines. */
export function isCut(element: HTMLElement): boolean {
  // Cheap first: only an element whose content overflows it can be cut (most are not, and styles cost more).
  if (element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1) return false;
  const style = getComputedStyle(element);
  const clamp = style.getPropertyValue("-webkit-line-clamp");
  return (style.textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth + 1) || (!!clamp && clamp !== "none" && element.scrollHeight > element.clientHeight + 1);
}

/** Whether the element or a row it is in already has this text on hover. */
function hasTitle(element: HTMLElement, text: string, root: HTMLElement): boolean {
  const key = text.toLowerCase().slice(0, KEY_LENGTH);
  for (let n: HTMLElement | null = element; n && n !== root.parentElement; n = n.parentElement) {
    const title = norm(n.getAttribute("title")).toLowerCase();
    if (title && title.includes(key)) return true;
  }
  return false;
}

/** Shown, text-holding elements that can be cut (not containers of whole sections). */
function candidates(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((e) => e.offsetParent !== null && e.children.length <= 6 && !e.closest(".sr-only") && norm(e.textContent).length >= 3);
}

/** Gives every name cut short inside `root` its full text as hover text. */
export function fillTitles(root: HTMLElement): void {
  for (const element of candidates(root)) {
    if (!isCut(element)) continue;
    const text = norm(element.textContent);
    if (!hasTitle(element, text, root)) element.setAttribute("title", text);
  }
}

/**
 * Keeps the hover text up to date inside the roots (`roots()` finds them again, as screens come and go): after each
 * change to the page, at most once in `everyMs`, and after a resize.
 */
export function keepTitles(roots: () => HTMLElement[], everyMs = 150): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    for (const root of roots()) fillTitles(root);
  };
  const soon = () => {
    if (timer === undefined) timer = setTimeout(run, everyMs);
  };
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(soon);
  observer?.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", soon);
  soon();
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", soon);
    clearTimeout(timer);
  };
}

/** Focus on a cut name, or on the control holding one, shows its full text under the control. */
export function showFullTextOnFocus(roots: () => HTMLElement[]): () => void {
  let tip: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  const hide = () => {
    tip?.remove();
    tip = null;
    anchor = null;
  };
  const place = () => {
    if (!tip || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const height = tip.offsetHeight;
    const left = Math.min(Math.max(4, r.left), window.innerWidth - tip.offsetWidth - 4);
    let top = r.bottom + 4;
    if (top + height > window.innerHeight - 4) top = Math.max(4, r.top - height - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const onFocusIn = (event: FocusEvent) => {
    hide();
    const target = event.target;
    if (!(target instanceof HTMLElement) || !roots().some((root) => root.contains(target))) return;
    // UX-R13: Tab never reaches an element with tabindex -1, so focus there was put by the app (the heading of a
    // screen just opened): no tooltip over the page; its hover text stays.
    if (target.getAttribute("tabindex") === "-1") return;
    const cut = [target, ...candidates(target)].filter((e) => norm(e.textContent).length >= 3 && isCut(e));
    if (cut.length === 0) return;
    tip = document.createElement("div");
    tip.className = "full-tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "lyre-full-tip";
    tip.textContent = Array.from(new Set(cut.slice(0, 2).map((e) => norm(e.textContent)))).join(" · ");
    document.body.appendChild(tip);
    anchor = target;
    place();
  };
  const onFocusOut = (event: FocusEvent) => {
    if (event.target === anchor) hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && tip) hide();
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", place, true);
  return () => {
    hide();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", place, true);
  };
}
