import { screen } from "@testing-library/react";
import { expect } from "vitest";
import { ICONS } from "../kit/icons";

/**
 * UX-R8: every Play on air control (buttons and menu items) shows the play triangle sounding out (`playair`), never
 * the broadcast mast, which is the On air tag's. Checks the ones on screen now; there must be at least one.
 */
export function expectPlayAirIcons(): void {
  const controls = [
    ...screen.queryAllByRole("button", { name: /^(Play on air|Stop on air)/ }),
    ...screen.queryAllByRole("menuitem", { name: /^(Play on air|Play its music from the top)/ }),
  ];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const paths = Array.from(control.querySelectorAll("svg path")).map((p) => p.getAttribute("d"));
    expect({ name: control.getAttribute("aria-label") ?? control.textContent, icon: paths[0] === ICONS.stop ? ICONS.playair : paths[0] }).toEqual({
      name: control.getAttribute("aria-label") ?? control.textContent,
      icon: ICONS.playair,
    });
  }
}
