import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    loadURL: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    setBrowserViewBounds: vi.fn(),
  };
  Object.assign(window, { kenku: api });
  return api;
});

import { URLBar } from "./URLBar";

const loadURL = kenku.loadURL;

beforeEach(() => {
  vi.clearAllMocks();
});

function Harness({ initial = "" }: { initial?: string }) {
  const [url, setUrl] = useState(initial);
  return <URLBar viewId={7} url={url} onURLChange={setUrl} />;
}

async function submit(text: string) {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole("textbox", { name: /web address/i });
  await user.type(input, `${text}{Enter}`);
  return input;
}

describe("URLBar (SEC-6)", () => {
  it("adds https:// to a bare address and loads it", async () => {
    await submit("youtube.com");
    expect(loadURL).toHaveBeenCalledWith(7, "https://youtube.com/");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "steam://run/1",
  ])("refuses %j with a plain-language message", async (text) => {
    const input = await submit(text);
    expect(loadURL).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/https:\/\/ or http:\/\//);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(alert.textContent ?? "");
  });

  it("refuses addresses with a password in them", async () => {
    await submit("https://user:pass@example.com");
    expect(loadURL).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/password/i);
  });

  it("clears the message once the user edits the address", async () => {
    const user = userEvent.setup();
    const input = await submit("file:///x");
    await user.type(input, "y");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("moves the website view so the message is not hidden behind it", async () => {
    await submit("file:///x");
    expect(kenku.setBrowserViewBounds).toHaveBeenCalledWith(
      7,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("gives the navigation buttons accessible names", () => {
    render(<Harness initial="https://example.com" />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /forward/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("lets the browser insert a dropped link as text", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: /web address/i });
    const drop = createEvent.drop(input, {
      dataTransfer: { types: ["text/uri-list", "text/plain"], files: [] },
    });
    fireEvent(input, drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it("says when the page is not secure (http)", () => {
    render(<Harness initial="http://192.168.1.20:8080/" />);
    const input = screen.getByRole("textbox", { name: /web address/i });
    expect(screen.getByText("Not secure")).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/not secure/i);
  });

  it.each(["https://example.com/", "", "example.com"])(
    "shows no security warning for %j",
    (initial) => {
      render(<Harness initial={initial} />);
      expect(screen.queryByText("Not secure")).not.toBeInTheDocument();
    },
  );
});
