/** DAT-13: a track's shape as a small line drawing and its word, the same on every screen (core.js L.shapeGlyph, L.shapeTag). */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TRACK_SHAPES } from "../../common/domain";
import { expectNoAxeViolations } from "../test/axe";
import { SHAPE_PATHS, ShapeGlyph, ShapeTag, shapeHint } from "./ShapeGlyph";

describe("ShapeGlyph", () => {
  it("has a drawing for each of the five shapes, and each is different", () => {
    expect(Object.keys(SHAPE_PATHS).sort()).toEqual([...TRACK_SHAPES].sort());
    expect(new Set(Object.values(SHAPE_PATHS)).size).toBe(5);
  });

  it("is decoration: the word beside it says the shape", () => {
    const { container } = render(<ShapeGlyph shape="builds" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("shape-g");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("path")).toHaveAttribute("d", SHAPE_PATHS.builds);
  });
});

describe("ShapeTag", () => {
  it("shows the drawing and the word, and says on hover whether Lyre suggested it", () => {
    render(<ShapeTag track={{ shape: null, suggestedShape: "peaksThenFalls" }} />);
    const tag = screen.getByTitle("Shape: Peaks then falls (suggested from its loudness)");
    expect(tag).toHaveTextContent(/^Peaks then falls$/);
  });

  it("the game master's choice wins over the suggestion", () => {
    render(<ShapeTag track={{ shape: "steady", suggestedShape: "builds" }} />);
    expect(screen.getByTitle("Shape: Steady")).toHaveTextContent(/^Steady$/);
  });

  it("as the drawing alone, still tells screen readers the shape", () => {
    render(<ShapeTag track={{ shape: null, suggestedShape: "builds" }} iconOnly />);
    const tag = screen.getByTitle("Shape: Builds (suggested from its loudness)");
    expect(tag.querySelector(".sr-only")).toHaveTextContent("Shape: Builds (suggested from its loudness)");
  });

  it("shows nothing for a track with no shape yet", () => {
    const { container } = render(<ShapeTag track={{ shape: null, suggestedShape: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no accessibility failures", async () => {
    const { container } = render(
      <p>
        <ShapeTag track={{ shape: "builds", suggestedShape: null }} /> <ShapeTag track={{ shape: null, suggestedShape: "fallsAway" }} iconOnly />
      </p>,
    );
    await expectNoAxeViolations(container);
  });
});

describe("shapeHint: where the shape in a track's details comes from", () => {
  it("a suggestion says so, and how to change it", () => {
    expect(shapeHint({ shape: null, suggestedShape: "peaksThenFalls" })).toBe("Suggested by Lyre from the track's loudness. Choose another to change it.");
  });
  it("a choice says so, and what Lyre would have suggested when that differs", () => {
    expect(shapeHint({ shape: "steady", suggestedShape: "peaksThenFalls" })).toBe("Your choice. Lyre suggested peaks then falls.");
    expect(shapeHint({ shape: "steady", suggestedShape: "steady" })).toBe("Your choice.");
    expect(shapeHint({ shape: "steady", suggestedShape: null })).toBe("Your choice.");
  });
  it("no shape yet: nothing to say", () => {
    expect(shapeHint({ shape: null, suggestedShape: null })).toBe("");
  });
});
