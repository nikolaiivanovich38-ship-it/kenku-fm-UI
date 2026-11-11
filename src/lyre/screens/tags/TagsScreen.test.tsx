import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFakeLyreApi } from "../../../common/lyre/fake";
import { LyreApiProvider } from "../../api";
import { AnnouncerProvider } from "../../shell/Announcer";
import { ShellDataProvider } from "../../shell/ShellData";
import { ShellSettingsProvider } from "../../shell/ShellSettings";
import { UndoNoteBar, UndoNoteProvider } from "../../shell/UndoNote";
import { parseRoute } from "../../shell/routes";
import { expectNoAxeViolations } from "../../test/axe";
import { TagsScreen } from "./TagsScreen";

function renderTags() {
  const api = createFakeLyreApi();
  window.history.replaceState(null, "", "#/tags");
  const view = render(
    <LyreApiProvider api={api}>
      <ShellSettingsProvider>
        <AnnouncerProvider>
          <ShellDataProvider value={{ history: api.history }}>
            <UndoNoteProvider live={false}>
              <main>
                <TagsScreen route={parseRoute("tags")} />
              </main>
              <UndoNoteBar />
            </UndoNoteProvider>
          </ShellDataProvider>
        </AnnouncerProvider>
      </ShellSettingsProvider>
    </LyreApiProvider>,
  );
  return { ...view, api };
}

const group = (name: string) => screen.getByRole("region", { name });
const tagRow = (groupName: string, name: string) =>
  within(within(group(groupName)).getByRole("list", { name: `${groupName} tags` }))
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(name, { exact: true }));
const regionNames = () => within(screen.getByRole("main")).getAllByRole("region").map((r) => r.getAttribute("aria-label"));

async function tagMenu(user: ReturnType<typeof userEvent.setup>, groupName: string, tag: string, item: string) {
  await user.click(within(group(groupName)).getByRole("button", { name: `More for ${tag}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

beforeEach(() => localStorage.clear());

describe("the Tags screen (r7tags.js)", () => {
  it("shows each group as its own box in order, with tags inside tags and their other words read out", async () => {
    renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    expect(screen.getByRole("heading", { level: 1, name: "Tags" })).toBeInTheDocument();
    expect(regionNames().slice(0, 3)).toEqual(["Mood", "Leitmotif", "Scene type"]);
    expect(tagRow("Mood", "Grief")).toHaveAccessibleDescription(/^Inside Melancholy\. \d+ tracks?\.$/);
    expect(tagRow("Mood", "Melancholy")).toHaveAccessibleDescription(/Also found by: sad, sorrowful/);
  });

  it("Rename changes the tag on every track in one step, and Undo takes it back", async () => {
    const user = userEvent.setup();
    const { api } = renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    await tagMenu(user, "Mood", "Wistful", "Rename…");
    const d = screen.getByRole("dialog", { name: "Rename Wistful" });
    await user.clear(within(d).getByRole("textbox", { name: "Name" }));
    await user.type(within(d).getByRole("textbox", { name: "Name" }), "Longing");
    await user.click(within(d).getByRole("button", { name: "Rename" }));
    const note = await screen.findByRole("group", { name: "Undo" });
    expect(note).toHaveTextContent(/Renamed Wistful to Longing on \d+ tracks/);
    await waitFor(() => expect(tagRow("Mood", "Longing")).toBeDefined());
    expect((await api.library.listTracks()).some((t) => t.tags.mood?.includes("Wistful"))).toBe(false);
    await user.click(within(note).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(tagRow("Mood", "Wistful")).toBeDefined());
  });

  it("UX-R20: Enter in Rename's name field renames; UX-R19: Ctrl+Z then puts focus back on the tag's ⋯", async () => {
    const user = userEvent.setup();
    renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    await tagMenu(user, "Mood", "Wistful", "Rename…");
    const d = screen.getByRole("dialog", { name: "Rename Wistful" });
    await user.clear(within(d).getByRole("textbox", { name: "Name" }));
    await user.type(within(d).getByRole("textbox", { name: "Name" }), "Longing{Enter}");
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent(/Renamed Wistful to Longing/);
    await waitFor(() => expect(within(group("Mood")).getByRole("button", { name: "More for Longing" })).toHaveFocus());
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(within(group("Mood")).getByRole("button", { name: "More for Wistful" })).toHaveFocus());
  });

  it("Merge into… gives the tracks the other tag, whose other words then include the old name", async () => {
    const user = userEvent.setup();
    renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    await tagMenu(user, "Mood", "Grief", "Merge into…");
    await user.selectOptions(screen.getByRole("combobox", { name: "Merge Grief into" }), "Melancholy");
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent("Merged Grief into Melancholy");
    await waitFor(() => expect(tagRow("Mood", "Grief")).toBeUndefined());
    expect(tagRow("Mood", "Melancholy")).toHaveAccessibleDescription(/grief/);
  });

  it("Delete… says how many tracks it comes off, and takes it off them", async () => {
    const user = userEvent.setup();
    renderTags();
    await screen.findByRole("list", { name: "Scene type tags" });
    await tagMenu(user, "Scene type", "Chase", "Delete…");
    const d = screen.getByRole("dialog", { name: "Delete Chase?" });
    expect(d).toHaveTextContent(/It comes off \d+ tracks?\./);
    await user.click(within(d).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(tagRow("Scene type", "Chase")).toBeUndefined());
  });

  it("New group and Add tag make a group with its own tag; groups move; a colour is chosen by name", async () => {
    const user = userEvent.setup();
    const { api } = renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Faction");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add group" }));
    await user.click(await within(await screen.findByRole("region", { name: "Faction" })).findByRole("button", { name: "Add tag" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Harbour guild");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add tag" }));
    await waitFor(() => expect(tagRow("Faction", "Harbour guild")).toBeDefined());

    await user.click(within(group("Mood")).getByRole("button", { name: "More for the Mood group" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(regionNames().slice(0, 2)).toEqual(["Leitmotif", "Mood"]));

    await user.click(within(group("Mood")).getByRole("button", { name: "More for the Mood group" }));
    await user.click(screen.getByRole("menuitem", { name: "Colour…" }));
    await user.click(screen.getByRole("radio", { name: "Sea" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(async () => expect((await api.tags.listGroups()).find((g) => g.id === "mood")?.color).toBe("sea"));
    expect(tagRow("Mood", "Melancholy")).toHaveTextContent("Melancholy");
  });

  it("has no accessibility problems", async () => {
    const { container } = renderTags();
    await screen.findByRole("list", { name: "Mood tags" });
    await expectNoAxeViolations(container);
  });
});
