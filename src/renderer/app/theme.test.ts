import { describe, expect, it } from "vitest";
import { FOCUS_RING_COLOR, theme, themeOptions } from "./theme";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("keyboard focus outline (UX finding 3)", () => {
  it("stands out from every dark surface of the app by at least 3:1 (WCAG 1.4.11)", () => {
    const surfaces = [
      theme.palette.background.default,
      theme.palette.background.paper,
      "#2d3143", // top of the window's background gradient
      "#383c50", // a raised dialog in dark mode
    ];
    for (const surface of surfaces) {
      expect(contrast(FOCUS_RING_COLOR, surface), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("is not the purple used for selected items", () => {
    expect(FOCUS_RING_COLOR.toLowerCase()).not.toBe(theme.palette.primary.main.toLowerCase());
  });

  it("is defined once for every MUI control and for every other focusable element", () => {
    const buttonBase = themeOptions.components?.MuiButtonBase?.styleOverrides?.root as Record<string, unknown>;
    expect(buttonBase["&.Mui-focusVisible"]).toMatchObject({ outline: `2px solid ${FOCUS_RING_COLOR}` });
    const baseline = themeOptions.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>;
    expect(baseline[":focus-visible"]).toMatchObject({ outline: `2px solid ${FOCUS_RING_COLOR}` });
  });
});
