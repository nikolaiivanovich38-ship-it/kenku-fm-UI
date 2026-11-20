/**
 * Round 9 and 10 (row 20): a previewed playlist on the Now playing bar has Back, Forward and Queue n; Queue opens the
 * queue at the right: Played, Now playing, Up next with Play on each track to come; × closes it, focus back on Queue.
 */
import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "../library/testHarness";

describe("the preview's queue", () => {
  it("Back, Forward and Queue n on the bar; the queue lists Played, Now playing and Up next, and Play plays from it", async () => {
    const { audio } = openAt("playlists");
    await screen.findByText("21 playlists");
    const user = userEvent.setup();
    audio.previewQueueNow = {
      playlistId: "p-abbess",
      played: [{ trackId: "t41", title: "Alien, unknowable" }],
      now: { trackId: "t14", title: "Now track" },
      upNext: [
        { trackId: "t15", title: "Next one", index: 2 },
        { trackId: "t21", title: "Last one", index: 3 },
      ],
    };
    act(() => audio.setNowPlaying({ preview: { key: "pl:p-abbess", label: "The Abbess: Now track", kind: "playlist", trackId: "t14", playlistId: "p-abbess" } as never }));
    const bar = within(screen.getByRole("region", { name: "Now playing" }));
    await user.click(bar.getByRole("button", { name: "Back" }));
    await user.click(bar.getByRole("button", { name: "Forward" }));
    expect(audio.calls.filter(([m]) => m === "previewBack" || m === "previewForward").map(([m]) => m)).toEqual(["previewBack", "previewForward"]);
    const queueButton = bar.getByRole("button", { name: /^Queue/ });
    expect(queueButton).toHaveTextContent("Queue 2");
    await user.click(queueButton);
    const queue = within(await screen.findByRole("region", { name: "Queue" }));
    expect(queue.getByRole("list", { name: "Played" })).toHaveTextContent("Alien, unknowable");
    expect(queue.getByRole("list", { name: "Now playing" })).toHaveTextContent("Now track");
    expect(within(queue.getByRole("list", { name: "Up next" })).getAllByRole("listitem")).toHaveLength(2);
    await user.click(queue.getByRole("button", { name: "Play now: Last one" }));
    expect(audio.calls).toContainEqual(["previewPlayAt", 3]);
    await user.click(queue.getByRole("button", { name: "Close the queue" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Queue" })).toBeNull());
    await waitFor(() => expect(bar.getByRole("button", { name: /^Queue/ })).toHaveFocus());
  });
});
