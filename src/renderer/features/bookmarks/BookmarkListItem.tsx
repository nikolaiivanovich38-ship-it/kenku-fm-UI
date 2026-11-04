import React, { useState } from "react";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MoreIcon from "@mui/icons-material/MoreHorizRounded";
import ListItem from "@mui/material/ListItem";

import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { Bookmark, moveBookmarkToFolder, removeBookmark } from "./bookmarksSlice";
import { BookmarkSettings } from "./BookmarkSettings";
import { useOpenBookmark } from "./useOpenBookmark";
import { BookmarkIcon } from "./BookmarkRail";
import { DragHandle } from "../../common/SortableItem";
import { focusNextRowLater } from "../../common/focusNextRow";

type BookmarkListItemProps = {
  bookmark: Bookmark;
  shadow?: boolean;
};

export function BookmarkListItem({ bookmark, shadow }: BookmarkListItemProps) {
  const dispatch = useDispatch();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const openBookmark = useOpenBookmark();
  const folderIds = useSelector((state: RootState) => state.bookmarks.folders.allIds);
  const foldersById = useSelector((state: RootState) => state.bookmarks.folders.byId);

  /** Open the bookmark in a new tab. */
  function select() {
    return openBookmark(bookmark);
  }

  function handleRemove() {
    focusNextRowLater(more);
    setMore(null);
    dispatch(removeBookmark(bookmark.id));
  }

  function openSettings() {
    setMore(null);
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  const [more, setMore] = React.useState<HTMLButtonElement | null>(null);

  function handleMoreClick(event: React.MouseEvent<HTMLButtonElement>) {
    setMore(event.currentTarget);
  }

  function handleMoreClose() {
    setMore(null);
  }

  const moreOpen = Boolean(more);
  const moreId = moreOpen ? "more-popover" : undefined;

  /**
   * UX-10: "Move to folder…" opens a second menu, anchored where the options
   * menu was, listing the folders: the keyboard alternative to dragging.
   */
  const [moveAnchor, setMoveAnchor] = useState<HTMLButtonElement | null>(null);
  const moveTargets: { id: string | null; title: string }[] = [
    ...(bookmark.folderId ? [{ id: null, title: "No folder (main list)" }] : []),
    ...folderIds
      .map((id) => foldersById[id])
      .filter((folder) => folder && folder.id !== bookmark.folderId),
  ];

  function openMoveMenu() {
    setMoveAnchor(more);
    setMore(null);
  }

  function moveTo(folderId: string | null) {
    // UX finding 12: the row moves away, so focus goes to the one after it.
    focusNextRowLater(moveAnchor);
    setMoveAnchor(null);
    dispatch(moveBookmarkToFolder({ bookmarkId: bookmark.id, folderId }));
  }

  return (
    <>
      <ListItem
        disablePadding
        data-focus-item
        sx={{ position: "relative" }}
        secondaryAction={
          <IconButton
            size="small"
            aria-label={`Options for ${bookmark.title}`}
            onClick={handleMoreClick}
          >
            <MoreIcon />
          </IconButton>
        }
      >
        {/* UX finding 2: the keyboard moves a bookmark from its icon (Space, arrows, Space);
            the row's own button and its options button work with Enter and Space. */}
        <DragHandle
          label={`Move ${bookmark.title}`}
          sx={{
            position: "absolute",
            left: 20,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 1,
            display: "flex",
          }}
        >
          <BookmarkIcon bookmark={bookmark} size={24} />
        </DragHandle>
        <ListItemButton
          dense
          sx={{ pl: "52px", pr: 2, boxShadow: shadow ? 10 : "none" }}
          onClick={select}
          onDoubleClick={openSettings}
          data-focus-row={bookmark.id}
        >
          <ListItemText
            primary={bookmark.title}
            primaryTypographyProps={{ noWrap: true }}
          />
        </ListItemButton>
      </ListItem>
      <Menu
        id={moreId}
        anchorEl={more}
        open={moreOpen}
        onClose={handleMoreClose}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        <MenuItem onClick={openSettings}>Edit</MenuItem>
        {moveTargets.length > 0 && (
          <MenuItem onClick={openMoveMenu}>Move to folder…</MenuItem>
        )}
        <MenuItem onClick={handleRemove}>Delete</MenuItem>
      </Menu>
      <Menu
        anchorEl={moveAnchor}
        open={Boolean(moveAnchor)}
        onClose={() => setMoveAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        MenuListProps={{ "aria-label": `Move ${bookmark.title} to` }}
      >
        {moveTargets.map((target) => (
          <MenuItem key={target.id ?? "main"} onClick={() => moveTo(target.id)}>
            {target.title}
          </MenuItem>
        ))}
      </Menu>
      <BookmarkSettings
        bookmark={bookmark}
        open={settingsOpen}
        onClose={closeSettings}
      />
    </>
  );
}
