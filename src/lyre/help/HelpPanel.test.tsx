/** FND-8 Help's side panel and FND-9 Save diagnostics (design/prototype/HELP.md, views/help.js). */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpPanel } from "./HelpPanel";
import { AnnouncerProvider } from "../shell/Announcer";
import { expectNoAxeViolations } from "../test/axe";
import type { DiagnosticsBridge, DiagnosticsResult } from "../../common/lyreDiagnostics";

function bridge(answer: Promise<DiagnosticsResult> | DiagnosticsResult) {
  const save = vi.fn((): Promise<DiagnosticsResult> => Promise.resolve(answer));
  const show = vi.fn((): void => undefined);
  const made: DiagnosticsBridge = { save, show };
  return Object.assign(made, { save, show });
}

function panel(props: Partial<React.ComponentProps<typeof HelpPanel>> = {}) {
  const onClose = vi.fn();
  const onTour = vi.fn();
  render(
    <AnnouncerProvider>
      <HelpPanel onClose={onClose} onTour={onTour} diagnostics={null} {...props} />
    </AnnouncerProvider>,
  );
  return { onClose, onTour, help: screen.getByRole("complementary", { name: "Help" }) };
}

describe("Help's panel", () => {
  it("lists the articles by task, one list per group, with the search box focused", () => {
    const { help } = panel();
    expect(within(help).getByRole("heading", { level: 2, name: "Help" })).toBeInTheDocument();
    expect(within(help).getByRole("searchbox", { name: "Search help" })).toHaveFocus();
    for (const group of ["Get started", "Prepare", "Run a session", "Your library"]) {
      expect(within(help).getByRole("list", { name: group })).toBeInTheDocument();
    }
    expect(within(help).getAllByRole("listitem")).toHaveLength(15);
  });

  it("finds articles as you type, and says when nothing matches", async () => {
    const user = userEvent.setup();
    const { help } = panel();
    await user.type(within(help).getByRole("searchbox"), "token");
    expect(within(help).queryByRole("list", { name: "Get started" })).toBeNull();
    expect(within(help).getByRole("button", { name: "Connect Discord and add a bot to a room" })).toBeInTheDocument();
    await user.clear(within(help).getByRole("searchbox"));
    await user.type(within(help).getByRole("searchbox"), "zzzz");
    expect(within(help).getByText("Nothing found. Try other words.")).toBeInTheDocument();
  });

  it("Esc in the search box clears it first, then closes Help", async () => {
    const user = userEvent.setup();
    const { help, onClose } = panel();
    await user.type(within(help).getByRole("searchbox"), "token");
    await user.keyboard("{Escape}");
    expect(within(help).getByRole("searchbox")).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens an article with its title focused; Back returns to the list, on that article", async () => {
    const user = userEvent.setup();
    const { help } = panel();
    await user.click(within(help).getByRole("button", { name: "Run a session in Live" }));
    const article = within(help).getByRole("article", { name: "Run a session in Live" });
    expect(within(article).getByRole("heading", { level: 3 })).toHaveFocus();
    expect(article.querySelectorAll("kbd").length).toBeGreaterThan(2);
    expect(within(article).getByText("Fade all", { selector: "b" })).toBeInTheDocument();
    await user.click(within(help).getByRole("button", { name: "Back" }));
    expect(within(help).getByRole("button", { name: "Run a session in Live" })).toHaveFocus();
  });

  it("Close help and Take the tour", async () => {
    const user = userEvent.setup();
    const { help, onClose, onTour } = panel();
    await user.click(within(help).getByRole("button", { name: "Take the tour" }));
    expect(onTour).toHaveBeenCalledTimes(1);
    await user.click(within(help).getByRole("button", { name: "Close help" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps keys typed in it from the screen's single-key shortcuts, but lets F keys, Ctrl keys and Shift+Esc through", () => {
    const { help } = panel();
    const reached: string[] = [];
    const listener = (e: KeyboardEvent) => reached.push(e.key + (e.ctrlKey ? "+ctrl" : "") + (e.shiftKey ? "+shift" : ""));
    document.addEventListener("keydown", listener);
    try {
      const target = within(help).getAllByRole("button")[1];
      fireEvent.keyDown(target, { key: " " });
      fireEvent.keyDown(target, { key: "r" });
      fireEvent.keyDown(target, { key: "F1" });
      fireEvent.keyDown(target, { key: "z", ctrlKey: true });
      fireEvent.keyDown(target, { key: "Escape", shiftKey: true });
    } finally {
      document.removeEventListener("keydown", listener);
    }
    expect(reached).toEqual(["F1", "z+ctrl", "Escape+shift"]);
  });

  it("has no accessibility failures, in the list and in an article", async () => {
    const user = userEvent.setup();
    const { help } = panel();
    await expectNoAxeViolations();
    await user.click(within(help).getByRole("button", { name: "Pad boards" }));
    await expectNoAxeViolations();
  });
});

describe("Save diagnostics (FND-9)", () => {
  it("saves through the main process and says where, with Show in folder", async () => {
    const user = userEvent.setup();
    const diagnostics = bridge({ ok: true, folder: "Documents", file: "Lyre diagnostics 2026-11-06 14-32.zip" });
    const { help } = panel({ diagnostics });
    await user.click(within(help).getByRole("button", { name: "Save diagnostics…" }));
    expect(diagnostics.save).toHaveBeenCalledTimes(1);
    expect(await within(help).findByText("Saved in Documents: Lyre diagnostics 2026-11-06 14-32.zip")).toBeInTheDocument();
    await user.click(within(help).getByRole("button", { name: "Show in folder" }));
    expect(diagnostics.show).toHaveBeenCalledTimes(1);
  });

  it("reads Saving… while it works, and cannot be pressed twice", async () => {
    let finish: (r: DiagnosticsResult) => void = () => undefined;
    const diagnostics = bridge(new Promise<DiagnosticsResult>((resolve) => (finish = resolve)));
    const { help } = panel({ diagnostics });
    fireEvent.click(within(help).getByRole("button", { name: "Save diagnostics…" }));
    const busy = within(help).getByRole("button", { name: "Saving…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(diagnostics.save).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, cancelled: true }));
    expect(within(help).getByRole("button", { name: "Save diagnostics…" })).toBeEnabled();
    expect(within(help).queryByText(/Saved in|Could not/)).toBeNull();
  });

  it("says why it could not save", async () => {
    const user = userEvent.setup();
    const { help } = panel({ diagnostics: bridge({ ok: false, cancelled: false, message: "That folder cannot be written to." }) });
    await user.click(within(help).getByRole("button", { name: "Save diagnostics…" }));
    expect(await within(help).findByText("Could not save diagnostics: That folder cannot be written to.")).toBeInTheDocument();
    expect(within(help).queryByRole("button", { name: "Show in folder" })).toBeNull();
  });
});
