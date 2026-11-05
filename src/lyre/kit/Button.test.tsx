import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, IconButton, Segmented, ToggleButton } from "./Button";
import { expectNoAxeViolations } from "../test/axe";

describe("Button and IconButton (A11Y-2)", () => {
  it("is a plain button that never submits a form, with its icon hidden from screen readers", async () => {
    const onClick = vi.fn();
    render(
      <Button icon="play" variant="primary" onClick={onClick}>
        Start scene
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Start scene" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("btn", "primary");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("names an icon-only button by what it does, and shows the same words on hover", () => {
    render(<IconButton icon="close" label="Close" quiet />);
    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("title", "Close");
    expect(button).toHaveClass("closer");
  });

  it("can give a longer hover hint than its name", () => {
    render(<IconButton icon="broadcast" label="Play on air: Crypt drips" hint="Play on air (the players hear it)" size="s" />);
    const button = screen.getByRole("button", { name: "Play on air: Crypt drips" });
    expect(button).toHaveAttribute("title", "Play on air (the players hear it)");
    expect(button).toHaveClass("btn", "s", "icon");
  });

  it("works from the keyboard", async () => {
    const onClick = vi.fn();
    render(<IconButton icon="stop" label="Stop" onClick={onClick} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Stop" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("passes axe", async () => {
    render(
      <div>
        <Button>Preview</Button>
        <IconButton icon="more" label="More for The Company themes" />
      </div>,
    );
    await expectNoAxeViolations();
  });
});

describe("ToggleButton and Segmented (A11Y-3: toggles say whether they are on)", () => {
  function Keys() {
    const [on, setOn] = useState(false);
    return (
      <ToggleButton pressed={on} onPressedChange={setOn} icon="grid">
        Keys
      </ToggleButton>
    );
  }

  it("says whether it is on with aria-pressed and flips on click or key", async () => {
    render(<Keys />);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Keys" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  function Mode() {
    const [mode, setMode] = useState("prep");
    return (
      <Segmented
        label="Prep or live"
        value={mode}
        onChange={setMode}
        options={[
          { value: "prep", label: "Prep", icon: "edit" },
          { value: "live", label: "Live", icon: "broadcast" },
        ]}
      />
    );
  }

  it("groups choices under one name and presses exactly one", async () => {
    render(<Mode />);
    const group = screen.getByRole("group", { name: "Prep or live" });
    expect(group).toHaveClass("seg");
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Prep" })).toHaveAttribute("aria-pressed", "false");
    await expectNoAxeViolations();
  });
});
