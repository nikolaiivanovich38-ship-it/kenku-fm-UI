import React, { useState } from "react";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";

import ExpandLess from "@mui/icons-material/ExpandLessRounded";
import ExpandMore from "@mui/icons-material/ExpandMoreRounded";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolderOutlined";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { v4 as uuid } from "uuid";

import { RootState } from "../../app/store";
import { useDispatch, useSelector } from "react-redux";
import { Bookmark, addFolder, moveBookmark, moveBookmarkToFolder } from "./bookmarksSlice";

import { BookmarkListItem } from "./BookmarkListItem";
import { BookmarkFolderItem, folderIdFromDropId } from "./BookmarkFolderItem";
import { BookmarkFolderDialog } from "./BookmarkFolderDialog";
import { SortableItem } from "../../common/SortableItem";

/**
 * The Bookmarks section of the sidebar. UX-10: folders come first, each with
 * its bookmarks, then the bookmarks in no folder. Bookmarks can be dragged
 * to reorder them, onto another bookmark to join its folder, or onto a folder;
 * "Move to folder…" in a bookmark's options does the same from the keyboard.
 */
export function BookmarkListItems() {
  const dispatch = useDispatch();

  const bookmarks = useSelector((state: RootState) => state.bookmarks);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 10 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  const sensors = useSensors(pointerSensor, keyboardSensor);

  const [open, setOpen] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const all = bookmarks.bookmarks.allIds
    .map((id) => bookmarks.bookmarks.byId[id])
    .filter(Boolean);
  const folders = bookmarks.folders.allIds.map((id) => bookmarks.folders.byId[id]);
  const inFolder = (folderId: string) => all.filter((bookmark) => bookmark.folderId === folderId);
  // A bookmark whose folder has gone is shown in the main list rather than lost.
  const loose = all.filter(
    (bookmark) => !bookmark.folderId || !bookmarks.folders.byId[bookmark.folderId],
  );
  const shown = [
    ...folders.filter((folder) => folder.open).flatMap((folder) => inFolder(folder.id)),
    ...loose,
  ];

  const [dragId, setDragId] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    setDragId(event.active.id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDragId(null);
    if (!over) {
      return;
    }
    const folderId = folderIdFromDropId(over.id);
    if (folderId !== undefined) {
      dispatch(moveBookmarkToFolder({ bookmarkId: active.id, folderId }));
    } else if (active.id !== over.id) {
      dispatch(moveBookmark({ active: active.id, over: over.id }));
    }
  }

  const renderBookmark = (bookmark: Bookmark) => (
    <SortableItem key={bookmark.id} id={bookmark.id}>
      <BookmarkListItem bookmark={bookmark} />
    </SortableItem>
  );

  return (
    <>
      <ListItem
        disablePadding
        secondaryAction={
          <Tooltip title="New folder">
            <IconButton
              size="small"
              aria-label="New bookmark folder"
              onClick={() => setNewFolderOpen(true)}
            >
              <CreateNewFolderIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        }
      >
        <ListItemButton onClick={() => setOpen(!open)} aria-expanded={open}>
          <ListItemText primary="Bookmarks" />
          {open ? <ExpandLess /> : <ExpandMore />}
        </ListItemButton>
      </ListItem>
      <Collapse in={open} timeout="auto">
        <List component="div" disablePadding>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={shown} strategy={verticalListSortingStrategy}>
              {folders.map((folder) => (
                <BookmarkFolderItem key={folder.id} folder={folder}>
                  {inFolder(folder.id).map(renderBookmark)}
                </BookmarkFolderItem>
              ))}
              {loose.map(renderBookmark)}
              <DragOverlay>
                {dragId && bookmarks.bookmarks.byId[dragId] ? (
                  <BookmarkListItem bookmark={bookmarks.bookmarks.byId[dragId]} shadow />
                ) : null}
              </DragOverlay>
            </SortableContext>
          </DndContext>
        </List>
      </Collapse>
      <BookmarkFolderDialog
        open={newFolderOpen}
        heading="New folder"
        initialName="New folder"
        onSave={(title) => dispatch(addFolder({ id: uuid(), title }))}
        onClose={() => setNewFolderOpen(false)}
      />
    </>
  );
}
