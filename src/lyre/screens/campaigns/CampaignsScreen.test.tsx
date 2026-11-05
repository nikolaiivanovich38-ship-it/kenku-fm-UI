/** Campaigns, the top level (e2e/specs/campaigns.spec.ts "all campaigns"; prototype views/campaigns.js part 1). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getLiveSession } from "../../kit/liveSession";
import { expectNoAxeViolations } from "../../test/axe";
import { main, openAt } from "./testing";

vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("all campaigns", () => {
  it("shows one card per campaign, in its own theme, with its next session and Run next session", async () => {
    openAt("campaigns");
    const crown = await screen.findByRole("article", { name: "The Sunken Crown" });
    expect(main().getAllByRole("article")).toHaveLength(3);
    expect(main().getByText("3 campaigns")).toBeInTheDocument();
    expect(crown).toHaveAttribute("data-theme", "hearth");
    expect(crown).toHaveTextContent("D&D 5e");
    expect(crown).toHaveTextContent("Hearth and Iron");
    expect(crown).toHaveTextContent("Session 14: The Drowned Abbey");
    expect(crown).toHaveTextContent("Thu 5 Nov 2026");
    expect(within(crown).getByRole("button", { name: "Run next session of The Sunken Crown: Session 14" })).toBeInTheDocument();
    expect(within(crown).getByRole("link", { name: "Open The Sunken Crown" })).toHaveAttribute("href", "#/campaign/crown");
    expect(screen.getByRole("article", { name: "Ash and Masks" })).toHaveTextContent("Session 7: Elysium at the opera");
    await expectNoAxeViolations();
  });

  it("Run next session loads that session in Live, ready to start, and opens Live", async () => {
    openAt("campaigns");
    await userEvent.click(await screen.findByRole("button", { name: "Run next session of The Sixth Year: Session 4" }));
    expect(getLiveSession()).toEqual({ campaignId: "sixth", sessionId: "w4" });
    expect(window.location.hash).toBe("#/live");
  });

  it("New campaign asks for a name, game system, description and theme (Candlelit Library first), and opens the new campaign", async () => {
    const { api } = openAt("campaigns");
    await userEvent.click(await screen.findByRole("button", { name: "New campaign" }));
    const sheet = within(screen.getByRole("dialog", { name: "New campaign" }));
    expect(sheet.getByRole("combobox", { name: "Game system" })).toBeInTheDocument();
    expect(sheet.getByRole("textbox", { name: "Description (one line)" })).toBeInTheDocument();
    expect(sheet.getByRole("radio", { name: /Candlelit Library/ })).toBeChecked();
    expect(sheet.getByText("coming later")).toBeInTheDocument();
    // No name: the sheet says so and keeps the cursor in the name.
    await userEvent.click(sheet.getByRole("button", { name: "Create campaign" }));
    expect(sheet.getByText("Give the campaign a name.")).toBeVisible();
    expect(sheet.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    expect(sheet.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await userEvent.type(sheet.getByRole("textbox", { name: "Name" }), "Harbour lights");
    await userEvent.click(sheet.getByRole("radio", { name: /Elysium/ }));
    await userEvent.click(sheet.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Harbour lights" })).toBeInTheDocument();
    const made = (await api.campaigns.list()).find((c) => c.name === "Harbour lights");
    expect(made?.theme).toBe("elysium");
    expect(window.location.hash).toBe(`#/campaign/${made?.id}`);
    expect(screen.getByText('Made "Harbour lights" with a first draft session')).toBeInTheDocument();
  });

  it("Escape closes the New campaign sheet and adds nothing", async () => {
    const { api } = openAt("campaigns");
    await userEvent.click(await screen.findByRole("button", { name: "New campaign" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await api.campaigns.list()).toHaveLength(3);
  });

  it("a campaign with nothing planned says so and its Run next session cannot be used", async () => {
    const { api } = openAt("campaigns");
    await screen.findByRole("article", { name: "The Sunken Crown" });
    await api.sessions.update("masks", "v7", { status: "played" });
    const masks = screen.getByRole("article", { name: "Ash and Masks" });
    await waitFor(() => expect(masks).toHaveTextContent("Nothing planned yet"));
    expect(within(masks).getByRole("button", { name: "Run next session" })).toHaveAttribute("aria-disabled", "true");
  });
});
