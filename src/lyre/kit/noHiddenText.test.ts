import { afterEach, describe, expect, it } from "vitest";

import { fillTitles, isCut, showFullTextOnFocus } from "./noHiddenText";

/** jsdom has no layout: an element is "cut" when its computed style says ellipsis and its sizes say so. */
function cutShort(element: HTMLElement, text: string) {
  element.textContent = text;
  element.style.textOverflow = "ellipsis";
  element.style.overflow = "hidden";
  Object.defineProperty(element, "scrollWidth", { value: 300, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: 100, configurable: true });
  Object.defineProperty(element, "offsetParent", { value: document.body, configurable: true });
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("no hidden text (UX-6): a name cut short has its full text on hover and on focus", () => {
  it("knows a name cut with an ellipsis from one that fits", () => {
    const cut = cutShort(document.createElement("span"), "Lullaby, sad and innocent - a child, a memory");
    const fits = document.createElement("span");
    fits.textContent = "Ashes";
    document.body.append(cut, fits);
    expect(isCut(cut)).toBe(true);
    expect(isCut(fits)).toBe(false);
  });

  it("gives a cut name its full text as hover text, unless the row it is in has it already", () => {
    const root = document.createElement("main");
    const a = cutShort(document.createElement("span"), "Lullaby, sad and innocent - a child, a memory");
    const row = document.createElement("div");
    row.title = "Eerie dread, low cello and choir - something wrong in the dark";
    const b = cutShort(document.createElement("span"), "Eerie dread, low cello and choir - something wrong in the dark");
    row.append(b);
    root.append(a, row);
    document.body.append(root);
    fillTitles(root);
    expect(a).toHaveAttribute("title", "Lullaby, sad and innocent - a child, a memory");
    expect(b).not.toHaveAttribute("title");
  });

  it("keyboard focus on a control holding a cut name shows the same text under it, and leaving hides it", () => {
    const root = document.createElement("main");
    const row = document.createElement("div");
    row.tabIndex = 0;
    row.append(cutShort(document.createElement("span"), "Very short heroic moment - Cool vibe!"));
    root.append(row);
    document.body.append(root);
    const stop = showFullTextOnFocus(() => [root]);
    row.focus();
    expect(document.querySelector('[role="tooltip"]')).toHaveTextContent("Very short heroic moment - Cool vibe!");
    row.blur();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    stop();
  });
});
