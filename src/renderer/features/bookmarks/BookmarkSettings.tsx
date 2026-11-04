import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

import { useDispatch } from "react-redux";
import { Bookmark, editBookmark } from "./bookmarksSlice";

import { showWindowControls } from "../../common/showWindowControls";
import { sidePanelProps } from "../../common/viewOverlay";
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
 * Both are edited locally and saved together on "Done". SEC-6: they are
 * saved only when the address passes the shared tab URL policy; otherwise
 * the dialog stays open with a plain-language message. "Cancel", Escape or
 * closing the dialog another way keeps the saved bookmark unchanged. Links
 * dropped on the address field are inserted as text by the browser.
 * SEC-15: a file on this computer may be saved too; the main process asks
 * the user each time it is opened (unless its folder is remembered).
 */
export function BookmarkSettings({
  bookmark,
  open,
  onClose,
}: BookmarkSettingsProps) {
  const dispatch = useDispatch();
  const [url, setUrl] = useState(bookmark.url);
  const [title, setTitle] = useState(bookmark.title);
  const [urlError, setUrlError] = useState<string>();

  useEffect(() => {
    if (open) {
      setUrl(bookmark.url);
      setTitle(bookmark.title);
      setUrlError(undefined);
    }
  }, [open, bookmark.url, bookmark.title]);

  function handleURLChange(event: React.ChangeEvent<HTMLInputElement>) {
    setUrl(event.target.value);
    setUrlError(undefined);
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
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
    if (check.url !== bookmark.url || title !== bookmark.title) {
      dispatch(editBookmark({ id: bookmark.id, url: check.url, title }));
    }
    handleClose();
  }

  return (
    <Dialog
      fullScreen
      sx={{ width: 240 }}
      open={open}
      onClose={handleClose}
      // A side panel over the sidebar: the website or player view stays beside it.
      {...sidePanelProps}
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
            value={title}
            onChange={handleTitleChange}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button type="submit">Done</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
