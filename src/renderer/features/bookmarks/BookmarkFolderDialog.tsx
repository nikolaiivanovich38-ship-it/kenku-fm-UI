import React, { useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";

import { showWindowControls } from "../../common/showWindowControls";
import { sidePanelProps } from "../../common/viewOverlay";

type BookmarkFolderDialogProps = {
  open: boolean;
  /** "New folder" or "Rename folder". */
  heading: string;
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
};

/** UX-10: name a new bookmark folder or rename one. The name is saved on Done or Enter. */
export function BookmarkFolderDialog({
  open,
  heading,
  initialName,
  onSave,
  onClose,
}: BookmarkFolderDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(undefined);
    }
  }, [open, initialName]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give the folder a name.");
      return;
    }
    onSave(trimmed);
    onClose();
  }

  return (
    <Dialog
      fullScreen
      sx={{ width: 240 }}
      open={open}
      onClose={onClose}
      // A side panel over the sidebar: the website or player view stays beside it.
      {...sidePanelProps}
      // Keep the space bar and pointer away from the bookmark drag and drop.
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogTitle
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        {heading}
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="folder-name"
            label="Folder name"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{ shrink: true }}
            inputProps={{ maxLength: 200 }}
            value={name}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            error={Boolean(error)}
            helperText={error}
            FormHelperTextProps={{ role: "alert" }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit">Done</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
