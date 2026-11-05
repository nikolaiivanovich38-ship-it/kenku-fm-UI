/** The destination tags (design round 5, UX-16): every sound says where it goes, in words, with an icon and a colour. */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { DestTag } from "./DestTag";

describe("DestTag", () => {
  it("On air says the players hear it", () => {
    render(<DestTag to="air" />);
    const tag = screen.getByTitle("The players hear this");
    expect(tag).toHaveTextContent(/^On air$/);
    expect(tag).toHaveClass("dest", "air");
  });

  it("names the room when one is given (two or more rooms)", () => {
    render(<DestTag to="air" room="Side room" />);
    expect(screen.getByTitle("The players hear this in Side room")).toHaveTextContent(/^On air · Side room$/);
  });

  it("Only you says only the game master hears it, in the headphones", () => {
    render(<DestTag to="you" />);
    const tag = screen.getByTitle("Only you hear this, in your headphones");
    expect(tag).toHaveTextContent(/^Only you$/);
    expect(tag).toHaveClass("dest", "you");
  });

  it("paused, the tag turns grey; its words stay", () => {
    render(<DestTag to="air" paused />);
    expect(screen.getByTitle("The players hear this")).toHaveClass("paused");
    expect(screen.getByTitle("The players hear this")).toHaveTextContent(/^On air$/);
  });

  it("has no accessibility failures", async () => {
    const { container } = render(
      <p>
        <DestTag to="air" room="Table" /> <DestTag to="you" paused />
      </p>,
    );
    await expectNoAxeViolations(container);
  });
});
