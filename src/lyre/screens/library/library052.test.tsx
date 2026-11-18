/** Lyre 0.5.2 (Nik's play test of 14 Nov, list of 18 Nov): the Library's fixes and small features, by item number. */
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// The page can start the real audio host, whose worklet file is a webpack asset; these tests use a fake host.
vi.mock("../../../preload/managers/PCMStream.worklet.js?asset", () => ({ default: "pcm.js" }));

import { openAt } from "./testHarness";

const grid = () => screen.getByRole("grid", { name: "Tracks" });
const rowOf = (id: string) => grid().querySelector(`tr[data-tid="${id}"]`) as HTMLElement;
async function loaded() {
  await screen.findByRole("checkbox", { name: "Select Ashes" });
}

describe("item 7: the list shows a track's length, and its length after its Audio profile when that differs", () => {
  it("t13 is 7:21 long and plays 5:18 with its own profile; a track with no profile shows one length", async () => {
    openAt("library");
    await loaded();
    const cut = rowOf("t13").querySelector("td.lb-c-dur") as HTMLElement;
    expect(cut).toHaveTextContent("7:21");
    expect(cut).toHaveTextContent("5:18");
    expect(within(cut).getByTitle("Plays 5:18 with its Audio profile (file 7:21)")).toBeInTheDocument();
    const plain = rowOf("t01").querySelector("td.lb-c-dur") as HTMLElement;
    expect(plain.querySelector(".lb-played")).toBeNull();
  });
});

describe("item 6: either play button on a track's row opens that track's details", () => {
  it("Preview opens the track in Details and previews it; Play on air does the same for another track", async () => {
    const { audio } = openAt("library");
    await loaded();
    const user = userEvent.setup();
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^Preview / }));
    await waitFor(() => expect(window.location.hash).toBe("#/library/t13"));
    expect(audio.calls.some((c) => c[0] === "previewTrack" && c[1] === "t13")).toBe(true);
    await user.click(within(rowOf("t01")).getByRole("button", { name: /^Play on air: / }));
    await waitFor(() => expect(window.location.hash).toBe("#/library/t01"));
    expect(rowOf("t01")).toHaveAttribute("aria-current", "true");
    // More only opens its menu.
    await user.click(within(rowOf("t13")).getByRole("button", { name: /^More for / }));
    expect(window.location.hash).toBe("#/library/t01");
  });
});

describe("item 35: opening a track keeps the list scrolled where it was", () => {
  it("the list is at the same place after a click on a row far down", async () => {
    const tops = new WeakMap<Element, number>();
    const spies = [
      vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
        return tops.get(this) ?? 0;
      }),
      vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, top: number) {
        tops.set(this, Math.max(0, top));
      }),
    ];
    try {
      openAt("library");
      await loaded();
      const box = () => grid().closest(".lb-scroll") as HTMLElement;
      box().scrollTop = 900;
      box().dispatchEvent(new Event("scroll"));
      const user = userEvent.setup();
      await user.click(rowOf("t40").querySelector("td.lb-c-title") as HTMLElement);
      await waitFor(() => expect(window.location.hash).toBe("#/library/t40"));
      await waitFor(() => expect(box().scrollTop).toBe(900));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
