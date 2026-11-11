/**
 * PLY-15, DAT-15: the Normalise volume control (Library setting / On / Off with the measured line) and the library's
 * Normalise volume dialog, as design/prototype/src/core.js L.normChoice and L.acts.normopen draw them.
 */
import React, { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { normaliseLine, type LibraryNormalise, type NormalisedTrack, type NormaliseChoice as Choice } from "../../common/domain";
import { expectNoAxeViolations } from "../test/axe";
import { NormaliseChoice, NormaliseDialog, playlistNormaliseHint, profileNormaliseHint, trackNormaliseHint } from "./NormaliseChoice";

const OFF: LibraryNormalise = { on: false, target: "standard" };
const t02: NormalisedTrack = { normalise: null, loudness: { lufs: -22.6, truePeakDb: -8 } };

/** The control as a screen uses it: the line follows the choice. */
function TrackControl({ onChange }: { onChange?: (v: Choice | null) => void }) {
  const [value, setValue] = useState<Choice | null>(null);
  const track = { ...t02, normalise: value };
  return (
    <NormaliseChoice
      value={value}
      library={OFF}
      line={normaliseLine(track, null, OFF)}
      hint={trackNormaliseHint(track, OFF)}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("NormaliseChoice", () => {
  it("is a group named Normalise volume with Library setting, On and Off, described by the measured line", () => {
    render(<TrackControl />);
    const group = screen.getByRole("group", { name: "Normalise volume" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Library setting", "On", "Off"]);
    expect(within(group).getByRole("button", { name: "Library setting" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Library setting" })).toHaveAttribute("title", "The library's setting: Off");
    expect(group).toHaveAccessibleDescription("-22.6 LUFS · plays as it is");
    // Where the choice comes from is on hover over the line, not a line of its own.
    expect(screen.getByText("-22.6 LUFS · plays as it is")).toHaveAttribute("title", "True peak -8.0 dBTP. Follows the library (Off), or the playlist it plays from when that has its own choice.");
    expect(document.querySelectorAll(".norm .hint")).toHaveLength(0);
    // The same words for keyboard and screen-reader users: each choice is described by them.
    expect(within(group).getByRole("button", { name: "On" })).toHaveAccessibleDescription("True peak -8.0 dBTP. Follows the library (Off), or the playlist it plays from when that has its own choice.");
  });

  it("choosing On, Off or Library setting says so at once, by mouse and by keyboard", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<TrackControl onChange={changed} />);
    const group = screen.getByRole("group", { name: "Normalise volume" });
    await user.click(within(group).getByRole("button", { name: "On" }));
    expect(changed).toHaveBeenLastCalledWith("on");
    expect(within(group).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveAccessibleDescription("-22.6 LUFS · +4.6 dB");
    expect(screen.getByTitle("True peak -8.0 dBTP. This track's own choice, wherever it plays.")).toHaveTextContent("-22.6 LUFS · +4.6 dB");
    within(group).getByRole("button", { name: "Off" }).focus();
    await user.keyboard("{Enter}");
    expect(changed).toHaveBeenLastCalledWith("off");
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(within(group).getByRole("button", { name: "Library setting" })).toHaveFocus();
    await user.keyboard(" ");
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it("the hints say where the choice comes from, for a playlist and in the Audio profile", () => {
    expect(playlistNormaliseHint({ normalise: "on" }, OFF)).toBe("A track's own choice still comes first.");
    expect(playlistNormaliseHint({ normalise: null }, { on: true, target: "loud" })).toBe("Follows the library (On, Loud (-14 LUFS)). A track's own choice comes first.");
    expect(profileNormaliseHint({ normalise: null }, { name: "Ashen King", normalise: "on" }, OFF)).toBe("In the playlist Ashen King: the playlist's choice (On).");
    expect(profileNormaliseHint({ normalise: "off" }, { name: "Ashen King", normalise: "on" }, OFF)).toBe("In the playlist Ashen King: this track's own choice.");
    expect(profileNormaliseHint({ normalise: null }, null, OFF)).toBe("On its own: the library's setting (Off).");
    expect(trackNormaliseHint({ normalise: null, loudness: null }, OFF)).toBe("Follows the library (Off), or the playlist it plays from when that has its own choice.");
  });

  it("has no accessibility failures", async () => {
    const { container } = render(<TrackControl />);
    await expectNoAxeViolations(container);
  });
});

describe("NormaliseDialog (Library › ⋯ › Normalise volume…)", () => {
  function open(setting: LibraryNormalise = OFF, onSave = vi.fn(), onClose = vi.fn()) {
    render(<NormaliseDialog open setting={setting} measured={66} total={69} onSave={onSave} onClose={onClose} />);
    return { dialog: screen.getByRole("dialog", { name: "Normalise volume" }), onSave, onClose };
  }

  it("is off at first with Standard (-18 LUFS), with what it does on hover and how many tracks are measured; no explanatory lines", () => {
    const { dialog } = open();
    const on = within(dialog).getByRole("checkbox", { name: "Normalise volume for the whole library" });
    expect(on).not.toBeChecked();
    expect(on.closest("label")).toHaveAttribute("title", expect.stringContaining("It adds at most 12 dB and keeps peaks under -1 dBTP."));
    const targets = within(dialog).getByRole("group", { name: "Target level" });
    expect(within(targets).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["quiet", "standard", "loud"]);
    expect(within(targets).getByRole("radio", { name: "Standard (-18 LUFS)" })).toBeChecked();
    expect(within(targets).getByRole("radio", { name: "Quiet (-23 LUFS)" }).closest("label")).toHaveAttribute("title", "The broadcast level. The most room for loud moments.");
    // Seen: "66 of 69 tracks measured"; the rest is for screen readers and on hover.
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^66 of 69 tracks measured\. The rest are measured in the background/);
    expect(within(dialog).getByRole("status")).toHaveAttribute("title", "The rest are measured in the background; until then they play as they are.");
    expect(dialog.querySelectorAll(".body p")).toHaveLength(1);
  });

  it("what is on hover is also the controls' description, for keyboard and screen-reader users (round 6)", () => {
    const { dialog } = open();
    expect(within(dialog).getByRole("checkbox", { name: "Normalise volume for the whole library" })).toHaveAccessibleDescription(expect.stringContaining("It adds at most 12 dB and keeps peaks under -1 dBTP."));
    expect(within(dialog).getByRole("radio", { name: "Quiet (-23 LUFS)" })).toHaveAccessibleDescription("The broadcast level. The most room for loud moments.");
  });

  it("Save keeps the choice; Cancel and Escape change nothing", async () => {
    const user = userEvent.setup();
    const { dialog, onSave, onClose } = open();
    await user.click(within(dialog).getByRole("checkbox", { name: "Normalise volume for the whole library" }));
    await user.click(within(dialog).getByRole("radio", { name: /^Loud/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ on: true, target: "loud" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("opens on the library's setting as it is, its first control focused, and says when every track is measured", () => {
    render(<NormaliseDialog open setting={{ on: true, target: "quiet" }} measured={5} total={5} onSave={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Normalise volume" });
    expect(within(dialog).getByRole("checkbox", { name: "Normalise volume for the whole library" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Normalise volume for the whole library" })).toHaveFocus();
    expect(within(dialog).getByRole("radio", { name: /^Quiet/ })).toBeChecked();
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^5 of 5 tracks measured$/);
    expect(within(dialog).getByRole("status")).not.toHaveAttribute("title");
  });

  it("has no accessibility failures", async () => {
    open();
    await expectNoAxeViolations(document.body);
  });
});
