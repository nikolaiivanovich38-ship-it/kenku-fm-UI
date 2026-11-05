/** ORG-11: a track's tags where music is chosen (core.js L.tagStrip): the shape first, three tags, then +n. */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { TagStrip } from "./TagStrip";

const groups = [
  { id: "mood", name: "Mood" },
  { id: "motif", name: "Leitmotif" },
  { id: "scene", name: "Scene type" },
];

const track = (tags: Record<string, string[]>, shape: "builds" | null = "builds") => ({ tags, shape, suggestedShape: null as null });

const visibleChips = (container: HTMLElement) => Array.from(container.querySelectorAll(".chip:not(.ts-more)")).map((c) => c.textContent);

describe("TagStrip", () => {
  it("shows the shape glyph first, then the tags in group order, each with its group's dot and name on hover", () => {
    const { container } = render(<TagStrip track={track({ scene: ["Ritual"], mood: ["Eerie"] })} groups={groups} />);
    const strip = container.querySelector(".tagstrip")!;
    expect(strip.firstElementChild).toHaveClass("sr-only");
    expect(strip.children[1]).toHaveClass("shape-tag");
    expect(visibleChips(container)).toEqual(["Eerie", "Ritual"]);
    expect(screen.getByText("Eerie").closest(".chip")).toHaveClass("mood");
    expect(screen.getByText("Eerie").closest(".chip")).toHaveAttribute("title", "Mood");
    expect(screen.getByText("Ritual").closest(".chip")!.querySelector(".dot")).not.toBeNull();
    expect(container.querySelector(".ts-more.ts-wide")).toBeNull();
    expect(container.querySelector(".ts-more.ts-narrow")).toHaveTextContent("+1");
  });

  it("shows three tags and +n, naming the rest with their groups on hover", () => {
    const { container } = render(<TagStrip track={track({ mood: ["Eerie", "Dread", "Tense"], motif: ["The Abbess"], scene: ["Ritual"] })} groups={groups} />);
    expect(visibleChips(container)).toEqual(["Eerie", "Dread", "Tense"]);
    const more = container.querySelector(".ts-more.ts-wide")!;
    expect(more).toHaveTextContent("+2");
    expect(more).toHaveAttribute("title", "Leitmotif: The Abbess, Scene type: Ritual");
  });

  it("below 820 px only the first tag and +n show: the narrow +n counts every tag after the first", () => {
    const { container } = render(<TagStrip track={track({ mood: ["Eerie", "Dread", "Tense"], motif: ["The Abbess"] })} groups={groups} />);
    // The style sheet hides the later tags and swaps the two counts at that width (ui.css .tagstrip).
    expect(container.querySelectorAll(".chip.ts-later")).toHaveLength(2);
    const narrow = container.querySelector(".ts-more.ts-narrow")!;
    expect(narrow).toHaveTextContent("+3");
    expect(narrow).toHaveAttribute("title", "Mood: Dread, Mood: Tense, Leitmotif: The Abbess");
  });

  it("tells screen readers every tag at once; the chips themselves are hidden from them", () => {
    const { container } = render(<TagStrip track={track({ mood: ["Eerie", "Dread", "Tense", "Grief"] })} groups={groups} />);
    expect(container.querySelector(".sr-only")).toHaveTextContent("Tags: Eerie, Dread, Tense, Grief.");
    container.querySelectorAll(".chip").forEach((chip) => expect(chip).toHaveAttribute("aria-hidden", "true"));
  });

  it("a track with a shape but no tags shows the shape and says it has no tags", () => {
    const { container } = render(<TagStrip track={track({})} groups={groups} />);
    expect(container.querySelector(".sr-only")).toHaveTextContent("Tags: none.");
    expect(container.querySelector(".shape-tag")).not.toBeNull();
  });

  it("shows nothing for a track with neither tags nor shape", () => {
    const { container } = render(<TagStrip track={track({ mood: [] }, null)} groups={groups} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no accessibility failures", async () => {
    const { container } = render(
      <p>
        <TagStrip track={track({ mood: ["Eerie", "Dread", "Tense"], motif: ["The Abbess"] })} groups={groups} />
      </p>,
    );
    await expectNoAxeViolations(container);
  });
});
