/**
 * UX-18: what Back puts back as it was. The screens are drawn again when Nik comes back, so a control or a scrolling
 * box cannot be kept as an element: each is kept as a key that finds the same one in the new drawing.
 *
 *   a control   "k:<data-k>" or "id:<id>" when it has one; otherwise its kind, its name (aria-label or text) and
 *               which of the controls with that kind and name it is: "a|Ashen King|0".
 *   a scroller  its data-scroll when it has one, "view" for the work area itself, otherwise where it sits in the
 *               work area: "div:0/div:2" (the third div in the first div).
 */

const NAME_LENGTH = 80;

function nameOf(element: Element): string {
  const label = element.getAttribute("aria-label");
  return (label ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_LENGTH);
}

/** The key that finds `element` again inside `root` once the screen is drawn again. */
export function controlKey(element: Element, root: Element): string {
  const k = element.getAttribute("data-k");
  if (k) return `k:${k}`;
  if (element.id) return `id:${element.id}`;
  const tag = element.tagName.toLowerCase();
  const name = nameOf(element);
  const same = Array.from(root.querySelectorAll(tag)).filter((e) => nameOf(e) === name);
  return `${tag}|${name}|${Math.max(0, same.indexOf(element))}`;
}

/** The control a key names, in the screen as it is drawn now, or null (not there, or not yet). */
export function findControl(key: string, root: Element): HTMLElement | null {
  if (!key) return null;
  if (key.startsWith("k:")) return root.querySelector<HTMLElement>(`[data-k="${CSS.escape(key.slice(2))}"]`);
  if (key.startsWith("id:")) return root.querySelector<HTMLElement>(`#${CSS.escape(key.slice(3))}`);
  const [tag, name, nth] = splitKey(key);
  if (!tag) return null;
  const same = Array.from(root.querySelectorAll<HTMLElement>(tag)).filter((e) => nameOf(e) === name);
  return same[Number(nth)] ?? null;
}

/** "a|Ashen King|0" → ["a", "Ashen King", "0"]; a name may itself hold "|". */
function splitKey(key: string): [string, string, string] {
  const first = key.indexOf("|");
  const last = key.lastIndexOf("|");
  if (first < 0 || last === first) return ["", "", ""];
  return [key.slice(0, first), key.slice(first + 1, last), key.slice(last + 1)];
}

/** The key of a scrolling box inside `root` (the work area). */
export function scrollKey(element: Element, root: Element): string {
  if (element === root) return "view";
  const named = element.getAttribute("data-scroll");
  if (named) return named;
  const path: string[] = [];
  for (let e: Element | null = element; e && e !== root; e = e.parentElement) {
    const parent: Element | null = e.parentElement;
    const tag = e.tagName.toLowerCase();
    const index = parent ? Array.from(parent.children).filter((c) => c.tagName === e!.tagName).indexOf(e) : 0;
    path.unshift(`${tag}:${index}`);
  }
  return path.join("/");
}

/** The scrolling box a key names, or null. */
export function findScroller(key: string, root: HTMLElement): HTMLElement | null {
  if (key === "view") return root;
  if (!key.includes(":")) return root.querySelector<HTMLElement>(`[data-scroll="${CSS.escape(key)}"]`);
  let at: Element | null = root;
  for (const step of key.split("/")) {
    const [tag, index] = step.split(":");
    const children: Element[] = at ? Array.from(at.children).filter((c) => c.tagName.toLowerCase() === tag) : [];
    at = children[Number(index)] ?? null;
    if (!at) return null;
  }
  return at as HTMLElement | null;
}

/** The scroll positions of every box in the work area that is scrolled now (the work area itself too). */
export function scrollsOf(root: HTMLElement): Record<string, number> {
  const out: Record<string, number> = {};
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (element.scrollTop > 0) out[scrollKey(element, root)] = element.scrollTop;
  }
  return out;
}
