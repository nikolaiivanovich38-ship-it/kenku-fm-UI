import React, { useRef } from "react";

import { FileTypeRule, isAcceptedFile } from "./fileTypes";
import { useFileDragState } from "./useFileDragState";

export type FileInfo = { path: string; name: string };

/**
 * A click-or-drop zone for picking a single file (or several) from disk,
 * used by the audio and image selectors in the add/edit dialogs.
 *
 * Spread `rootProps` on the zone and `inputProps` on a hidden file input.
 * Drag state follows the shared overlay rules (BUG-1): only file drags
 * activate it, and it resets when the drag leaves, ends, is cancelled with
 * Escape or the window loses focus. Files are accepted by MIME type or
 * extension using `fileType` (BUG-10).
 */
function useFileDrop({
  onDrop,
  multiple,
  fileType,
}: {
  /**
   * Receives the accepted files (empty when none matched `fileType`) and the
   * names of files that were left out, so the caller can explain why.
   */
  onDrop: (files: FileInfo[], rejectedNames: string[]) => void;
  multiple: boolean;
  fileType: FileTypeRule;
}) {
  const { dragging, onDragEnter, onDragLeave, onDragOver, endDrag } =
    useFileDragState();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFiles(fileList: FileList | File[] | null | undefined) {
    const all = fileList ? Array.from(fileList) : [];
    if (all.length === 0) {
      return;
    }
    const files: FileInfo[] = [];
    const rejectedNames: string[] = [];
    for (const file of all.slice(0, multiple ? all.length : 1)) {
      const path = isAcceptedFile(file, fileType)
        ? window.player.getPathForFile(file)
        : "";
      if (path) {
        files.push({ path, name: file.name });
      } else {
        rejectedNames.push(file.name);
      }
    }
    onDrop(files, rejectedNames);
  }

  function onFileDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      onFiles(event.dataTransfer?.files);
    } finally {
      endDrag();
    }
  }

  function onClick() {
    endDrag();
    inputRef.current?.click();
  }

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    onFiles(event.target.files);
    event.target.value = "";
  }

  const rootProps = {
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop: onFileDrop,
    onClick,
  };

  const inputProps = {
    ref: inputRef,
    multiple,
    accept: fileType.accept,
    style: {
      display: "none",
    },
    type: "file",
    onChange,
  };

  return { isDragging: dragging, rootProps, inputProps };
}

export default useFileDrop;
