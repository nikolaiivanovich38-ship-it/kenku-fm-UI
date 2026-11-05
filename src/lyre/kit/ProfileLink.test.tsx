/** The "Audio profile" link-button (the prototype's L.profileLink in views/profile.js). */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../test/axe";
import { ProfileLink } from "./ProfileLink";

describe("ProfileLink", () => {
  it("opens the track's own settings, says what they are in its hover text, and marks a track that has them", async () => {
    render(<ProfileLink trackId="t13" title="Bridge" hasOwn />);
    const link = screen.getByRole("link", { name: /^Audio profile ?\(has settings\)$/ });
    expect(link).toHaveAttribute("href", "#/profile/t13");
    expect(link).toHaveAttribute("title", "Audio profile: where Bridge starts, ends, fades, loops or moves on");
    expect(link).toHaveClass("btn", "s", "ap-link");
    expect(link.querySelector(".ap-link-dot")).not.toBeNull();
    await expectNoAxeViolations();
  });

  it("opens a place's settings, named in the hover text; icon only, it is named after the track", () => {
    render(<ProfileLink trackId="t13" title="Bridge" place="pl:p-company" placeName="the playlist The Company themes" iconOnly hasOwn />);
    const link = screen.getByRole("link", { name: "Audio profile of Bridge" });
    expect(link).toHaveAttribute("href", "#/profile/t13/pl:p-company");
    expect(link).toHaveAttribute("title", "Audio profile: where Bridge starts, ends, fades, loops or moves on (the playlist The Company themes)");
    expect(link).toHaveClass("icon");
    expect(link.querySelector(".ap-link-dot")).toBeNull();
  });
});
