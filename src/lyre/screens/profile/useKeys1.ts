import { useState } from "react";

const STORAGE_KEY = "lyre-profile-keys1";

/**
 * The Audio profile's single-key shortcuts (Space, I, O, L, M, arrows) can be switched off (WCAG 2.1.4). The choice is
 * kept in this page's storage only; without storage it lasts for this visit.
 */
export function useKeys1(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable: lasts for this visit */
    }
  };
  return [on, set];
}
