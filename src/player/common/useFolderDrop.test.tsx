import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useFolderDrop } from "./useFolderDrop";
import { installDragEventPolyfill } from "./testing/dragEventPolyfill";
import {
  entryFor,
  fakeDataTransfer,
  fakeDirectoryEntry,
} from "./testing/fakeDataTransfer";

type Props = {
  onDrop: (result: unknown) => void;
};

function Harness({ onDrop }: Props) {
  const { dragging, containerListeners, overlayListeners } =
    useFolderDrop(onDrop);
  return (
    <div data-testid="container" {...containerListeners}>
      <span data-testid="child">Playlist</span>
      {dragging && (
        <div data-testid="overlay" {...overlayListeners}>
          <span data-testid="overlay-text">Drop the tracks here...</span>
        </div>
      )}
    </div>
  );
}

function audioFilesIn(result: unknown, path: string): number {
  const directories = (result as Record<string, { audioFiles: unknown[] }>);
  return directories[path]?.audioFiles.length ?? 0;
}

beforeAll(() => {
  installDragEventPolyfill();
});

beforeEach(() => {
  window.player = {
    getPathForFile: (file: File) => `C:\\Music\\${file.name}`,
  } as unknown as typeof window.player;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function startFileDrag() {
  fireEvent.dragEnter(screen.getByTestId("child"), {
    dataTransfer: fakeDataTransfer({ entries: [entryFor("a.mp3", "audio/mpeg")] }),
  });
  expect(screen.getByTestId("overlay")).toBeInTheDocument();
}

describe("useFolderDrop overlay (BUG-1)", () => {
  it("shows the overlay when files are dragged in", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
  });

  it("does not show the overlay for a text or link drag", () => {
    render(<Harness onDrop={vi.fn()} />);
    fireEvent.dragEnter(screen.getByTestId("child"), {
      dataTransfer: fakeDataTransfer({ strings: ["https://example.com"] }),
    });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes when the drag leaves the window", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.dragLeave(screen.getByTestId("overlay"), { relatedTarget: null });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes when the window reports the drag left it", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.dragLeave(document.body, { relatedTarget: null });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("stays open while the pointer moves onto the overlay's own content", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.dragLeave(screen.getByTestId("overlay"), {
      relatedTarget: screen.getByTestId("overlay-text"),
    });
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
  });

  it("closes on dragend", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.dragEnd(window);
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes when the window loses focus", () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.blur(window);
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes on drop even when the drop includes a non-file item", async () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.drop(screen.getByTestId("overlay"), {
      dataTransfer: fakeDataTransfer({
        entries: [entryFor("a.mp3", "audio/mpeg")],
        strings: ["https://example.com"],
      }),
    });
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("closes on drop when a folder cannot be read", async () => {
    render(<Harness onDrop={vi.fn()} />);
    startFileDrag();
    fireEvent.drop(screen.getByTestId("overlay"), {
      dataTransfer: fakeDataTransfer({
        entries: [fakeDirectoryEntry("Broken", [], { failRead: true })],
      }),
    });
    await act(async () => {});
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });
});

describe("useFolderDrop import", () => {
  it("imports every file from folders larger than one reader batch (BUG-2)", async () => {
    const onDrop = vi.fn();
    const combat = fakeDirectoryEntry(
      "Combat",
      Array.from({ length: 150 }, (_, i) => entryFor(`fight ${i}.mp3`, "audio/mpeg"))
    );
    const session = fakeDirectoryEntry("Session", [
      ...Array.from({ length: 249 }, (_, i) => entryFor(`track ${i}.mp3`, "audio/mpeg")),
      combat,
    ]);
    render(<Harness onDrop={onDrop} />);
    startFileDrag();
    fireEvent.drop(screen.getByTestId("overlay"), {
      dataTransfer: fakeDataTransfer({ entries: [session] }),
    });
    await waitFor(() => expect(onDrop).toHaveBeenCalled());
    const result = onDrop.mock.calls[0][0];
    expect(audioFilesIn(result, "/Session")).toBe(249);
    expect(audioFilesIn(result, "/Session/Combat")).toBe(150);
  });

  it("accepts audio by extension when the OS reports an odd MIME type (BUG-10)", async () => {
    const onDrop = vi.fn();
    const folder = fakeDirectoryEntry("Odd", [
      entryFor("a.m4a", "audio/x-m4a"),
      entryFor("b.flac", ""),
      entryFor("c.wav", "audio/x-wav"),
      entryFor("cover.jpg", "image/jpeg"),
    ]);
    render(<Harness onDrop={onDrop} />);
    startFileDrag();
    fireEvent.drop(screen.getByTestId("overlay"), {
      dataTransfer: fakeDataTransfer({ entries: [folder] }),
    });
    await waitFor(() => expect(onDrop).toHaveBeenCalled());
    expect(audioFilesIn(onDrop.mock.calls[0][0], "/Odd")).toBe(3);
  });
});
