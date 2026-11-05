/** Look and feel (route `look`): the five table themes, as the prototype's views/look.js shows them. */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Shell } from "../../shell/Shell";
import { loadShellSettings } from "../../shell/settings";
import { expectNoAxeViolations } from "../../test/axe";
import { PlaceholderScreen } from "../Placeholder";
import { SCREENS } from "..";
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
  it("shows the five table themes in the prototype's order, each drawn in its own colours with one plain sentence (w3-ux 8)", () => {
    const main = open();
    expect(main.getByRole("heading", { level: 1 })).toHaveTextContent("Look and feel");
    expect(main.getByText("One Lyre, a theme per table")).toBeInTheDocument();
    const names = main.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(names).toEqual(["Candlelit Library", "Fern and Brass", "Hearth and Iron", "Parchment", "Elysium"]);
    const sample = screen.getByRole("article", { name: "Elysium" }).querySelector(".lk-sample");
    expect(sample).toHaveAttribute("data-theme", "elysium");
    expect(card("Hearth and Iron").getByText("D&D, Pathfinder, sword and sorcery")).toBeInTheDocument();
    expect(card("Hearth and Iron").getByText("Warm stone and ember light for dungeons, taverns and sword and sorcery.")).toBeInTheDocument();
    expect(main.getByRole("heading", { level: 2, name: "Same in every theme" })).toBeInTheDocument();
    // The designer's notes are gone: no "Your choice", type faces, contrast ratios or control sizes.
    for (const words of [/Your choice/, /Cinzel/, /Contrast on panels/, /28 px/, /palettes/]) expect(main.queryByText(words)).toBeNull();
    expect(main.queryByRole("heading", { name: "Density" })).toBeNull();
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

  it("each card's sample is a picture: screen readers find only Use this theme (review 6)", () => {
    open();
    const parchment = card("Parchment");
    expect(parchment.getAllByRole("button").map((b) => b.textContent)).toEqual(["Use this theme"]);
    expect(parchment.queryByText("Start scene")?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("has no accessibility failures", async () => {
    open();
    await act(async () => undefined);
    await expectNoAxeViolations();
  });
});
