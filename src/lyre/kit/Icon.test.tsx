import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ICON_NAMES, Icon, LyreLogo } from "./Icon";

describe("the icon set (from the prototype's core.js)", () => {
  it("has every icon the prototype draws", () => {
    for (const name of ["play", "stop", "pause", "broadcast", "crown", "library", "playlist", "grid", "users", "palette", "chevdown", "expand", "shrink", "headphones", "close", "more", "search", "fade", "check", "download", "upload", "warn"]) {
      expect(ICON_NAMES).toContain(name);
    }
    // The prototype's round 4 icons (core.js), and round 5's download, upload and warn (views/transfer.js).
    expect(ICON_NAMES).toHaveLength(80);
  });

  it("is decoration only: hidden from screen readers, sized by class", () => {
    const { container } = render(
      <>
        <Icon name="play" />
        <Icon name="stop" size="s" />
        <Icon name="grid" size="l" className="chev" />
        <LyreLogo />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(4);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
    expect(svgs[0]).toHaveClass("i");
    expect(svgs[1]).toHaveClass("i", "s");
    expect(svgs[2]).toHaveClass("i", "l", "chev");
  });
});
