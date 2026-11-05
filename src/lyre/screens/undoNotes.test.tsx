/**
 * Large changes offer Undo in a message (and Ctrl+Z), as shrinking a board does (w3-ux 10): Reset to whole track,
 * Delete board, Delete scene, Tag… on many tracks. The whole page over the in-memory library.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLyreApi, type FakeLyreApi } from "../../common/lyre/fake";
import { AppProviders } from "../AppProviders";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { Shell } from "../shell/Shell";
import { SCREENS } from ".";
import { resetLibraryState } from "./library/libraryState";

vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

function openAt(path: string): FakeLyreApi {
  resetLibraryState();
  window.history.replaceState(null, "", `#/${path}`);
  const api = createFakeLyreApi({ now: () => Date.UTC(2026, 10, 5, 12) });
  render(
    <AppProviders api={api} audio={new FakeLyreAudio()}>
      <Shell screens={SCREENS} />
    </AppProviders>,
  );
  return api;
}

const note = () => screen.getByRole("group", { name: "Undo" });
const undoInNote = () => userEvent.click(within(note()).getByRole("button", { name: "Undo" }));

beforeEach(() => localStorage.clear());

describe("Undo after large changes", () => {
  it("Delete board", async () => {
    const api = openAt("boards");
    await userEvent.click(await screen.findByRole("button", { name: "More for Weather and places" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete board…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete board" }));
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent('Deleted the pad board "Weather and places" and took it out of the places that used it.');
    expect(await api.boards.list()).toHaveLength(4);
    await undoInNote();
    await waitFor(async () => expect(await api.boards.list()).toHaveLength(5));
    expect((await api.campaigns.usesOf({ kind: "board", id: "weather" })).length).toBeGreaterThan(0);
  });

  it("Delete scene, undone with Ctrl+Z", async () => {
    const api = openAt("session/crown/s14");
    await userEvent.click(await screen.findByRole("button", { name: "More for Aftermath" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete scene" }));
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent('Deleted scene "Aftermath" and its notes.');
    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await api.campaigns.get("crown"))?.sessions.find((s) => s.id === "s14")?.scenes).toHaveLength(6));
  });

  it("Tag… on several tracks", async () => {
    const api = openAt("library");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Ashes" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Memories of Mother" }));
    await userEvent.click(screen.getByRole("button", { name: "Tag…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Grief, none have it" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add 1 tag to 2 tracks" }));
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent("Added Grief to 2 tracks.");
    await undoInNote();
    await waitFor(async () => {
      const tracks = await api.library.listTracks();
      expect(tracks.filter((t) => t.tags.mood?.includes("Grief") && ["Ashes", "Memories of Mother"].includes(t.title || t.metaTitle))).toHaveLength(0);
    });
  });

  it("Reset to whole track", async () => {
    const api = openAt("profile/t13");
    await userEvent.click(await screen.findByRole("button", { name: "Reset to whole track" }));
    expect(await screen.findByRole("group", { name: "Undo" })).toHaveTextContent("Back to the whole track: 0:00 to 7:21, no loop and no fades.");
    await waitFor(async () => expect((await api.library.listTracks()).find((t) => t.id === "t13")?.profile?.endMs).toBe(441_000));
    await undoInNote();
    await waitFor(async () => expect((await api.library.listTracks()).find((t) => t.id === "t13")?.profile?.endMs).toBe(318_000));
  });
});
