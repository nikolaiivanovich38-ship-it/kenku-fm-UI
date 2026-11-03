import React, { useCallback, useRef } from "react";

import {
  Directories,
  FolderImportResult,
  getDroppedEntries,
  importDroppedEntries,
} from "./folderImport";
import { useFileDragState } from "./useFileDragState";

export type { AudioFile, Directory, Directories } from "./folderImport";

/**
 * Drag-and-drop of files and folders onto a playlist or soundboard page.
 *
 * Spread `containerListeners` on the page and `overlayListeners` on the
 * "Drop the tracks here" overlay, which should render while `dragging`.
 * The overlay only opens for file drags and always closes again (BUG-1);
 * folders of any size are read in full (BUG-2); audio is recognised by MIME
 * type or extension (BUG-10).
 *
 * @param onDrop receives the audio found, grouped by folder, plus what was
 *   skipped or unreadable so the caller can tell the user.
 * @param onError called with the error if the import fails unexpectedly.
 */
export function useFolderDrop(
  onDrop: (directories: Directories, result: FolderImportResult) => void,
  onError?: (error: unknown) => void
) {
  const { dragging, onDragEnter, onDragLeave, onDragOver, endDrag } =
    useFileDragState();

  // Keep the latest callbacks without re-creating the handlers.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        // Entries must be taken before the first await; the browser clears
        // the DataTransfer when the event handler returns.
        const entries = getDroppedEntries(event.dataTransfer);
        endDrag();
        if (entries.length === 0) {
          return;
        }
        const result = await importDroppedEntries(entries, {
          getPathForFile: (file) => window.player.getPathForFile(file),
        });
        onDropRef.current(result.directories, result);
      } catch (error) {
        if (onErrorRef.current) {
          onErrorRef.current(error);
        } else {
          console.error(error);
        }
      } finally {
        endDrag();
      }
    },
    [endDrag]
  );

  const containerListeners = { onDragEnter, onDragOver };
  const overlayListeners = { onDragLeave, onDragOver, onDrop: handleDrop };

  return { dragging, containerListeners, overlayListeners };
}
