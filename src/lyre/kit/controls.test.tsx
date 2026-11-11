import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge, Chip, ChipButton, EnergyMeter, Kbd, StatusPill } from "./Pills";
import { SearchField, Select, Slider, TextField } from "./Fields";
import { expectNoAxeViolations } from "../test/axe";

describe("pills, badges and chips", () => {
  it("shows one status pill per box, coloured by tone", () => {
    render(
      <>
        <StatusPill text="On air" tone="live" />
        <StatusPill text="Silent" />
        <Badge tone="onair">On air</Badge>
        <Kbd>Space</Kbd>
      </>,
    );
    expect(screen.getAllByText("On air")[0]).toHaveClass("pane-status", "s-live");
    expect(screen.getByText("Silent")).toHaveClass("pane-status", "s-idle");
    expect(screen.getAllByText("On air")[1]).toHaveClass("badge", "onair");
    expect(screen.getByText("Space")).toHaveClass("kbd");
  });

  it("marks a tag's group with a dot and keeps its text", () => {
    render(
      <>
        <Chip group="mood" title="Mood">
          Eerie
        </Chip>
        <Chip lane="music">Music</Chip>
      </>,
    );
    expect(screen.getByText("Eerie").closest(".chip")).toHaveClass("chip", "mood");
    expect(screen.getByText("Eerie").closest(".chip")?.querySelector(".dot")).not.toBeNull();
    expect(screen.getByText("Music").closest(".chip")).toHaveClass("music");
  });

  it("removes a chip from a button named after it", async () => {
    const onRemove = vi.fn();
    render(
      <Chip group="motif" onRemove={onRemove}>
        Drowned Abbess
      </Chip>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Drowned Abbess" }));
    expect(onRemove).toHaveBeenCalled();
    await expectNoAxeViolations();
  });

  it("filters with a chip that says whether it is on", async () => {
    function Filter() {
      const [on, setOn] = useState(false);
      return (
        <ChipButton pressed={on} onPressedChange={setOn} group="mood">
          Tense
        </ChipButton>
      );
    }
    render(<Filter />);
    const chip = screen.getByRole("button", { name: "Tense" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("reads an energy meter as words", () => {
    render(<EnergyMeter value={3} />);
    const meter = screen.getByRole("img", { name: "Energy 3 of 5" });
    expect(meter.querySelectorAll(".on")).toHaveLength(3);
  });
});

describe("fields: search, text, choice and slider (A11Y-2, A11Y-3)", () => {
  it("names a search field and clears it with Escape", async () => {
    const onChange = vi.fn();
    function Search() {
      const [q, setQ] = useState("crypt");
      return (
        <SearchField
          label="Search the library"
          value={q}
          onChange={(value) => {
            setQ(value);
            onChange(value);
          }}
        />
      );
    }
    render(<Search />);
    const box = screen.getByRole("searchbox", { name: "Search the library" });
    expect(box).toHaveAttribute("placeholder", "Search");
    box.focus();
    await userEvent.setup().keyboard("{Escape}");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(box).toHaveValue("");
  });

  it("shows a text field's label above it", async () => {
    render(<TextField label="Name" value="The Sunken Crown" onChange={() => undefined} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("The Sunken Crown");
    await expectNoAxeViolations();
  });

  it("chooses from a labelled list (a native select, so it works with every screen reader)", async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Theme"
        value="hearth"
        onChange={onChange}
        options={[
          { value: "candle", label: "Candlelit Library" },
          { value: "hearth", label: "Hearth and Iron" },
        ]}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Theme" });
    expect((select as HTMLSelectElement).selectedOptions[0].label).toBe("Hearth and Iron");
    await userEvent.setup().selectOptions(select, "Candlelit Library");
    expect(onChange).toHaveBeenCalledWith("candle");
    await expectNoAxeViolations();
  });

  it("reads a slider's value in words and moves it with the keyboard", async () => {
    function Volume() {
      const [v, setV] = useState(50);
      return <Slider label="Volume" value={v} min={0} max={100} step={5} onChange={setV} valueText={(n) => `${n}%`} showValue />;
    }
    render(<Volume />);
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveAttribute("aria-valuetext", "50%");
    fireEvent.change(slider, { target: { value: "55" } });
    expect(slider).toHaveAttribute("aria-valuetext", "55%");
    expect(screen.getByText("55%")).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it("can hide a slider's label when the box around it already says what it is", () => {
    render(<Slider label="Volume of Table" hideLabel value={1} min={0} max={1} step={0.01} onChange={() => undefined} />);
    expect(screen.getByRole("slider", { name: "Volume of Table" })).toBeInTheDocument();
    expect(screen.queryByText("Volume of Table")).toBeNull();
  });
});
