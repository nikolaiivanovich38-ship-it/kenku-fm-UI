/**
 * Round 5's three screens (design/prototype/src/views/transfer.js) over the in-memory LyreApi seeded from the
 * prototype: the ⋯ beside Add tracks in the Library, Back up, move or share (save, open, choose, bring in, refusals),
 * What came across from Kenku FM, and Find missing files (look, confirm, relink, Undo). Keyboard and axe as well.
 * The packaged app runs the same flows on real files in e2e/specs/library-files.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectNoAxeViolations } from "../../test/axe";
import { dropNames, openAt } from "../library/testHarness";

const region = (name: string) => screen.getByRole("region", { name });

describe("the ⋯ beside Add tracks in the Library", () => {
  it("leads to Back up, move or share, Find missing files (with how many) and the move report", async () => {
    openAt("library");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More for the library" }));
    const items = await screen.findAllByRole("menuitem");
    await waitFor(() => expect(items.map((i) => i.textContent)).toEqual(["Back up, move or share…", "Find missing files (3)…", "What came across from Kenku FM", "Normalise volume…"]));
    await user.click(screen.getByRole("menuitem", { name: "Find missing files (3)…" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Find missing files" })).toBeInTheDocument();
  });
});

describe("Back up, move or share", () => {
  it("saves the whole library unless another scope is chosen, saying the file's name and where it went", async () => {
    const saved: string[] = [];
    openAt("backup", { choose: { saveFile: (name) => (saved.push(name), `D:\\Shared\\${name}`) } });
    const user = userEvent.setup();
    const save = region("Save to a file");
    expect(within(save).getByRole("radio", { name: /^The whole library/ })).toBeChecked();
    expect(within(save).getAllByRole("radio")).toHaveLength(7);
    await within(save).findByText("Saves Lyre library 2026-11-05.lyre");
    await user.click(within(save).getByRole("radio", { name: /^One playlist/ }));
    await user.selectOptions(within(save).getByRole("combobox", { name: "Which playlist" }), "The Abbess");
    await within(save).findByText("Saves The Abbess.lyre");
    await user.click(within(save).getByRole("button", { name: "Save to a file…" }));
    expect(await within(save).findByRole("status")).toHaveTextContent(/^Saved The Abbess\.lyre \(\d+ KB\) in D:\\Shared\.$/);
    expect(saved).toEqual(["The Abbess.lyre"]);
  });

  it("the tags have no audio files, so Include the audio files cannot be ticked and says why", async () => {
    openAt("backup");
    const user = userEvent.setup();
    const save = region("Save to a file");
    await user.click(within(save).getByRole("radio", { name: /^The tags only/ }));
    const audio = within(save).getByRole("checkbox", { name: /^Include the audio files/ });
    await waitFor(() => expect(audio).toBeDisabled());
    expect(audio).toHaveAccessibleName(/Tags have no audio files\./);
  });

  it("opens a file it saved, lists what is in it, and brings in a copy with Keep both, as one undo step", async () => {
    let path: string | null = null;
    const { api } = openAt("backup", { choose: { saveFile: (name) => (path = `D:\\Shared\\${name}`), lyreFile: () => path } });
    const user = userEvent.setup();
    const save = region("Save to a file");
    await user.click(within(save).getByRole("radio", { name: /^One campaign/ }));
    await within(save).findByText("Saves The Sunken Crown.lyre");
    await user.click(within(save).getByRole("button", { name: "Save to a file…" }));
    await within(save).findByRole("status");

    const open = region("Open a file");
    await user.click(within(open).getByRole("button", { name: "Choose a file…" }));
    const items = await within(open).findAllByRole("listitem");
    expect(items.length).toBeGreaterThan(3);
    const crown = within(open).getByRole("radiogroup", { name: "Campaign The Sunken Crown: you have this already" });
    expect(within(crown).getByRole("radio", { name: "Skip" })).toHaveAttribute("aria-checked", "true");
    // One Tab stop; the arrow keys move and choose.
    within(crown).getByRole("radio", { name: "Skip" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(crown).getByRole("radio", { name: "Merge" })).toHaveAttribute("aria-checked", "true");
    expect(within(crown).getByRole("radio", { name: "Merge" })).toHaveFocus();
    await user.click(within(open).getByRole("button", { name: "Keep both for every item you have already" }));
    expect(within(crown).getByRole("radio", { name: "Keep both" })).toHaveAttribute("aria-checked", "true");
    const before = (await api.campaigns.list()).length;
    await user.click(within(open).getByRole("button", { name: "Bring in" }));
    expect(await within(open).findByRole("status")).toHaveTextContent(/^Brought in/);
    expect((await api.campaigns.list()).length).toBe(before + 1);
    expect((await api.history.state()).undoLabel).toMatch(/^Bring in /);
    await user.click(within(open).getByRole("button", { name: "Open another file" }));
    expect(within(region("Open a file")).getByRole("button", { name: "Choose a file…" })).toBeInTheDocument();
  });

  it("a dropped file that is not a Lyre file is refused in the library's words, and Bring in never shows", async () => {
    openAt("backup");
    const open = region("Open a file");
    dropNames(within(open).getByText("Drop a Lyre file here, or"), ["notes.txt"]);
    expect(await within(open).findByRole("alert")).toHaveTextContent("notes.txt is not a Lyre file, or it is damaged. Nothing was changed.");
    expect(within(open).queryByRole("button", { name: "Bring in" })).toBeNull();
    expect(within(open).getByText("Refused")).toBeInTheDocument();
  });

  it("has no axe failures with a file open", async () => {
    let path: string | null = null;
    const { container } = openAt("backup", { choose: { saveFile: (name) => (path = `D:\\${name}`), lyreFile: () => path } }) as unknown as { container: HTMLElement };
    const user = userEvent.setup();
    await user.click(within(region("Save to a file")).getByRole("button", { name: "Save to a file…" }));
    await within(region("Save to a file")).findByRole("status");
    await user.click(within(region("Open a file")).getByRole("button", { name: "Choose a file…" }));
    await within(region("Open a file")).findByRole("button", { name: "Bring in" });
    await expectNoAxeViolations(container ?? document.body);
  });
});

describe("What came across from Kenku FM", () => {
  it("says what was copied and where it is now, which files Lyre cannot find, and what did not come across", async () => {
    openAt("moved");
    const what = await screen.findByRole("region", { name: "What came across" });
    expect(what).toHaveTextContent("Kenku FM 1.5.5");
    expect(within(what).getAllByRole("row").map((r) => r.textContent)).toEqual(["In KenkuFMHow manyNow in Lyre".replace("KenkuFM", "Kenku FM"), "Playlists9Playlists (Manual)", "Tracks212Library", "Soundboards4Pad boards", "Sounds37Pads on those boards", "Bookmarks6Website tabs"]);
    expect(within(what).getByRole("link", { name: "Pad boards" })).toHaveAttribute("href", "#/boards");
    expect(within(region("Files Lyre cannot find")).getAllByRole("listitem")).toHaveLength(3);
    expect(region("Not brought across")).toHaveTextContent("The play queue and what was playing");
    expect(within(region("Files Lyre cannot find")).getByRole("link", { name: "Find them…" })).toHaveAttribute("href", "#/relink");
  });

  it("a library that started in Lyre says nothing came across", async () => {
    openAt("moved", { moved: null });
    expect(await screen.findByText("Nothing came across from Kenku FM: this library started in Lyre.")).toBeInTheDocument();
  });
});

describe("Find missing files", () => {
  it("looks in a folder, asks before relinking a file it is not sure of, and Relink has Undo", async () => {
    const { api } = openAt("relink", { folderFiles: { "E:\\Music\\Scores": ["07 The Storm.flac"] } });
    const user = userEvent.setup();
    const missing = await screen.findByRole("region", { name: "Missing files" });
    await waitFor(() => expect(within(missing).getAllByRole("row")).toHaveLength(4));
    const look = region("Look in a folder");
    await user.type(within(look).getByRole("textbox", { name: "Look in this folder (and the folders inside it)" }), "E:\\Music\\Scores");
    await user.click(within(look).getByRole("button", { name: "Look there" }));
    // The in-memory library matches by name only: offered, not ticked, with a Preview to listen first.
    const box = await within(look).findByRole("checkbox", { name: "Relink Storm and dark romance, swells - villain's tragic backstory" });
    expect(box).not.toBeChecked();
    expect(within(look).getByText("Same name: check it")).toBeInTheDocument();
    expect(within(look).getByRole("button", { name: /^Preview/ })).toBeInTheDocument();
    expect(within(look).getAllByText("Not in that folder")).toHaveLength(2);
    expect(within(look).getByRole("button", { name: "Relink 0 files" })).toBeDisabled();
    await user.click(box);
    await user.click(within(look).getByRole("button", { name: "Relink 1 file" }));
    expect(await screen.findByText("Relinked 1 file to E:\\Music\\Scores.", { selector: ".tf-done span" })).toBeInTheDocument();
    await waitFor(() => expect(within(region("Missing files")).getAllByRole("row")).toHaveLength(3));
    await user.click(within(screen.getByRole("group", { name: "Undo" })).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(within(region("Missing files")).getAllByRole("row")).toHaveLength(4));
    expect((await api.import.findMissing()).length).toBe(3);
  });

  it("Look there with nothing typed asks for the folder", async () => {
    const asked: string[] = [];
    openAt("relink", { choose: { folder: () => (asked.push("folder"), null) } });
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Look in a folder" });
    await user.click(screen.getByRole("button", { name: "Look there" }));
    await waitFor(() => expect(asked).toEqual(["folder"]));
  });

  it("after Look there focus goes to Relink, unless the game master moved on meanwhile (the sweeps tab through)", async () => {
    openAt("relink", { folderFiles: { "E:\\Music\\Scores": ["07 The Storm.flac"] } });
    const user = userEvent.setup();
    const look = await screen.findByRole("region", { name: "Look in a folder" });
    await user.type(within(look).getByRole("textbox", { name: "Look in this folder (and the folders inside it)" }), "E:\\Music\\Scores");
    await user.click(within(look).getByRole("button", { name: "Look there" }));
    // Lyre ticked nothing (a match by name only), so the first file to tick has focus.
    await waitFor(() => expect(within(look).getByRole("checkbox", { name: /^Relink Storm/ })).toHaveFocus());
    // Again, but the game master moves to the folder box before Lyre answers: focus stays there.
    await user.click(within(look).getByRole("button", { name: "Look there" }));
    within(look).getByRole("textbox", { name: "Look in this folder (and the folders inside it)" }).focus();
    await new Promise((r) => setTimeout(r, 100));
    expect(within(look).getByRole("textbox", { name: "Look in this folder (and the folders inside it)" })).toHaveFocus();
  });
});
