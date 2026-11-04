import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const kenku = vi.hoisted(() => {
  const api = {
    platform: "win32",
    localFileFolders: { list: vi.fn(), forget: vi.fn() },
  };
  Object.assign(window, { kenku: api });
  return api;
});

import { LocalFilesSettings } from "./LocalFilesSettings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings > Local files (SEC-15)", () => {
  it("lists the folders whose files open without asking", async () => {
    kenku.localFileFolders.list.mockResolvedValue(["C:\\Maps", "D:\\Ambience"]);
    render(<LocalFilesSettings />);
    const list = await screen.findByRole("list", { name: "Folders opened without asking" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "C:\\Maps",
      "D:\\Ambience",
    ]);
  });

  it("forgets a folder, so its files are asked about again", async () => {
    kenku.localFileFolders.list.mockResolvedValue(["C:\\Maps", "D:\\Ambience"]);
    kenku.localFileFolders.forget.mockResolvedValue(["D:\\Ambience"]);
    render(<LocalFilesSettings />);
    await userEvent.setup().click(
      await screen.findByRole("button", { name: "Ask again before opening files in C:\\Maps" }),
    );
    expect(kenku.localFileFolders.forget).toHaveBeenCalledWith("C:\\Maps");
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("C:\\Maps")).not.toBeInTheDocument();
  });

  it("explains what the list is for when it is empty", async () => {
    kenku.localFileFolders.list.mockResolvedValue([]);
    render(<LocalFilesSettings />);
    expect(await screen.findByText(/asks before opening a file from your computer/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
