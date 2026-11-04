import React, { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import DialogContentText from "@mui/material/DialogContentText";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";

/**
 * A folder path that wraps after its separators (UX finding 8), so folder
 * names stay whole where they fit; a name too long for a line still wraps.
 */
function PathText({ path }: { path: string }) {
  const parts = path.split(/(?<=[\\/])/);
  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {part}
          {index < parts.length - 1 && <wbr />}
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * SEC-15: Settings > Local files. Lyre asks before opening a file from the
 * computer in a tab; when the user ticks "Don't ask again for files in this
 * folder", the folder is remembered by the main process and listed here, where
 * it can be removed. The list lives in the main process, not in this page.
 */
export function LocalFilesSettings() {
  const [folders, setFolders] = useState<string[]>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** UX finding 12: after "Ask again", focus goes to the folder that took its place, or the heading. */
  const focusIndex = useRef<number>();

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

  useEffect(() => {
    const index = focusIndex.current;
    if (index === undefined) {
      return;
    }
    focusIndex.current = undefined;
    const buttons: HTMLButtonElement[] = Array.from(listRef.current?.querySelectorAll("button") ?? []);
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? headingRef.current)?.focus();
  }, [folders]);

  async function forget(folder: string, index: number) {
    const remaining = await window.kenku.localFileFolders.forget(folder);
    focusIndex.current = index;
    setFolders(remaining);
  }

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <DialogContentText component="h3" id="local-files-heading" tabIndex={-1} ref={headingRef}>
        Local files
      </DialogContentText>
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
          <List dense disablePadding aria-label="Folders opened without asking" ref={listRef}>
            {folders.map((folder, index) => (
              <ListItem key={folder} disableGutters sx={{ alignItems: "center", gap: 1 }}>
                <ListItemText
                  primary={<PathText path={folder} />}
                  primaryTypographyProps={{ variant: "caption", sx: { overflowWrap: "anywhere" } }}
                />
                {/* UX finding 11: words, not an ×, which reads as "delete this folder". */}
                <Button
                  size="small"
                  variant="text"
                  sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                  aria-label={`Ask again before opening files in ${folder}`}
                  onClick={() => forget(folder, index)}
                >
                  Ask again
                </Button>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </>
  );
}
