import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LegacyTokenNotice, LEGACY_TOKEN_SESSION_ONLY } from "./LegacyTokenNotice";

describe("Settings: notice after an older version's token was moved (WP1 review 4)", () => {
  it("explains why, in plain words, and recommends resetting the token", () => {
    render(<LegacyTokenNotice onDismiss={vi.fn()} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("older version");
    expect(note).toHaveTextContent("unprotected");
    expect(note).toHaveTextContent("reset the token in the Discord Developer Portal");
  });

  it("links to the Developer Portal over https, opened in the system browser", () => {
    render(<LegacyTokenNotice onDismiss={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Discord Developer Portal" });
    expect(link).toHaveAttribute("href", "https://discord.com/developers/applications");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("goes away for good when the user has read it", async () => {
    const onDismiss = vi.fn();
    render(<LegacyTokenNotice onDismiss={onDismiss} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has a plain message for a token that can only be kept for this session (WP1 review 11)", () => {
    expect(LEGACY_TOKEN_SESSION_ONLY).toContain("kept only until Cue Desk closes");
    expect(LEGACY_TOKEN_SESSION_ONLY).toContain("Settings");
  });
});
