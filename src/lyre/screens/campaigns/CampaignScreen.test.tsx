/** One campaign: details, sessions, campaign playlists and pad boards (e2e/specs/campaigns.spec.ts; views/campaigns.js part 2). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { getLiveSession, loadInLive } from "../../kit/liveSession";
import { expectNoAxeViolations } from "../../test/axe";
import { main, openAt, region } from "./testing";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  loadInLive(null);
});

const sessions = () => within(screen.getByRole("list", { name: "Sessions in order" }));

describe("one campaign", () => {
  it("has a breadcrumb, the name as heading, Prep pressed, and Run next session for session 14", async () => {
    openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    expect(main().getByRole("heading", { level: 1, name: "The Sunken Crown" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Campaigns" })).toHaveAttribute("href", "#/campaigns");
    const modes = within(screen.getByRole("group", { name: "Prep or live" }));
    expect(modes.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    expect(modes.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
    expect(main().getByRole("button", { name: /^Run next session/ })).toHaveTextContent("Run next session S14");
    await expectNoAxeViolations();
  });

  it("the Live side of the switch loads the campaign's next session in Live", async () => {
    openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: "Live" }));
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s14" });
    expect(window.location.hash).toBe("#/live");
  });

  it("the Live side keeps the session already loaded in Live when it belongs to this campaign", async () => {
    loadInLive({ campaignId: "crown", sessionId: "s12" });
    openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: "Live" }));
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s12" });
  });

  it("name, game system, theme and description are edited on the page; the theme changes the page", async () => {
    const { api } = openAt("campaign/crown");
    const name = await screen.findByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("The Sunken Crown");
    expect(screen.getByRole("combobox", { name: "Game system" })).toHaveValue("D&D 5e");
    const theme = screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement;
    expect(theme.selectedOptions[0].label).toBe("Hearth and Iron");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("hearth"));
    await userEvent.selectOptions(theme, "Parchment");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("parchment"));
    expect(await screen.findByText("Theme: Parchment")).toBeInTheDocument();
    await userEvent.type(name, " (revised)");
    expect(await screen.findByRole("heading", { level: 1, name: "The Sunken Crown (revised)" })).toBeInTheDocument();
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.name).toBe("The Sunken Crown (revised)"));
  });

  it("notes are kept and the box says Saved", async () => {
    const { api } = openAt("campaign/crown");
    const notes = await screen.findByRole("textbox", { name: "Campaign notes" });
    expect(within(screen.getByRole("region", { name: "Notes" })).getByText("Empty")).toBeInTheDocument();
    await userEvent.type(notes, "Maeve owes them");
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.notes).toBe("Maeve owes them"));
    expect(within(screen.getByRole("region", { name: "Notes" })).getByText("Saved")).toBeInTheDocument();
  });

  it("New session adds a draft session and opens it", async () => {
    openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: "New session" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Session 16" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("draft");
    expect(screen.getByText("Added Session 16")).toBeInTheDocument();
  });

  it("Obsidian is folded with Coming later", async () => {
    openAt("campaign/crown");
    const obs = await screen.findByRole("region", { name: "Obsidian" });
    expect(within(obs).getByText("Coming later")).toBeInTheDocument();
    expect(within(obs).getByRole("button", { name: "Obsidian" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("sessions of a campaign", () => {
  it("lists the sessions with number, date, status and a Run button each; played ones say again", async () => {
    openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    const rows = sessions().getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Played");
    expect(rows[2]).toHaveTextContent("Next");
    expect(rows[2]).toHaveTextContent("Thu 5 Nov 2026");
    expect(rows[3]).toHaveTextContent("Draft");
    expect(rows[3]).toHaveTextContent("No date yet");
    expect(sessions().getByRole("link", { name: "Session 14: The Drowned Abbey" })).toHaveAttribute("href", "#/session/crown/s14");
    expect(sessions().getByRole("button", { name: "Run Session 12: Smugglers of Greyhollow again" })).not.toHaveClass("primary");
    expect(sessions().getByRole("button", { name: "Run Session 14: The Drowned Abbey" })).toHaveClass("primary");
  });

  it("running a played session again loads it in Live", async () => {
    openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: /^Run Session 12/ }));
    expect(getLiveSession()).toEqual({ campaignId: "crown", sessionId: "s12" });
    expect(window.location.hash).toBe("#/live");
  });

  it("a session moves down from its menu and is renumbered, keeping focus on its menu", async () => {
    const { api } = openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: "More for Session 13: The coast road" }));
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.sessions.map((s) => s.id)).toEqual(["s12", "s14", "s13", "s15"]));
    expect(await screen.findByRole("button", { name: "More for Session 14: The coast road" })).toHaveFocus();
    expect(await screen.findByText("The coast road is now Session 14, 3 of 4")).toBeInTheDocument();
  });
});

describe("playlists and pad boards on hand in every session", () => {
  it("a playlist's tracks are hidden until its expander opens", async () => {
    openAt("campaign/crown");
    await screen.findByRole("link", { name: "The Company themes" });
    const playlists = region("Campaign playlists");
    expect(playlists.queryByRole("list", { name: "Tracks in The Company themes" })).not.toBeInTheDocument();
    await userEvent.click(playlists.getByRole("button", { name: "Show contents of The Company themes" }));
    expect(within(playlists.getByRole("list", { name: "Tracks in The Company themes" })).getAllByRole("listitem")).toHaveLength(6);
    await userEvent.click(playlists.getByRole("button", { name: "Hide contents of The Company themes" }));
    expect(playlists.queryByRole("list", { name: "Tracks in The Company themes" })).not.toBeInTheDocument();
  });

  it("Preview and Play on air call the audio host", async () => {
    const { audio } = openAt("campaign/crown");
    await screen.findByRole("link", { name: "The Company themes" });
    const playlists = region("Campaign playlists");
    await userEvent.click(playlists.getByRole("button", { name: "Preview The Company themes" }));
    expect(audio.calls).toContainEqual(["previewPlaylist", "p-company"]);
    audio.setNowPlaying({ preview: { key: "pl:p-company" } as never });
    expect(await playlists.findByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(playlists.getByRole("button", { name: "Play on air: The Company themes" }));
    expect(audio.calls).toContainEqual(["playPlaylist", "p-company", { fadeMs: 3000 }]);
    const boards = region("Campaign pad boards");
    await userEvent.click(boards.getByRole("button", { name: "Preview the first pad of Combat" }));
    expect(audio.calls.find((c) => c[0] === "previewPad")?.[1]).toBe("combat");
  });

  it("a sound that cannot play says why", async () => {
    const { audio } = openAt("campaign/crown");
    await screen.findByRole("link", { name: "The Company themes" });
    audio.emit("error", "Unable to preview: Tavern");
    expect(await screen.findByText("Unable to preview: Tavern")).toBeInTheDocument();
  });

  it("Add playlists… keeps the ticked ones, in order", async () => {
    const { api } = openAt("campaign/crown");
    await screen.findByRole("link", { name: "The Company themes" });
    await userEvent.click(region("Campaign playlists").getByRole("button", { name: "Add playlists…" }));
    const sheet = within(screen.getByRole("dialog", { name: "Playlists on hand in every session of The Sunken Crown" }));
    expect(sheet.getByRole("button", { name: "Preview Coast road travel" })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Show contents of Coast road travel" })).toBeInTheDocument();
    await userEvent.click(sheet.getByRole("checkbox", { name: /^Coast road travel/ }));
    await userEvent.click(sheet.getByRole("button", { name: "Done" }));
    expect(await region("Campaign playlists").findByRole("link", { name: "Coast road travel" })).toBeInTheDocument();
    expect((await api.campaigns.get("crown"))?.playlistIds).toEqual(["p-company", "p-ashen", "p-combat-big", "x-stings", "p-coast"]);
    expect(screen.getByRole("button", { name: "Add playlists…" })).toHaveFocus();
  });

  it("a playlist comes off the campaign from its menu and stays in the library", async () => {
    const { api } = openAt("campaign/crown");
    await userEvent.click(await screen.findByRole("button", { name: "More for Ashen King" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this campaign" }));
    await waitFor(() => expect(region("Campaign playlists").queryByRole("link", { name: "Ashen King" })).not.toBeInTheDocument());
    expect((await api.playlists.list()).some((p) => p.name === "Ashen King")).toBe(true);
    expect(await screen.findByText('Removed "Ashen King" from this campaign. It is still on the Playlists page.')).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "More for Combat: big and loopable" })).toHaveFocus();
  });

  it("campaign pad boards open to show their pads", async () => {
    openAt("campaign/crown");
    await screen.findByRole("link", { name: "Combat" });
    const boards = region("Campaign pad boards");
    await userEvent.click(boards.getByRole("button", { name: "Show contents of Combat" }));
    expect(boards.getByRole("list", { name: "Pads on Combat" })).toBeInTheDocument();
    expect(boards.getByRole("button", { name: "Preview Sword clash" })).toBeInTheDocument();
  });
});
