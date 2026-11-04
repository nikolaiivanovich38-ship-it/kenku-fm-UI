import React, { useState } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import FolderIcon from "@mui/icons-material/FolderRounded";
import { useSelector } from "react-redux";

import type { RootState } from "../../app/store";
import { Bookmark, BookmarkFolder } from "./bookmarksSlice";
import { useOpenBookmark } from "./useOpenBookmark";

/** A bookmark's site icon, or its first letter when the site has none. */
function BookmarkIcon({ bookmark, size = 24 }: { bookmark: Bookmark; size?: number }) {
  if (bookmark.icon) {
    return (
      <Box sx={{ width: size, height: size, display: "flex" }}>
        <img
          src={bookmark.icon}
          alt=""
          draggable={false}
          width={size}
          height={size}
          style={{ objectFit: "cover" }}
        />
      </Box>
    );
  }
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.55, bgcolor: "primary.dark" }} aria-hidden>
      {bookmark.title.trim().charAt(0).toUpperCase() || "?"}
    </Avatar>
  );
}

function FolderButton({
  folder,
  bookmarks,
  onOpen,
}: {
  folder: BookmarkFolder;
  bookmarks: Bookmark[];
  onOpen: (bookmark: Bookmark) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={folder.title} placement="right">
        <IconButton
          aria-label={`${folder.title} folder`}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <FolderIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        MenuListProps={{ "aria-label": folder.title }}
      >
        {bookmarks.length === 0 && <MenuItem disabled>No bookmarks yet</MenuItem>}
        {bookmarks.map((bookmark) => (
          <MenuItem
            key={bookmark.id}
            onClick={() => {
              setAnchor(null);
              onOpen(bookmark);
            }}
          >
            <ListItemIcon>
              <BookmarkIcon bookmark={bookmark} size={20} />
            </ListItemIcon>
            {bookmark.title}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * UX-10: the bookmarks in the collapsed sidebar, one icon each (the site's
 * icon or the first letter of its name); a folder is one icon that lists its
 * bookmarks. Every icon has the bookmark's name as its label and tooltip.
 * Editing and moving bookmarks happens in the expanded sidebar.
 */
export function BookmarkRail() {
  const bookmarks = useSelector((state: RootState) => state.bookmarks);
  const openBookmark = useOpenBookmark();

  const all = bookmarks.bookmarks.allIds.map((id) => bookmarks.bookmarks.byId[id]).filter(Boolean);
  const folders = bookmarks.folders.allIds.map((id) => bookmarks.folders.byId[id]);
  const loose = all.filter((bookmark) => !bookmark.folderId || !bookmarks.folders.byId[bookmark.folderId]);

  return (
    <List aria-label="Bookmarks" disablePadding sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {folders.map((folder) => (
        <ListItem key={folder.id} disablePadding sx={{ justifyContent: "center" }}>
          <FolderButton
            folder={folder}
            bookmarks={all.filter((bookmark) => bookmark.folderId === folder.id)}
            onOpen={openBookmark}
          />
        </ListItem>
      ))}
      {loose.map((bookmark) => (
        <ListItem key={bookmark.id} disablePadding sx={{ justifyContent: "center" }}>
          <Tooltip title={bookmark.title} placement="right">
            <IconButton aria-label={bookmark.title} onClick={() => openBookmark(bookmark)}>
              <BookmarkIcon bookmark={bookmark} />
            </IconButton>
          </Tooltip>
        </ListItem>
      ))}
    </List>
  );
}
