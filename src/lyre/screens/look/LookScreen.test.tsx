/** Look and feel (route `look`): the five table themes, as the prototype's views/look.js shows them. */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLyreApi, type FakeLyreApi } from "../../../common/lyre/fake";
import { LyreApiProvider } from "../../api";
import { Shell } from "../../shell/Shell";
import { loadShellSettings } from "../../shell/settings";
import { expectNoAxeViolations } from "../../test/axe";
import { PlaceholderScreen } from "../Placeholder";
import { SCREENS } from "..";
import { LookScreen } from "./LookScreen";

const LOOK_SCREENS = { ...SCREENS, look: LookScreen, campaigns: () => <PlaceholderScreen title="Campaigns" /> };

let api: FakeLyreApi;

function open() {
  window.history.replaceState(null, "", "#/look");
  api = createFakeLyreApi();
  render(
    <LyreApiProvider api={api}>
      <Shell screens={LOOK_SCREENS} />
    </LyreApiProvider>,
  );
  return within(screen.getByRole("main"));
}

const card = (name: string) => within(screen.getByRole("article", { name }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-contrast");
});

describe("Look and feel › Display (UX-11, round 7)", () => {
  const display = () => within(screen.getByRole("region", { name: "Display" }));

  it("UX-R3 (ROUND7 UX-11): the intro is the heading's hover text and description, not words on the page", async () => {
    open();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Look and feel" });
    expect(screen.queryByText("One Lyre, a theme per table")).toBeNull();
    expect(h1).toHaveAttribute("title", expect.stringMatching(/^Choose the theme Lyre uses everywhere/));
    expect(h1).toHaveAccessibleDescription(/^Choose the theme Lyre uses everywhere/);
    expect(screen.getByText(/^Choose the theme Lyre uses everywhere/)).toHaveClass("sr-only");
  });

  it("Compact is the default; Comfortable is kept on this computer, marks the page and shows the Saved pop-up", async () => {
    open();
    const user = userEvent.setup();
    expect(display().getByRole("radio", { name: "Compact" })).toBeChecked();
    await user.click(display().getByRole("radio", { name: "Comfortable" }));
    expect(document.documentElement.dataset.density).toBe("comfortable");
    await vi.waitFor(() => expect(document.getElementById("lyre-toast")).toHaveTextContent("Saved: density Comfortable"));
    expect((await api.settings.get()).display.density).toBe("comfortable");
  });

  it("Text size goes from 100 to 200 % in steps of 25, read out in per cent", async () => {
    open();
    const size = display().getByRole("slider", { name: "Text size" });
    expect(size).toHaveAttribute("aria-valuetext", "100 percent");
    await act(async () => fireEvent.change(size, { target: { value: "150" } }));
    expect(size).toHaveAttribute("aria-valuetext", "150 percent");
    await vi.waitFor(async () => expect((await api.settings.get()).display.textSize).toBe(150));
    expect(size).toHaveAttribute("max", "200");
    expect(size).toHaveAttribute("step", "25");
  });

  it("High contrast is a switch that marks the page; Tag colours… goes to the tags", async () => {
    open();
    const user = userEvent.setup();
    await user.click(display().getByRole("switch", { name: "High contrast" }));
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(display().getByRole("link", { name: "Tag colours…" })).toHaveAttribute("href", "#/tags");
  });
});

describe("Look and feel", () => {
  it("shows the five table themes in the prototype's order, each drawn in its own colours with one plain sentence (w3-ux 8)", () => {
    const main = open();
    expect(main.getByRole("heading", { level: 1 })).toHaveTextContent("Look and feel");
    expect(main.queryByText("One Lyre, a theme per table")).toBeNull();
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

  it("0.5.1: Theme chooses the base theme; there is no \"Each campaign's own\"", async () => {
    const main = open();
    const user = userEvent.setup();
    const choice = main.getByRole("combobox", { name: "Theme" });
    expect(choice).toHaveValue("candle");
    expect(within(choice).queryByRole("option", { name: "Each campaign's own" })).toBeNull();
    await user.selectOptions(choice, "Elysium (Vampire)");
    expect(loadShellSettings().theme).toBe("elysium");
    expect(document.documentElement.dataset.theme).toBe("elysium");
    expect(card("Elysium").getByRole("button", { name: "In use: Elysium" })).toBeInTheDocument();
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
