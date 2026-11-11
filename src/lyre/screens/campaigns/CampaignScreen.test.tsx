/** One campaign: details, sessions, campaign playlists and pad boards (e2e/specs/campaigns.spec.ts; views/campaigns.js part 2). */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { getLiveSession, loadInLive } from "../../kit/liveSession";
import { expectNoAxeViolations } from "../../test/axe";
import { saveShellSettings } from "../../shell/settings";
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

  it("0.5.1: the campaign's theme shows whatever base Look and feel chose, with no note about Look and feel", async () => {
    saveShellSettings({ theme: "parchment", rail: "auto", panes: {} });
    openAt("campaign/crown");
    const theme = (await screen.findByRole("combobox", { name: "Theme" })) as HTMLSelectElement;
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("hearth"));
    expect(theme).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Look and feel is showing every page/)).toBeNull();
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

  it("notes are kept, with the Saved pop-up; the box itself never says Saved (UX-19)", async () => {
    const { api } = openAt("campaign/crown");
    const notes = await screen.findByRole("textbox", { name: "Campaign notes" });
    // UX-R3 (round 6 rule 4): an open box does not say Empty.
    expect(within(screen.getByRole("region", { name: "Notes" })).queryByText("Empty")).toBeNull();
    await userEvent.type(notes, "Maeve owes them");
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.notes).toBe("Maeve owes them"), { timeout: 3000 });
    expect(await screen.findByText("The Sunken Crown notes", { exact: false })).toBeInTheDocument();
    expect(document.getElementById("lyre-toast")).toHaveTextContent("Saved: The Sunken Crown notes");
    expect(within(screen.getByRole("region", { name: "Notes" })).queryByText(/^(Saved|Empty)$/)).toBeNull();
    expect(notes).toHaveFocus();
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
    // UX-R3 (round 6 cuts): the open header repeats neither the count nor the next session (the rows say both),
    // nor do the side boxes count their open rows.
    const head = screen.getByRole("region", { name: "Sessions" }).querySelector("header")!;
    expect(head).not.toHaveTextContent("4 sessions");
    expect(head).not.toHaveTextContent("Next:");
    for (const box of ["Campaign playlists", "Campaign pads"]) expect(screen.getByRole("region", { name: box }).querySelector("header")!.textContent).not.toMatch(/\d/);
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
    expect(playlists.queryByRole("list", { name: /^Tracks in The Company themes(,|$)/ })).not.toBeInTheDocument();
    await userEvent.click(playlists.getByRole("button", { name: "Show contents of The Company themes" }));
    expect(within(playlists.getByRole("list", { name: /^Tracks in The Company themes(,|$)/ })).getAllByRole("listitem")).toHaveLength(6);
    await userEvent.click(playlists.getByRole("button", { name: "Hide contents of The Company themes" }));
    expect(playlists.queryByRole("list", { name: /^Tracks in The Company themes(,|$)/ })).not.toBeInTheDocument();
  });

  it("Preview and Play on air call the audio host", async () => {
    const { audio } = openAt("campaign/crown");
    await screen.findByRole("link", { name: "The Company themes" });
    const playlists = region("Campaign playlists");
    await userEvent.click(playlists.getByRole("button", { name: "Preview The Company themes" }));
    expect(audio.calls).toContainEqual(["previewPlaylist", "p-company", { from: "the campaign page" }]);
    audio.setNowPlaying({ preview: { key: "pl:p-company" } as never });
    expect(await playlists.findByRole("button", { name: "Stop preview of The Company themes" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(playlists.getByRole("button", { name: "Play on air: The Company themes" }));
    // From the campaign's list, so its play order there applies and the Now playing bar names it (PLY-13, UX-16).
    expect(audio.calls).toContainEqual(["playPlaylist", "p-company", { fadeMs: 3000, place: { kind: "campaign", campaignId: "crown" } }]);
    const boards = region("Campaign pads");
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
    const boards = region("Campaign pads");
    await userEvent.click(boards.getByRole("button", { name: "Show contents of Combat" }));
    expect(boards.getByRole("list", { name: "Pads on Combat" })).toBeInTheDocument();
    expect(boards.getByRole("button", { name: "Preview Sword clash" })).toBeInTheDocument();
  });
});

describe("renaming a session in place (EDT-1, BUG-18)", () => {
  const link = () => sessions().getByRole("link", { name: "Session 13: The coast road" });
  const nameOf = async (api: Awaited<ReturnType<typeof openAt>>["api"], id: string) =>
    (await api.campaigns.get("crown"))?.sessions.find((s) => s.id === id)?.name;

  it("F2 on the name starts editing; Enter saves and focus goes back to the name", async () => {
    const { api } = openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    const user = userEvent.setup();
    link().focus();
    await user.keyboard("{F2}");
    const box = sessions().getByRole("textbox", { name: "Name of Session 13" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue("The coast road");
    await user.clear(box);
    await user.keyboard("The cliff road{Enter}");
    await waitFor(async () => expect(await nameOf(api, "s13")).toBe("The cliff road"));
    const renamed = await sessions().findByRole("link", { name: "Session 13: The cliff road" });
    await waitFor(() => expect(renamed).toHaveFocus());
    expect(window.location.hash).toBe("#/campaign/crown");
  });

  it("Esc cancels, and an empty name changes nothing", async () => {
    const { api } = openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    const user = userEvent.setup();
    link().focus();
    await user.keyboard("{F2}");
    await user.keyboard("Something else{Escape}");
    expect(sessions().queryByRole("textbox")).toBeNull();
    expect(link()).toHaveFocus();
    await user.keyboard("{F2}");
    await user.clear(sessions().getByRole("textbox", { name: "Name of Session 13" }));
    await user.keyboard("{Enter}");
    expect(await nameOf(api, "s13")).toBe("The coast road");
  });

  it("double-click on the name starts editing without opening the session; one click still opens it", async () => {
    const { api } = openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    const user = userEvent.setup();
    await user.dblClick(link());
    const box = sessions().getByRole("textbox", { name: "Name of Session 13" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(window.location.hash).toBe("#/campaign/crown");
    await user.clear(box);
    await user.keyboard("Coastal{Enter}");
    await waitFor(async () => expect(await nameOf(api, "s13")).toBe("Coastal"));
    await user.click(sessions().getByRole("link", { name: "Session 13: Coastal" }));
    await waitFor(() => expect(window.location.hash).toBe("#/session/crown/s13"));
  });

  it("Rename in the row's menu starts editing too (Enter on it)", async () => {
    openAt("campaign/crown");
    await screen.findByRole("list", { name: "Sessions in order" });
    const user = userEvent.setup();
    await user.click(sessions().getByRole("button", { name: "More for Session 13: The coast road" }));
    screen.getByRole("menuitem", { name: "Rename" }).focus();
    await user.keyboard("{Enter}");
    expect(await sessions().findByRole("textbox", { name: "Name of Session 13" })).toHaveFocus();
  });
});

describe("round 5 on the campaign page", () => {
  it("PLY-13: each campaign playlist has a play order for the campaign; a change there leaves the others alone", async () => {
    const user = userEvent.setup();
    const { api } = openAt("campaign/crown");
    await screen.findByRole("region", { name: "Campaign playlists" });
    const order = await region("Campaign playlists").findByRole("button", { name: /^Play order of The Company themes: / });
    expect(order).toHaveAccessibleName("Play order of The Company themes: In order, repeat all");
    await user.click(order);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Shuffle" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(order).toHaveAccessibleName("Play order of The Company themes: Shuffle, repeat all"));
    expect(region("Campaign playlists").getByRole("button", { name: /^Play order of Ashen King: / })).toHaveAccessibleName("Play order of Ashen King: In order, repeat all");
    expect((await api.playlists.list()).find((p) => p.name === "The Company themes")?.order).not.toMatchObject({ shuffle: true });
  });

  it("ORG-12: single tracks on hand for the campaign are listed after its playlists, with Play on air", async () => {
    openAt("campaign/crown");
    await screen.findByRole("region", { name: "Campaign playlists" });
    const single = await region("Campaign playlists").findByRole("link", { name: "Ominous song, the villain's calling card (short) (single track)" });
    expect(single.closest("li")).toHaveTextContent("Single track");
    expect(region("Campaign playlists").getByRole("button", { name: "Play on air: Ominous song, the villain's calling card (short)" })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});

describe("round 6: the campaign's own order (ORG-13)", () => {
  const box = () => region("Campaign playlists");
  it("a campaign playlist's tracks move with Alt+Down for this campaign only; Back to the playlist's order undoes it", async () => {
    const user = userEvent.setup();
    const { api } = openAt("campaign/crown");
    await screen.findByRole("region", { name: "Campaign playlists" });
    await user.click(await box().findByRole("button", { name: "Show contents of The Company themes" }));
    const list = box().getByRole("list", { name: "Tracks in The Company themes, in the order in this campaign" });
    expect(list).toHaveAccessibleDescription(/Alt\+Up or Alt\+Down/);
    expect(box().queryByRole("button", { name: "Back to the playlist's order" })).toBeNull();
    const rows = () => within(box().getByRole("list", { name: /^Tracks in The Company themes/ })).getAllByRole("listitem");
    expect(rows()[0]).toHaveTextContent("Epic choir hero anthem");
    within(rows()[0]).getByRole("button", { name: /^Preview / }).focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => expect(rows()[1]).toHaveTextContent("Epic choir hero anthem"));
    await waitFor(() => expect(within(rows()[1]).getByRole("button", { name: /^Preview / })).toHaveFocus());
    expect(Object.keys((await api.playlists.trackOrders())["cp:crown"] ?? {})).toContain("p-company");
    await user.click(await box().findByRole("button", { name: "Back to the playlist's order" }));
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Epic choir hero anthem"));
    await waitFor(() => expect(box().queryByRole("button", { name: "Back to the playlist's order" })).toBeNull());
  });

  it("the campaign's playlists themselves move with Alt+Down on their name", async () => {
    const user = userEvent.setup();
    openAt("campaign/crown");
    await screen.findByRole("region", { name: "Campaign playlists" });
    (await box().findByRole("link", { name: "The Company themes" })).focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => expect(box().getAllByRole("listitem")[1]).toHaveTextContent("The Company themes"));
  });
});
