/**
 * Round 9 and 10 (rows 13 and 38): a track title outside the Track library opens the Track panel beside the screen,
 * with the Library's own details; × or Esc closes it and focus goes back to the title; Open in Track library; an
 * address naming a track after a playlist opens the panel on it.
 */
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "../library/testHarness";

const panel = () => screen.getByRole("complementary", { name: /./ });

describe("the Track panel", () => {
  it("opens from a track title in an unfolded playlist, shows the track's details, and Esc closes it with focus back on the title", async () => {
    openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show contents of The Abbess" }));
    const link = within(await screen.findByRole("list", { name: "Tracks in The Abbess" })).getAllByRole("link")[0];
    const title = link.textContent ?? "";
    await user.click(link);
    expect(window.location.hash).toBe("#/playlists");
    await waitFor(() => expect(within(panel()).getByRole("heading", { level: 2 })).toHaveTextContent(title));
    expect(within(panel()).getByRole("textbox", { name: "Your title" })).toBeInTheDocument();
    expect(within(panel()).getByRole("group", { name: "Use it for" })).toBeInTheDocument();
    expect(within(panel()).getByRole("link", { name: "Open in Track library" })).toHaveAttribute("href", expect.stringMatching(/^#\/library\//));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: title })).toBeNull());
    await waitFor(() => expect(link).toHaveFocus());
  });

  it("its × closes it; the address #/playlist/<pid>/<tid> opens the playlist with the panel on that track", async () => {
    openAt("playlist/p-abbess/t41");
    const user = userEvent.setup();
    const close = await screen.findByRole("button", { name: "Close the track details" });
    expect(within(panel()).getByRole("heading", { level: 2 })).not.toHaveTextContent("Opening");
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close the track details" })).toBeNull());
  });
});
