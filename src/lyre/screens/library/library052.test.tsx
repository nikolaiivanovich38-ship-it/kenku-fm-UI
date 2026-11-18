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
