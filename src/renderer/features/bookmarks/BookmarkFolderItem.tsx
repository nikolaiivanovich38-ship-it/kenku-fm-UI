import React, { useState } from "react";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ExpandLess from "@mui/icons-material/ExpandLessRounded";
import ExpandMore from "@mui/icons-material/ExpandMoreRounded";
import FolderIcon from "@mui/icons-material/FolderRounded";
import FolderOpenIcon from "@mui/icons-material/FolderOpenRounded";
import MoreIcon from "@mui/icons-material/MoreHorizRounded";
import { useDroppable } from "@dnd-kit/core";
import Box from "@mui/material/Box";
import { useDispatch } from "react-redux";
import { focusNextRowLater } from "../../common/focusNextRow";

import { BookmarkFolder, removeFolder, renameFolder, toggleFolder } from "./bookmarksSlice";
import { BookmarkFolderDialog } from "./BookmarkFolderDialog";

/** Drag-and-drop id of a folder, kept apart from bookmark ids. */
export function folderDropId(folderId: string): string {
  return `folder:${folderId}`;
}

/** The folder id behind a drag-and-drop id, or undefined for a bookmark. */
export function folderIdFromDropId(dropId: string): string | undefined {
  return dropId.startsWith("folder:") ? dropId.slice("folder:".length) : undefined;
}

type BookmarkFolderItemProps = {
  folder: BookmarkFolder;
  /** The folder's bookmarks. */
  children: React.ReactNode;
};

/**
 * UX-10: a bookmark folder in the sidebar. Click (or Enter/Space) opens and
 * closes it; the options button renames or deletes it (its bookmarks are kept
 * and go back to the main list). Bookmarks can be dropped on it.
 */
export function BookmarkFolderItem({ folder, children }: BookmarkFolderItemProps) {
  const dispatch = useDispatch();
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId(folder.id) });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);

  return (
    <Box data-focus-item>
      <ListItem
        ref={setNodeRef}
        disablePadding
        secondaryAction={
          <IconButton
            size="small"
            aria-label={`Options for folder ${folder.title}`}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreIcon />
          </IconButton>
        }
      >
        <ListItemButton
          dense
          aria-expanded={folder.open}
          aria-label={`${folder.title} folder`}
          data-focus-row={`folder:${folder.id}`}
          onClick={() => dispatch(toggleFolder(folder.id))}
          sx={{
            px: 2,
            outline: isOver ? "1px dashed" : "none",
            outlineColor: "primary.main",
          }}
        >
          {folder.open ? (
            <FolderOpenIcon fontSize="small" sx={{ mr: 1 }} />
          ) : (
            <FolderIcon fontSize="small" sx={{ mr: 1 }} />
          )}
          <ListItemText primary={folder.title} primaryTypographyProps={{ noWrap: true }} />
          {folder.open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </ListItemButton>
      </ListItem>
      <Collapse in={folder.open} timeout="auto" unmountOnExit>
        <List component="div" role="group" aria-label={folder.title} disablePadding sx={{ pl: 1.5 }}>
          {children}
        </List>
      </Collapse>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setRenaming(true);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            // UX finding 12: focus goes to what came after the folder.
            focusNextRowLater(menuAnchor);
            setMenuAnchor(null);
            dispatch(removeFolder(folder.id));
          }}
        >
          Delete folder (keeps its bookmarks)
        </MenuItem>
      </Menu>
      <BookmarkFolderDialog
        open={renaming}
        heading="Rename folder"
        initialName={folder.title}
        onSave={(title) => dispatch(renameFolder({ id: folder.id, title }))}
        onClose={() => setRenaming(false)}
      />
    </Box>
  );
}
