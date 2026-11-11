import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ICON_NAMES, Icon, LyreLogo } from "./Icon";

describe("the icon set (from the prototype's core.js)", () => {
  it("has every icon the prototype draws", () => {
    for (const name of ["play", "stop", "pause", "broadcast", "crown", "library", "playlist", "grid", "users", "palette", "chevdown", "expand", "shrink", "headphones", "close", "more", "search", "fade", "check", "shuffle", "inorder", "loop", "repeat1", "volume", "upload", "download", "warn", "help", "undo", "mute", "leave", "playair", "history"]) {
      expect(ICON_NAMES).toContain(name);
    }
    // All of the prototype's icons (core.js; round 5 added play order, volume and the transfer screens' download, upload and warn; FND-8 help;
    // round 6 Undo, muted, Kick and Play on air; UX-R14 What played's history), nothing more.
    expect(ICON_NAMES).toHaveLength(89);
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
