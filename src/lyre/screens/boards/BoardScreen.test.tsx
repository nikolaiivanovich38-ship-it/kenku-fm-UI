import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../../test/axe";
import { BoardScreen } from "./BoardScreen";
import { renderScreen, spoken, toastText } from "./testing";

const grid = () => screen.getByRole("group", { name: /^Pads, \d+ columns by \d+ rows$/ });
const PAD = /^(?!Empty slot).*, row \d+, column \d+/;
const pads = () => within(grid()).getAllByRole("button", { name: PAD });
const pad = (label: string) => within(grid()).getByRole("button", { name: new RegExp(`^${label}( \\S+)?: `) });
const spare = () => screen.getByRole("region", { name: "Spare pads" });
const padBox = () => screen.getByRole("region", { name: /^Pad: / });

async function open(path: string, options?: Parameters<typeof renderScreen>[2]) {
  const view = renderScreen(BoardScreen, path, options);
  await screen.findByRole("group", { name: /^Pads, / });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/boards");
});

describe("a pad board: the grid and its size (boards.js board editor)", () => {
  it("shows the board's name, a way back, its pads row by row and the first pad selected", async () => {
    await open("board/weather");
    expect(screen.getByRole("heading", { level: 1, name: "Weather and places" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Pad boards" })).toHaveAttribute("href", "#/boards");
    expect(pads().map((p) => p.getAttribute("aria-label"))).toEqual([
      "Thunder crack 1: One-shot, row 1, column 1",
      "Wolf howl 2: One-shot, row 1, column 2",
      "Owl 3: One-shot, row 1, column 3",
      "Door creak 4: One-shot, row 1, column 4",
      "Horse whinny Q: One-shot, row 2, column 1",
      "Storm W: Toggle loop, row 2, column 2",
      "Wind gust E: One-shot, row 2, column 3",
      "Fire flares R: One-shot, row 2, column 4",
    ]);
    expect(pad("Thunder crack")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Pad: Thunder crack" })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "8 of 8 slots used")).toBeInTheDocument();
  });

  it("only the focused slot is on the Tab path; the tiles' Preview buttons are not", async () => {
    await open("board/weather");
    const tabbable = within(grid()).getAllByRole("button").filter((b) => b.tabIndex === 0);
    expect(tabbable).toEqual([pad("Thunder crack")]);
  });

  it("making it smaller moves the pads that no longer fit to Spare pads, says so, and Undo puts them back", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/weather");
    await user.click(screen.getByRole("button", { name: "Fewer rows" }));
    const [message] = await screen.findAllByText("4 pads moved to Spare pads: Horse whinny, Storm, Wind gust, Fire flares. Nothing was deleted.");
    expect(message.closest("[role=status]")).not.toBeNull();
    await waitFor(() => expect(pads()).toHaveLength(4));
    expect(spare()).toHaveTextContent("5 pads");
    expect(within(spare()).getByRole("button", { name: /^Storm W ?\(key does nothing while spare\)$/ })).toBeInTheDocument();
    expect(within(spare()).getByText(/Pads that are not on the grid wait here; their keys do nothing until you put them back\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(pads()).toHaveLength(8));
    expect(await spoken()).toBe("Undone. Grid is 4 × 2 again.");
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveFocus();
    expect((await api.boards.list()).find((b) => b.id === "weather")!.spare).toHaveLength(1);
  });

  it("making it bigger says how many slots are empty, and Put all back fills them from the spare pads", async () => {
    const user = userEvent.setup();
    await open("board/weather");
    await user.click(screen.getByRole("button", { name: "Fewer rows" }));
    await waitFor(() => expect(pads()).toHaveLength(4));
    await user.click(screen.getByRole("button", { name: "More rows" }));
    expect((await screen.findAllByText("Grid is now 4 × 2: 4 empty slots to fill. Spare pads can go back into them."))[0]).toBeInTheDocument();
    await user.click(within(spare()).getByRole("button", { name: "Put all back" }));
    await waitFor(() => expect(pads()).toHaveLength(8));
    expect(pad("Storm")).toBeInTheDocument();
    expect(await spoken()).toBe("4 pads put back in the grid; 1 still spare");
  });

  it("the size steppers stop at 1 and 8 and say so", async () => {
    const user = userEvent.setup();
    await open("board/weather");
    await user.click(within(screen.getByRole("group", { name: "Quick sizes" })).getByRole("button", { name: /6 columns by 4 rows/ }));
    await waitFor(() => expect(grid()).toHaveAccessibleName("Pads, 6 columns by 4 rows"));
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: "More columns" }));
      await waitFor(() => expect(grid()).toHaveAccessibleName(`Pads, ${7 + i} columns by 4 rows`));
    }
    expect(screen.getByRole("button", { name: "More columns" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "More columns" }));
    expect(await spoken()).toBe("Already at the largest size, 8");
  });

  it("the quick sizes set columns and rows at once, and the current size is pressed", async () => {
    const user = userEvent.setup();
    await open("board/weather");
    const quick = screen.getByRole("group", { name: "Quick sizes" });
    expect(within(quick).getByRole("button", { name: "4×2, 4 columns by 2 rows" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(quick).getByRole("button", { name: "6×4, 6 columns by 4 rows" }));
    await waitFor(() => expect(grid()).toHaveAccessibleName("Pads, 6 columns by 4 rows"));
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "8 of 24 slots used")).toBeInTheDocument();
    expect((await screen.findAllByText("Grid is now 6 × 4: 16 empty slots to fill. Spare pads can go back into them."))[0]).toBeInTheDocument();
  });

  it("an empty slot gets a new pad, selected, with its label ready to type", async () => {
    const user = userEvent.setup();
    await open("board/combat");
    await user.click(screen.getByRole("button", { name: "Empty slot, row 3, column 4. Add a pad" }));
    await waitFor(() => expect(pads()).toHaveLength(12));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Label" })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("New pad");
    expect(await spoken()).toBe("New pad added at row 3, column 4. Give it a label.");
  });

  it("a new pad takes the name of the sound chosen for it (w3-ux 16)", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/combat");
    await user.click(screen.getByRole("button", { name: "Empty slot, row 3, column 4. Add a pad" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("New pad"));
    await user.click(within(padBox()).getByRole("button", { name: "Choose from library…" }));
    const sheet = screen.getByRole("dialog", { name: 'Sounds for "New pad"' });
    await user.click(within(sheet).getByRole("checkbox", { name: /^Heavy door slams/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Heavy door slams"));
    const pad = (await api.boards.list()).find((b) => b.id === "combat")!.slots.find((p) => p?.sound.trackIds.includes("f08"));
    expect(pad?.label).toBe("Heavy door slams");
  });

  it("a pad that has a name keeps it when its sound changes", async () => {
    const user = userEvent.setup();
    await open("board/abbey");
    await user.click(within(padBox()).getByRole("button", { name: "Choose from library…" }));
    const sheet = screen.getByRole("dialog", { name: 'Sounds for "Abbey bell"' });
    await user.click(within(sheet).getByRole("checkbox", { name: /^Heavy door slams/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveValue("Abbey bell");
  });

  it("renames the board as you type", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/weather");
    const name = screen.getByRole("textbox", { name: "Board name" });
    await user.clear(name);
    await user.type(name, "Weather");
    expect(screen.getByRole("heading", { level: 1, name: "Weather" })).toBeInTheDocument();
    await user.tab();
    await waitFor(async () => expect((await api.boards.list()).find((b) => b.id === "weather")!.name).toBe("Weather"));
  });

  it("says when the board is gone", async () => {
    renderScreen(BoardScreen, "board/nowhere");
    expect(await screen.findByRole("heading", { level: 1, name: "Pad board not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Pad boards" })).toHaveAttribute("href", "#/boards");
  });
});

describe("pads on a board: keyboard, drag, preview", () => {
  it("arrow keys move between pads and select them; Alt+arrow moves the selected pad", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/abbey");
    act(() => pads()[0].focus());
    await user.keyboard("{ArrowRight}");
    expect(pads()[1]).toHaveFocus();
    expect(pads()[1]).toHaveAttribute("aria-pressed", "true");
    expect(pads()[1].tabIndex).toBe(0);
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(pads()[2]).toHaveAccessibleName(/^All bells ring 2: /));
    expect(pads()[2]).toHaveFocus();
    expect(await spoken()).toBe("All bells ring moved to row 1, column 3, swapped with Ghost whisper");
    expect((await api.boards.list()).find((b) => b.id === "abbey")!.slots[2]!.id).toBe("bells");
  });

  it("the arrows stop at the edge, and Alt+arrow says so", async () => {
    const user = userEvent.setup();
    await open("board/abbey");
    act(() => pads()[0].focus());
    await user.keyboard("{ArrowLeft}");
    expect(pads()[0]).toHaveFocus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(await spoken()).toBe("Abbey bell is already at the edge");
  });

  it("P previews the focused pad; the tile then says it is previewing, and the selected pad stays selected", async () => {
    const user = userEvent.setup();
    const { audio } = await open("board/abbey");
    act(() => pads()[3].focus());
    await user.keyboard("p");
    expect(audio.calls).toContainEqual(["previewPad", "abbey", "organ"]);
    act(() => audio.setNowPlaying({ preview: { key: "pad:abbey/organ", label: "Organ swell" } }));
    expect(within(grid()).getAllByRole("button", { name: /previewing$/ })).toHaveLength(1);
    expect(within(grid()).getByRole("button", { name: "Stop preview of Organ swell" })).toHaveAttribute("aria-pressed", "true");
    expect(pads()[3]).toHaveFocus();
  });

  it("every pad has its own Preview; clicking one does not change the selection", async () => {
    const user = userEvent.setup();
    const { audio } = await open("board/abbey");
    const previews = within(grid()).getAllByRole("button", { name: /^Preview / });
    expect(previews).toHaveLength(12);
    expect(previews.every((b) => b.tabIndex === -1)).toBe(true);
    await user.click(previews[5]);
    expect(audio.calls).toContainEqual(["previewPad", "abbey", "drip"]);
    expect(pads()[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a pad selects it; clicking it again quickly previews it", async () => {
    const user = userEvent.setup();
    const { audio } = await open("board/abbey");
    await user.click(pad("Chains"));
    expect(pad("Chains")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Pad: Chains" })).toBeInTheDocument();
    expect(await spoken()).toBe("Chains selected for editing");
    await user.click(pad("Chains"));
    expect(audio.calls).toContainEqual(["previewPad", "abbey", "chains"]);
  });

  it("dragging a pad onto another swaps them; onto Spare pads puts it aside", async () => {
    await open("board/abbey");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    // The page's drop guard listens on the document; a pad dragged within the board never reaches it.
    const guarded: string[] = [];
    const guard = (e: Event) => guarded.push(e.type);
    document.addEventListener("dragover", guard);
    document.addEventListener("drop", guard);
    const first = pads()[0];
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(pads()[1], { dataTransfer });
    fireEvent.drop(pads()[1], { dataTransfer });
    await waitFor(() => expect(pads()[1]).toHaveAccessibleName(/^Abbey bell 1: /));
    expect(pads()[0]).toHaveAccessibleName(/^All bells ring 2: /);
    // Spare pads starts closed while it is empty.
    fireEvent.click(within(spare()).getByRole("button", { name: "Spare pads" }));
    fireEvent.dragStart(pads()[1], { dataTransfer });
    fireEvent.drop(within(spare()).getByText(/None\. Drag a pad here/), { dataTransfer });
    await waitFor(() => expect(within(spare()).getByRole("button", { name: /^Abbey bell/ })).toBeInTheDocument());
    document.removeEventListener("dragover", guard);
    document.removeEventListener("drop", guard);
    expect(guarded).toEqual([]);
  });

  it("a right-click on a pad opens its menu: Preview, Play on air, Duplicate, Move to…, Delete", async () => {
    const user = userEvent.setup();
    const { audio } = await open("board/abbey");
    fireEvent.contextMenu(pad("Chains"));
    const menu = screen.getByRole("menu", { name: "Pad" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Preview", "Play on air", "Duplicate pad", "Move to…", "Delete pad…"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Play on air" }));
    expect(audio.calls).toContainEqual(["firePad", "abbey", "chains"]);
  });

  it("Move to… lists Spare pads and every other slot, saying what is there", async () => {
    const user = userEvent.setup();
    await open("board/combat");
    await user.click(screen.getByRole("button", { name: "More for this pad" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const menu = screen.getByRole("menu", { name: "Move to" });
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent("Spare pads");
    await user.click(within(menu).getByRole("menuitem", { name: "Row 3, column 4: empty" }));
    await waitFor(() => expect(pad("Sword clash")).toHaveAccessibleName(/row 3, column 4/));
    expect(await spoken()).toBe("Sword clash moved to row 3, column 4");
  });
});

describe("the selected pad's own box", () => {
  it("has Preview, Play on air, Label, the sound, Play mode and Hotkey", async () => {
    const user = userEvent.setup();
    const { audio } = await open("board/weather");
    const box = screen.getByRole("region", { name: "Pad: Thunder crack" });
    expect(within(box).getByRole("textbox", { name: "Label" })).toHaveValue("Thunder crack");
    expect(within(within(box).getAllByRole("group", { name: "Play mode" })[1]).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "One-shot",
      "Toggle loop",
      "Hold to play",
      "Restart on press",
    ]);
    await user.click(within(box).getByRole("button", { name: "Preview" }));
    expect(audio.calls).toContainEqual(["previewPad", "weather", "thunder"]);
    act(() => audio.setNowPlaying({ preview: { key: "pad:weather/thunder", label: "Thunder crack" } }));
    expect(within(box).getByRole("button", { name: "Stop preview" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(box).getByRole("button", { name: "Play on air" }));
    expect(audio.calls).toContainEqual(["firePad", "weather", "thunder"]);
    expect(await spoken()).toBe("On air: Thunder crack");
  });

  it("a hold pad is let go after a moment when played from its box", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { audio } = await open("board/abbey");
      await user.click(pad("Organ swell"));
      await user.click(within(padBox()).getByRole("button", { name: "Play on air" }));
      expect(audio.calls).toContainEqual(["firePad", "abbey", "organ", "down"]);
      act(() => void vi.advanceTimersByTime(1600));
      expect(audio.calls).toContainEqual(["firePad", "abbey", "organ", "up"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a toggle pad that is on says Stop on air, and the grid says it is on air", async () => {
    const { audio } = await open("board/weather");
    const user = userEvent.setup();
    await user.click(pad("Storm"));
    act(() =>
      audio.setNowPlaying({
        rooms: [{ roomId: "table", name: "Table", music: null, ambience: null, upNext: null, queued: [], effects: [{ trackId: "f04", title: "Storm", padKey: "weather/storm" }] }],
      }),
    );
    expect(within(padBox()).getByRole("button", { name: "Stop on air" })).toHaveAttribute("aria-pressed", "true");
    expect(pad("Storm")).toHaveAccessibleName(/, on air$/);
    expect(screen.getByRole("region", { name: "Pads" })).toHaveTextContent("1 sounding");
  });

  it("the play mode is chosen with buttons and explained in words", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/weather");
    const box = screen.getByRole("region", { name: "Pad: Thunder crack" });
    expect(box).toHaveTextContent("Plays once from the start on each press. Quick presses overlap.");
    await user.click(within(within(box).getAllByRole("group", { name: "Play mode" })[1]).getByRole("button", { name: "Toggle loop" }));
    await waitFor(() => expect(pad("Thunder crack")).toHaveAccessibleName(/Toggle loop/));
    expect(within(box).getByRole("button", { name: "Toggle loop" })).toHaveAttribute("aria-pressed", "true");
    expect(box).toHaveTextContent("First press starts a loop; the next press fades it out.");
    expect((await api.boards.list()).find((b) => b.id === "weather")!.slots[0]!.mode).toBe("toggle");
  });

  it("a key another pad has warns, and Take it from that pad clears the other pad's key", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/combat");
    await user.click(within(padBox()).getByRole("button", { name: /^Hotkey/ }));
    expect(within(padBox()).getByRole("button", { name: /^Hotkey/ })).toHaveTextContent("Press a key…");
    await user.keyboard("q");
    expect(await within(padBox()).findByText('Q is also the key for "Fireball" on this board.')).toBeInTheDocument();
    expect(await spoken()).toBe("Hotkey Q. Warning: Fireball uses it too");
    await user.click(within(padBox()).getByRole("button", { name: "Take it from that pad" }));
    await waitFor(() => expect(pad("Fireball")).toHaveAccessibleName(/^Fireball: /));
    expect(await spoken()).toBe("Q now belongs to Sword clash only. Fireball has no key.");
    expect((await api.boards.list()).find((b) => b.id === "combat")!.slots[0]!.key).toBe("q");
  });

  it("hotkey capture: Esc cancels, Backspace removes the key, F1 to F12 work and other keys are refused", async () => {
    const user = userEvent.setup();
    await open("board/combat");
    const keycap = () => within(padBox()).getByRole("button", { name: /^Hotkey/ });
    await user.click(keycap());
    await user.keyboard("{Escape}");
    expect(await spoken()).toBe("Hotkey unchanged");
    expect(keycap()).toHaveAccessibleName("Hotkey 1 Change");
    await user.click(keycap());
    await user.keyboard("{Enter}");
    expect(await spoken()).toBe("That key cannot be used. Try a letter, a number or F1 to F12.");
    await user.keyboard("{F5}");
    await waitFor(() => expect(keycap()).toHaveAccessibleName("Hotkey F5 Change"));
    await user.click(keycap());
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(keycap()).toHaveAccessibleName("Hotkey None. Click, then press a key"));
  });

  it("a pad's sound is library files, with variants played at random or in turn", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/weather");
    const box = screen.getByRole("region", { name: "Pad: Thunder crack" });
    expect(within(box).getByRole("group", { name: "Sound comes from" })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Several variants" })).toHaveAttribute("aria-pressed", "true");
    expect(box).toHaveTextContent("Thunder crack thunder_01.wav");
    expect(within(box).getByRole("button", { name: "Choose from library…" })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Add a file…" })).toBeInTheDocument();
    const order = within(box).getByRole("group", { name: "Order of variants" });
    expect(within(order).getByRole("button", { name: "Random" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(order).getByRole("button", { name: "In turn" }));
    await waitFor(() => expect(within(order).getByRole("button", { name: "In turn" })).toHaveAttribute("aria-pressed", "true"));
    expect((await api.boards.list()).find((b) => b.id === "weather")!.slots[0]!.sound.order).toBe("in_turn");
  });

  it("Choose from library… picks FX tracks; several become variants", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/abbey");
    await user.click(within(padBox()).getByRole("button", { name: "Choose from library…" }));
    const sheet = screen.getByRole("dialog", { name: 'Sounds for "Abbey bell"' });
    expect(within(sheet).getByRole("checkbox", { name: /^Abbey bell, single toll/ })).toBeChecked();
    expect(within(sheet).queryByRole("checkbox", { name: /Tavern/ })).toBeNull();
    await user.click(within(sheet).getByRole("checkbox", { name: /^Heavy door slams/ }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(async () => expect((await api.boards.list()).find((b) => b.id === "abbey")!.slots[0]!.sound).toMatchObject({ kind: "variants", trackIds: ["f06", "f08"] }));
    expect(toastText()).toBe("2 sounds chosen, so the pad plays them as variants");
  });

  it("Any with a tag lists the effects with that tag", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/abbey");
    await user.click(within(padBox()).getByRole("button", { name: "Any with a tag" }));
    const tag = await within(padBox()).findByRole("combobox", { name: "Tag" });
    await user.clear(tag);
    await user.type(tag, "Eerie");
    expect(await within(padBox()).findByText("Each press picks one of these 3 effects.")).toBeInTheDocument();
    await waitFor(async () => expect((await api.boards.list()).find((b) => b.id === "abbey")!.slots[0]!.sound).toMatchObject({ kind: "tag", tag: { group: "mood", value: "Eerie" } }));
  });

  it("colour and icon are radio buttons with their names", async () => {
    const user = userEvent.setup();
    const { api } = await open("board/weather");
    expect(screen.getByRole("radio", { name: "Gold" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Sea" }));
    await user.click(screen.getByRole("radio", { name: "Rain" }));
    await waitFor(async () => expect((await api.boards.list()).find((b) => b.id === "weather")!.slots[0]).toMatchObject({ color: "sea", icon: "rain" }));
  });

  it("the pad's menu duplicates, and deletes after asking", async () => {
    const user = userEvent.setup();
    await open("board/combat");
    await user.click(screen.getByRole("button", { name: "More for this pad" }));
    expect(within(screen.getByRole("menu", { name: "Pad" })).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Duplicate pad", "Move to…", "Delete pad…"]);
    await user.click(screen.getByRole("menuitem", { name: "Duplicate pad" }));
    await waitFor(() => expect(pads()).toHaveLength(12));
    expect(screen.getByRole("region", { name: "Pad: Sword clash (copy)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More for this pad" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete pad…" }));
    const sheet = screen.getByRole("dialog", { name: 'Delete the pad "Sword clash (copy)"?' });
    expect(sheet).toHaveTextContent("The pad goes from Combat. Its sound files stay in your library.");
    await user.keyboard("{Escape}");
    expect(pads()).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "More for this pad" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete pad…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete pad" }));
    await waitFor(() => expect(pads()).toHaveLength(11));
    expect(toastText()).toBe('Deleted the pad "Sword clash (copy)"');
    expect(screen.getByRole("button", { name: "Empty slot, row 3, column 4. Add a pad" })).toHaveFocus();
  });

  it("Used in lists each place with a link, and Use in… opens the places to tick", async () => {
    const user = userEvent.setup();
    await open("board/weather");
    const used = screen.getByRole("region", { name: "Used in" });
    expect(within(used).getByRole("link", { name: "The Sunken Crown (whole campaign)" })).toHaveAttribute("href", "#/campaign/crown");
    expect(used).toHaveTextContent("8 places");
    await user.click(screen.getAllByRole("button", { name: "Use in…" })[0]);
    expect(screen.getByRole("dialog", { name: 'Use "Weather and places" in…' })).toBeInTheDocument();
  });

  it("Delete board… from the board goes back to all pad boards", async () => {
    const user = userEvent.setup();
    await open("board/spells");
    await user.click(screen.getByRole("button", { name: "More for this board" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete board…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete board" }));
    await waitFor(() => expect(window.location.hash).toBe("#/boards"));
  });

  it("has no accessibility failures", async () => {
    await open("board/weather");
    await expectNoAxeViolations();
  });
});
