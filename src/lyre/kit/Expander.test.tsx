import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpanderRow } from "./Expander";
import { expectNoAxeViolations } from "../test/axe";

describe("ExpanderRow: look inside a playlist or board in place (UX-5)", () => {
  it("is closed by default, and its button says what it shows or hides", async () => {
    render(
      <ul className="list">
        <ExpanderRow label="The Company themes" row={<span>The Company themes</span>}>
          <ol aria-label="Tracks in The Company themes">
            <li>Marching song</li>
          </ol>
        </ExpanderRow>
      </ul>,
    );
    const user = userEvent.setup();
    const show = screen.getByRole("button", { name: "Show contents of The Company themes" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show).toHaveAttribute("title", "Show what is in The Company themes");
    expect(screen.queryByRole("list", { name: "Tracks in The Company themes" })).toBeNull();
    await user.click(show);
    expect(screen.getByRole("list", { name: "Tracks in The Company themes" })).toBeInTheDocument();
    const hide = screen.getByRole("button", { name: "Hide contents of The Company themes" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(hide).toHaveAttribute("aria-controls", screen.getByRole("list", { name: "Tracks in The Company themes" }).parentElement?.id);
    await expectNoAxeViolations();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("list", { name: "Tracks in The Company themes" })).toBeNull();
  });

  it("can start open", () => {
    render(
      <ul className="list">
        <ExpanderRow label="Weather" row={<span>Weather</span>} defaultOpen>
          <p>Thunder</p>
        </ExpanderRow>
      </ul>,
    );
    expect(screen.getByText("Thunder")).toBeInTheDocument();
  });
});
