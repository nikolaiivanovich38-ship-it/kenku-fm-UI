/** 0.5.2 item 17: the Library's Shape filter as a kit piece, for the pickers and Add tracks. */
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrackShape } from "../../common/domain";
import { expectNoAxeViolations } from "../test/axe";
import { matchesShapes, ShapeFilter } from "./ShapeFilter";

function Harness() {
  const [value, setValue] = useState<TrackShape[]>([]);
  return (
    <>
      <ShapeFilter value={value} onChange={setValue} />
      <output>{value.join(",")}</output>
    </>
  );
}

describe("ShapeFilter", () => {
  it("is a group of five shape chips, any number pressed, with Clear while one is", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const group = screen.getByRole("group", { name: "Shape" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Steady", "Builds", "Falls away", "Peaks then falls", "Rises and falls"]);
    expect(within(group).queryByRole("button", { name: "Clear Shape" })).toBeNull();
    await user.click(within(group).getByRole("button", { name: "Builds" }));
    await user.click(within(group).getByRole("button", { name: "Steady" }));
    expect(within(group).getByRole("button", { name: "Builds" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("output")).toHaveTextContent("builds,steady");
    await user.click(within(group).getByRole("button", { name: "Clear Shape" }));
    expect(container.querySelector("output")).toHaveTextContent("");
    await expectNoAxeViolations(container);
  });

  it("matchesShapes: none chosen is any; otherwise the chosen shape, else the suggestion, must be one of them", () => {
    expect(matchesShapes({ shape: null, suggestedShape: null }, [])).toBe(true);
    expect(matchesShapes({ shape: null, suggestedShape: "builds" }, ["builds"])).toBe(true);
    expect(matchesShapes({ shape: "steady", suggestedShape: "builds" }, ["builds"])).toBe(false);
    expect(matchesShapes({ shape: null, suggestedShape: null }, ["steady"])).toBe(false);
  });
});
