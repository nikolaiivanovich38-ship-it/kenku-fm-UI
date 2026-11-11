import { beforeEach, describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../../test/axe";
import { BoardsScreen } from "./BoardsScreen";
import { renderScreen, spoken, toastText } from "./testing";

const list = () => screen.getByRole("list", { name: "Pad boards" });
const cards = () => within(list()).getAllByRole("listitem");

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/boards");
});

describe("all pad boards (boards.js list view)", () => {
  it("lists each board with its size, its pads and where it is used", async () => {
    renderScreen(BoardsScreen, "boards");
    expect(await screen.findByRole("link", { name: "Combat 4 × 3, 11 pads, 1 empty" })).toHaveAttribute("href", "#/board/combat");
    expect(screen.getByRole("heading", { level: 1, name: "Pad boards" })).toBeInTheDocument();
    expect(screen.getByText("5 boards")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weather and places 4 × 2, 8 pads, 1 spare" })).toBeInTheDocument();
    const weather = cards().find((c) => c.textContent?.includes("Weather and places"))!;
    expect(weather).toHaveTextContent("Used in 8 places");
    expect(within(weather).getByRole("link", { name: "Open Weather and places" })).toHaveAttribute("href", "#/board/weather");
  });

  it("finds boards by name or by a pad's label, shows the pads found, and keeps typing in the search", async () => {
    const user = userEvent.setup();
    renderScreen(BoardsScreen, "boards");
    await screen.findByRole("list", { name: "Pad boards" });
    const search = screen.getByRole("searchbox", { name: "Search pad boards by board name or pad label" });
    await user.type(search, "bell");
    await waitFor(() => expect(cards().length).toBeLessThan(5));
    const abbey = cards().find((c) => c.textContent?.includes("Drowned Abbey"))!;
    expect(abbey).toHaveTextContent("Pads Abbey bell, All bells ring");
    expect(screen.getByText("Showing 2 of 5")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "combat");
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(search).toHaveFocus();
  });

  it("filters by Used, Not used yet and campaign, and says how many are shown", async () => {
    const user = userEvent.setup();
    const { api } = renderScreen(BoardsScreen, "boards");
    await screen.findByRole("list", { name: "Pad boards" });
    await api.boards.create({ name: "Spare room", cols: 2, rows: 2 });
    await waitFor(() => expect(cards()).toHaveLength(6));
    const used = screen.getByRole("group", { name: "Used or not" });
    await user.click(within(used).getByRole("button", { name: "Not used yet" }));
    expect(within(used).getByRole("button", { name: "Not used yet" })).toHaveAttribute("aria-pressed", "true");
    expect(cards()).toHaveLength(1);
    expect(await spoken()).toBe("1 pad boards shown");
    await user.click(within(used).getByRole("button", { name: "All" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /Campaign/ }), "Ash and Masks");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("Elysium court");
  });

  it("offers Show all boards when nothing matches, and goes back to the search", async () => {
    const user = userEvent.setup();
    renderScreen(BoardsScreen, "boards");
    await screen.findByRole("list", { name: "Pad boards" });
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText(/No pad boards match/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all boards" }));
    expect(cards()).toHaveLength(5);
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("previews a board's first pad in the headphones, and the button says it is previewing", async () => {
    const user = userEvent.setup();
    const { audio } = renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "Preview the first pad of Combat" }));
    expect(audio.calls).toContainEqual(["previewPad", "combat", "sword"]);
    act(() => audio.setNowPlaying({ preview: { key: "pad:combat/sword", label: "Sword clash" } }));
    expect(screen.getByRole("button", { name: "Stop preview of Combat" })).toHaveAttribute("aria-pressed", "true");
  });

  it("New board asks for a name and a size, makes the board and opens it", async () => {
    const user = userEvent.setup();
    const { api } = renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "New board" }));
    const sheet = screen.getByRole("dialog", { name: "New pad board" });
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveFocus();
    expect(within(sheet).getByRole("radio", { name: /^4 × 3/ })).toBeChecked();
    await user.type(within(sheet).getByRole("textbox", { name: "Name" }), "Harbour at night");
    await user.click(within(sheet).getByRole("radio", { name: /^6 × 4/ }));
    expect(within(sheet).getByRole("spinbutton", { name: "Columns" })).toHaveValue(6);
    await user.click(within(sheet).getByRole("button", { name: "Make board" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/board\/.+/));
    const made = (await api.boards.list()).find((b) => b.name === "Harbour at night")!;
    expect(made).toMatchObject({ cols: 6, rows: 4 });
    expect(window.location.hash).toBe(`#/board/${made.id}`);
    expect(toastText()).toBe('Made "Harbour at night". Click an empty slot to add a pad.');
  });

  it("a custom size in New board ticks Custom, or the quick size it matches", async () => {
    const user = userEvent.setup();
    renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "New board" }));
    const sheet = screen.getByRole("dialog");
    const cols = within(sheet).getByRole("spinbutton", { name: "Columns" });
    await user.clear(cols);
    await user.type(cols, "5");
    expect(within(sheet).getByRole("radio", { name: /^Custom/ })).toBeChecked();
    await user.clear(cols);
    await user.type(cols, "2");
    const rows = within(sheet).getByRole("spinbutton", { name: "Rows" });
    await user.clear(rows);
    await user.type(rows, "2");
    expect(within(sheet).getByRole("radio", { name: /^2 × 2/ })).toBeChecked();
  });

  it("Delete board… asks first, lists where it is used, and Keep it changes nothing", async () => {
    const user = userEvent.setup();
    const { api } = renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "More for Weather and places" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete board…" }));
    const sheet = screen.getByRole("dialog", { name: 'Delete "Weather and places"?' });
    expect(sheet).toHaveTextContent("This board is used in:");
    expect(sheet).toHaveTextContent("The Sunken Crown (whole campaign)");
    expect(sheet).toHaveTextContent("Its 9 pads go with it. The sound files stay in your library.");
    await user.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await api.boards.list()).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "More for Weather and places" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete board…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete board" }));
    await waitFor(() => expect(cards()).toHaveLength(4));
    // What was deleted is said with Undo in the shell's message (screens/undoNotes.test.tsx).
  });

  it("Duplicate board makes a copy used nowhere yet", async () => {
    const user = userEvent.setup();
    renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "More for Combat" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate board" }));
    expect(await screen.findByRole("link", { name: /^Combat \(copy\)/ })).toBeInTheDocument();
    expect(toastText()).toBe('Made "Combat (copy)". It is not used anywhere yet.');
  });

  it("Use in… lists campaigns, sessions and scenes, ticked where the board is used, and saves", async () => {
    const user = userEvent.setup();
    const { api } = renderScreen(BoardsScreen, "boards");
    await user.click(await screen.findByRole("button", { name: "More for Spellwork" }));
    await user.click(screen.getByRole("menuitem", { name: "Use in…" }));
    const sheet = screen.getByRole("dialog", { name: 'Use "Spellwork" in…' });
    expect(within(sheet).getByRole("checkbox", { name: /The Sixth Year: whole campaign/ })).toBeChecked();
    // Campaigns where the board is not used start folded ("Use in…" shows every campaign).
    const crown = within(sheet).getByRole("button", { name: /^The Sunken Crown/ });
    expect(crown).toHaveAttribute("aria-expanded", "false");
    await user.click(crown);
    await user.click(within(sheet).getByRole("checkbox", { name: /^Session 14: The Drowned Abbey/ }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastText()).toBe('Saved where "Spellwork" is used'));
    const uses = await api.campaigns.usesOf({ kind: "board", id: "spells" });
    expect(uses).toContainEqual({ level: "session", campaignId: "crown", sessionId: "s14" });
  });

  it("has no accessibility failures", async () => {
    renderScreen(BoardsScreen, "boards");
    await screen.findByRole("list", { name: "Pad boards" });
    await expectNoAxeViolations();
  });
});
