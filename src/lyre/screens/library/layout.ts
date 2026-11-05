/** How wide the app is, in the prototype's three layouts (library.js render: 1200 and 820 px of the app's width). */
import { useLayoutEffect, useState } from "react";

export type LayoutMode = "wide" | "mid" | "narrow";

export function modeFor(width: number): LayoutMode {
  // Unmeasured (0 px, as in component tests) counts as wide, as the shell does.
  if (width === 0 || width >= 1200) return "wide";
  return width >= 820 ? "mid" : "narrow";
}

/** The layout for the app's current width (the shell's #app element), following resizes. */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() => modeFor(document.getElementById("app")?.getBoundingClientRect().width ?? 0));
  useLayoutEffect(() => {
    const app = document.getElementById("app");
    if (!app) return;
    const measure = () => setMode(modeFor(app.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(app);
    return () => observer.disconnect();
  }, []);
  return mode;
}
