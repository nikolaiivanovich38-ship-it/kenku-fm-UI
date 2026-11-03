import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

import { useDispatch } from "react-redux";
import { Bookmark, editBookmark } from "./bookmarksSlice";

import { getDropURL } from "../../common/drop";
import { showWindowControls } from "../../common/showWindowControls";
import {
  checkTypedTabUrl,
  isRefused,
} from "../../../common/security/urlPolicy";

type BookmarkSettingsProps = {
  bookmark: Bookmark;
  open: boolean;
  onClose: () => void;
};

/**
 * Edit a bookmark's address and name.
 * SEC-6: the address is edited locally and saved on "Done" only when it
 * passes the shared tab URL policy; otherwise the dialog stays open with a
 * plain-language message. Closing the dialog another way keeps the last
 * saved address.
 */
export function BookmarkSettings({
  bookmark,
  open,
  onClose,
}: BookmarkSettingsProps) {
  const dispatch = useDispatch();
  const [url, setUrl] = useState(bookmark.url);
  const [urlError, setUrlError] = useState<string>();

  useEffect(() => {
    if (open) {
      setUrl(bookmark.url);
      setUrlError(undefined);
    }
  }, [open, bookmark.url]);

  function handleURLChange(event: React.ChangeEvent<HTMLInputElement>) {
    setUrl(event.target.value);
    setUrlError(undefined);
  }

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const droppedUrl = getDropURL(event.dataTransfer);
    if (droppedUrl) {
      setUrl(droppedUrl);
      setUrlError(undefined);
    }
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch(editBookmark({ id: bookmark.id, title: event.target.value }));
  }

  function handleClose() {
    onClose();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const check = checkTypedTabUrl(url);
    if (isRefused(check)) {
      setUrlError(check.reason);
      return;
    }
    if (check.url !== bookmark.url) {
      dispatch(editBookmark({ id: bookmark.id, url: check.url }));
    }
    handleClose();
  }

  return (
    <Dialog
      fullScreen
      sx={{ width: 240 }}
      open={open}
      onClose={handleClose}
      // Stop key events from propagating to prevent the track drag and drop from stealing the space bar
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogTitle
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        Edit Bookmark
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="url"
            label="URL"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{
              shrink: true,
            }}
            value={url}
            onChange={handleURLChange}
            onDrop={handleURLDrop}
            error={Boolean(urlError)}
            helperText={urlError}
            FormHelperTextProps={{ role: "alert" }}
          />
          <TextField
            margin="dense"
            id="name"
            label="Name"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{
              shrink: true,
            }}
            value={bookmark.title}
            onChange={handleTitleChange}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button type="submit">Done</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
