import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import useFileDrop, { FileInfo } from "./useFileDrop";
import { installDragEventPolyfill } from "./testing/dragEventPolyfill";
import { fakeDataTransfer, fakeFile } from "./testing/fakeDataTransfer";
import { audioFileType, FileTypeRule, imageFileType } from "./fileTypes";

type HarnessProps = {
  onDrop: (files: FileInfo[]) => void;
  fileType?: FileTypeRule;
  multiple?: boolean;
};

function Harness({
  onDrop,
  fileType = audioFileType,
  multiple = false,
}: HarnessProps) {
  const { rootProps, inputProps, isDragging } = useFileDrop({
    onDrop,
    fileType,
    multiple,
  });
  return (
    <div data-testid="outer">
      <button
        data-testid="zone"
        type="button"
        {...rootProps}
      >
        <input data-testid="input" {...inputProps} />
        <span data-testid="label">
          {isDragging ? "Drop the track here..." : "Click to select a track"}
        </span>
      </button>
    </div>
  );
}

beforeAll(() => {
  installDragEventPolyfill();
});

beforeEach(() => {
  window.player = {
    getPathForFile: (file: File) => `/music/${file.name}`,
  } as unknown as typeof window.player;
});

function dragFilesIn() {
  fireEvent.dragEnter(screen.getByTestId("zone"), {
    dataTransfer: fakeDataTransfer({ files: [fakeFile("a.mp3", "audio/mpeg")] }),
  });
  expect(screen.getByTestId("label")).toHaveTextContent("Drop the track here");
}

describe("useFileDrop drag state (BUG-1)", () => {
  it("ignores text and link drags", () => {
    render(<Harness onDrop={vi.fn()} />);
    fireEvent.dragEnter(screen.getByTestId("zone"), {
      dataTransfer: fakeDataTransfer({ strings: ["hello"] }),
    });
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
  });

  it("does not throw on dragleave (old code read rootRef.current.parentElement)", () => {
    render(<Harness onDrop={vi.fn()} />);
    dragFilesIn();
    expect(() =>
      fireEvent.dragLeave(screen.getByTestId("zone"), { relatedTarget: null })
    ).not.toThrow();
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
  });

  it("resets when the drag leaves the window", () => {
    render(<Harness onDrop={vi.fn()} />);
    dragFilesIn();
    fireEvent.dragLeave(screen.getByTestId("zone"), { relatedTarget: null });
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
  });

  it("resets when the drag moves to a sibling inside the dialog", () => {
    render(<Harness onDrop={vi.fn()} />);
    dragFilesIn();
    fireEvent.dragLeave(screen.getByTestId("zone"), {
      relatedTarget: document.body,
    });
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
  });

  it("stays active while moving onto its own label", () => {
    render(<Harness onDrop={vi.fn()} />);
    dragFilesIn();
    fireEvent.dragLeave(screen.getByTestId("zone"), {
      relatedTarget: screen.getByTestId("label"),
    });
    expect(screen.getByTestId("label")).toHaveTextContent("Drop the track here");
  });

  it.each([
    ["dragend", () => fireEvent.dragEnd(window)],
    ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
    ["window blur", () => fireEvent.blur(window)],
  ])("resets on %s", (_, cancel) => {
    render(<Harness onDrop={vi.fn()} />);
    dragFilesIn();
    cancel();
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
  });
});

describe("useFileDrop accepted files (BUG-10)", () => {
  it.each([
    ["a.m4a", "audio/x-m4a", true],
    ["b.flac", "", true],
    ["c.wav", "audio/x-wav", true],
    ["d.mp3", "audio/mpeg", true],
    ["cover.jpg", "image/jpeg", false],
  ])("drop of %s (%s) accepted: %s", (name, type, accepted) => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    dragFilesIn();
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: fakeDataTransfer({ files: [fakeFile(name, type)] }),
    });
    expect(screen.getByTestId("label")).toHaveTextContent("Click to select");
    expect(onDrop).toHaveBeenCalledWith(
      accepted ? [{ path: `/music/${name}`, name }] : [],
      accepted ? [] : [name]
    );
  });

  it("accepts images by extension when the image MIME type is missing", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} fileType={imageFileType} />);
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: fakeDataTransfer({ files: [fakeFile("map.webp", "")] }),
    });
    expect(onDrop).toHaveBeenCalledWith([{ path: "/music/map.webp", name: "map.webp" }], []);
  });

  it("only takes the first file when multiple is off", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: fakeDataTransfer({
        files: [fakeFile("a.mp3", "audio/mpeg"), fakeFile("b.mp3", "audio/mpeg")],
      }),
    });
    expect(onDrop).toHaveBeenCalledWith([{ path: "/music/a.mp3", name: "a.mp3" }], []);
  });

  it("does nothing for a drop without files", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    fireEvent.drop(screen.getByTestId("zone"), {
      dataTransfer: fakeDataTransfer({ types: ["Files"] }),
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("picks files with the hidden file input", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    fireEvent.change(screen.getByTestId("input"), {
      target: { files: [fakeFile("a.opus", "")] },
    });
    expect(onDrop).toHaveBeenCalledWith([{ path: "/music/a.opus", name: "a.opus" }], []);
  });

  it("uses the shared audio list for the file picker", () => {
    render(<Harness onDrop={vi.fn()} fileType={audioFileType} />);
    const accept = screen.getByTestId("input").getAttribute("accept") ?? "";
    expect(accept).toContain(".m4a");
    expect(accept).toContain(".flac");
  });
});
