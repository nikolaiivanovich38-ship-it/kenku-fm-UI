/**
 * WCAG contrast between two colours as the browser computes them ("rgb(12, 34, 56)"), for the live numbers under
 * each Look and feel card (the prototype's lum and cr in views/look.js).
 */

/** Relative luminance of an "rgb(…)" or "rgba(…)" colour; null when it is not one. */
function luminance(colour: string): number | null {
  const parts = colour.match(/\d+(\.\d+)?/g);
  if (!parts || parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio to one decimal ("4.5"), or null when a colour cannot be read. */
export function contrastRatio(a: string, b: string): string | null {
  const x = luminance(a);
  const y = luminance(b);
  if (x === null || y === null) return null;
  return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(1);
}

/**
 * The line under a card: its text, quiet text and accent text against its panels, read from the theme's own
 * tokens inside `sample` (an element with data-theme). Empty when the page cannot compute colours.
 */
export function contrastLine(sample: HTMLElement): string {
  const probe = document.createElement("span");
  sample.appendChild(probe);
  const colour = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const panel = colour("--surface");
  const ink = contrastRatio(colour("--ink"), panel);
  const quiet = contrastRatio(colour("--ink-3"), panel);
  const accent = contrastRatio(colour("--accent-text"), panel);
  probe.remove();
  if (!ink || !quiet || !accent) return "";
  return `Contrast on panels: text ${ink}:1, quiet text ${quiet}:1, accent text ${accent}:1`;
}
