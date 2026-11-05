/** Look and feel (route `look`): the five table themes, as the prototype's views/look.js shows them. */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../shell/Shell";
import { loadShellSettings } from "../../shell/settings";
import { expectNoAxeViolations } from "../../test/axe";
import { PlaceholderScreen } from "../Placeholder";
import { SCREENS } from "..";
import { contrastLine, contrastRatio } from "./contrast";
import { LookScreen } from "./LookScreen";

const LOOK_SCREENS = { ...SCREENS, look: LookScreen, campaigns: () => <PlaceholderScreen title="Campaigns" /> };

function open() {
  window.history.replaceState(null, "", "#/look");
  render(<Shell screens={LOOK_SCREENS} />);
  return within(screen.getByRole("main"));
}

const card = (name: string) => within(screen.getByRole("article", { name }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Look and feel", () => {
  it("shows the five table themes in the prototype's order, each drawn in its own colours", () => {
    const main = open();
    expect(main.getByRole("heading", { level: 1 })).toHaveTextContent("Look and feel");
    expect(main.getByText("One Lyre, a theme per table")).toBeInTheDocument();
    const names = main.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(names).toEqual(["Candlelit Library", "Fern and Brass", "Hearth and Iron", "Parchment", "Elysium"]);
    const sample = screen.getByRole("article", { name: "Elysium" }).querySelector(".lk-sample");
    expect(sample).toHaveAttribute("data-theme", "elysium");
    expect(card("Hearth and Iron").getByText("D&D, Pathfinder, sword and sorcery")).toBeInTheDocument();
    expect(card("Hearth and Iron").getByText(/Cinzel headings/)).toBeInTheDocument();
    expect(main.getByRole("heading", { level: 2, name: "Same in every theme" })).toBeInTheDocument();
    expect(main.getByRole("heading", { level: 2, name: "Density" })).toBeInTheDocument();
  });

  it("Use this theme uses it everywhere at once, says so, and is remembered", async () => {
    open();
    const user = userEvent.setup();
    await user.click(card("Parchment").getByRole("button", { name: "Use this theme: Parchment" }));
    expect(document.documentElement.dataset.theme).toBe("parchment");
    expect(loadShellSettings().theme).toBe("parchment");
    expect(card("Parchment").getByRole("button", { name: "In use: Parchment" })).toBeInTheDocument();
    expect(card("Elysium").getByRole("button", { name: "Use this theme: Elysium" })).toBeInTheDocument();
    expect(document.getElementById("lyre-toast")).toHaveTextContent("Lyre now uses Parchment");
  });

  it("Theme goes back to each campaign's own theme", async () => {
    const main = open();
    const user = userEvent.setup();
    await user.click(card("Elysium").getByRole("button", { name: "Use this theme: Elysium" }));
    const choice = main.getByRole("combobox", { name: "Theme" });
    expect(choice).toHaveValue("elysium");
    await user.selectOptions(choice, "Each campaign's own");
    expect(loadShellSettings().theme).toBe("campaign");
    expect(document.documentElement.dataset.theme).toBe("candle");
    expect(screen.queryByRole("button", { name: /^In use/ })).toBeNull();
  });

  it("works out each card's contrast from its colours", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBe("21.0");
    expect(contrastRatio("rgb(119, 119, 119)", "rgb(255, 255, 255)")).toBe("4.5");
    expect(contrastRatio("", "rgb(255, 255, 255)")).toBeNull();
  });

  it("each card's sample is a picture: screen readers find only Use this theme and the contrast line (review 6)", () => {
    open();
    const parchment = card("Parchment");
    expect(parchment.getAllByRole("button").map((b) => b.textContent)).toEqual(["Use this theme"]);
    expect(parchment.queryByText("Start scene")?.closest('[aria-hidden="true"]')).not.toBeNull();
    const line = screen.getByRole("article", { name: "Parchment" }).querySelector(".lk-contrast");
    expect(line?.closest('[aria-hidden="true"]')).toBeNull();
    expect(line?.closest(".lk-sample")).toHaveAttribute("data-theme", "parchment");
  });

  it("reads the theme's own text, quiet text and accent colours against its panels", () => {
    const sample = document.createElement("div");
    document.body.appendChild(sample);
    const colours: Record<string, string> = { "--surface": "rgb(255, 255, 255)", "--ink": "rgb(0, 0, 0)", "--ink-3": "rgb(119, 119, 119)", "--accent-text": "rgb(255, 255, 255)" };
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el) => ({ color: colours[(el as HTMLElement).style.color.slice(4, -1)] ?? "" }) as CSSStyleDeclaration);
    expect(contrastLine(sample)).toBe("Contrast on panels: text 21.0:1, quiet text 4.5:1, accent text 1.0:1");
    expect(sample.children).toHaveLength(0);
    spy.mockRestore();
    sample.remove();
  });

  it("has no accessibility failures", async () => {
    open();
    await act(async () => undefined);
    await expectNoAxeViolations();
  });
});
