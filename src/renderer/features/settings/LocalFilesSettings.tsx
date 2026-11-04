import React, { useEffect, useState } from "react";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/CloseRounded";

/**
 * SEC-15: Settings > Local files. Lyre asks before opening a file from the
 * computer in a tab; when the user ticks "Don't ask again for files in this
 * folder", the folder is remembered by the main process and listed here, where
 * it can be removed. The list lives in the main process, not in this page.
 */
export function LocalFilesSettings() {
  const [folders, setFolders] = useState<string[]>();

  useEffect(() => {
    let current = true;
    window.kenku.localFileFolders
      .list()
      .then((list) => current && setFolders(list))
      .catch((error) => console.warn("Could not read the local file folders", error));
    return () => {
      current = false;
    };
  }, []);

  async function forget(folder: string) {
    setFolders(await window.kenku.localFileFolders.forget(folder));
  }

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <DialogContentText>Local files</DialogContentText>
      {folders !== undefined && folders.length === 0 && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          Lyre asks before opening a file from your computer. Folders you
          choose not to be asked about again appear here.
        </Typography>
      )}
      {folders !== undefined && folders.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Files in these folders open without asking:
          </Typography>
          <List dense disablePadding aria-label="Folders opened without asking">
            {folders.map((folder) => (
              <ListItem
                key={folder}
                disableGutters
                secondaryAction={
                  <Tooltip title="Ask again">
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label={`Ask again before opening files in ${folder}`}
                      onClick={() => forget(folder)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemText
                  primary={folder}
                  primaryTypographyProps={{ variant: "caption", sx: { wordBreak: "break-all" } }}
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </>
  );
}
