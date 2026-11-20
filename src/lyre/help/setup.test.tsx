import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFakeLyreApi } from "../../common/lyre/fake";
import { AppProviders } from "../AppProviders";
import { FakeLyreAudio } from "../audio/testing/fakeLyreAudio";
import { Shell } from "../shell/Shell";
import { CAMPAIGN_SCREENS } from "../screens/campaigns/testing";
import { SETUP_TASKS } from "./setup";
import { TOURS } from "./tours";

// Built screens can reach the audio host, whose worklet file is a webpack asset.
vi.mock("../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

function start(path: string, options: { firstRunTour?: boolean } = {}) {
  const api = createFakeLyreApi();
  const audio = new FakeLyreAudio();
  window.history.replaceState(null, "", `#/${path}`);
  render(
    <AppProviders api={api} audio={audio}>
      <Shell screens={CAMPAIGN_SCREENS} firstRunTour={options.firstRunTour} />
    </AppProviders>,
  );
  return { api, audio };
}

const help = () => screen.getByRole("complementary", { name: "Help" });

beforeEach(() => localStorage.clear());

describe("Set up Lyre (round 9 §4, round 10)", () => {
  it("has nine tasks in the order a new table needs them", () => {
    expect(SETUP_TASKS.map((t) => t.title)).toEqual([
      "Connect a Discord bot",
      "Put the bot in a room",
      "Add your music",
      "Tag a few tracks",
      "Make a playlist",
      "Plan a session and its scenes",
      "Build a pad board",
      "Run a scene in Live",
      "Choose a theme (optional)",
    ]);
  });

  it("Help starts with On this screen, then Set up Lyre, its tasks ticked from the library, each with Show me", async () => {
    start("campaigns");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(within(help()).getByRole("button", { name: "Tour of this screen" })).toBeInTheDocument();
    const setup = within(help()).getByRole("region", { name: "Set up Lyre" });
    const items = within(setup).getAllByRole("listitem");
    expect(items).toHaveLength(9);
    // The sample library has music, tagged tracks, playlists, a planned session and pad boards.
    await waitFor(() => expect(items[2]).toHaveTextContent("Add your music, done"));
    expect(within(items[0]).getByRole("button", { name: "Show me: Connect a Discord bot" })).toBeInTheDocument();
    expect(within(items[2]).getByRole("button", { name: "Show me again: Add your music" })).toBeInTheDocument();
  });

  it("Hide folds it to one line, remembered", async () => {
    start("campaigns");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    const setup = within(help()).getByRole("region", { name: "Set up Lyre" });
    await userEvent.click(within(setup).getByRole("button", { name: "Hide" }));
    expect(within(setup).queryByRole("list")).toBeNull();
    expect(within(setup).getByRole("button", { name: "Show" })).toHaveAttribute("aria-expanded", "false");
  });

  it("Show me closes Help, goes to the screen and points at its controls, with the tour's name", async () => {
    start("campaigns");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(within(help()).getByRole("button", { name: /^Show me( again)?: Add your music$/ }));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe("#/library"));
    expect(await screen.findByRole("dialog", { name: /Track library · 1 of \d$/ }, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe("the first start (Nik, 18 Nov 03:14, answer 5b)", () => {
  it("Done on the tour's last step opens Help at Set up Lyre", async () => {
    const user = userEvent.setup();
    start("campaigns", { firstRunTour: true });
    for (let step = 1; step <= 5; step++) await user.click(within(screen.getByRole("dialog", { name: new RegExp(` ${step} of 5$`) })).getByRole("button", { name: step === 5 ? "Done" : "Next" }));
    expect(within(help()).getByRole("heading", { name: "Set up Lyre" })).toBeInTheDocument();
  });

  it("Skip ends the tour without opening Help", async () => {
    start("campaigns", { firstRunTour: true });
    await userEvent.click(within(screen.getByRole("dialog", { name: / 1 of 5$/ })).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
  });
});

describe("the tours (row 9)", () => {
  it("has a tour for every screen the brief names, Live with its six steps", () => {
    expect(Object.keys(TOURS).sort()).toEqual(["board", "details", "library", "live", "look", "playlists", "rooms", "session", "settings"]);
    expect(TOURS.live.steps.map((s) => s.title)).toEqual(["Next scene", "On air: what the players hear", "Preview: only you", "Pads and their keys", "Undo", "Fade all and Stop all"]);
  });

  it("Tour of this screen stays on a screen that is the tour's own", async () => {
    start("library");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(within(help()).getByRole("button", { name: "Tour of this screen" }));
    expect(await screen.findByRole("dialog", { name: /Track library · 1 of \d$/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/library");
  });

  it("from a screen that leads to the tour's own, Tour of this screen goes there first, as the prototype does", async () => {
    // Campaigns leads to planning a session, a playlist's page to Playlists, the Audio profile to a track's details.
    start("campaigns");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(within(help()).getByRole("button", { name: "Tour of this screen" }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/session\/[\w-]+\/[\w-]+$/));
    expect(await screen.findByRole("dialog", { name: /Planning a session · 1 of \d$/ }, { timeout: 3000 })).toBeInTheDocument();
  });
});
