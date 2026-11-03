import React, { useCallback } from "react";

import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Link } from "@mui/material";

import {
  getDropURL,
  encodeFilePath,
  cleanFileName,
} from "../../renderer/common/drop";
import useFileDrop, { FileInfo } from "./useFileDrop";
import {
  AUDIO_FORMATS_LABEL,
  audioFileType,
  hasAudioExtension,
} from "./fileTypes";
import { useNotify } from "./notifications";

type AudioSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  onFileName: (name: string) => void;
};

export function AudioSelector({
  value,
  onChange,
  onFileName,
}: AudioSelectorProps) {
  function handleURLChange(event: React.ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const url = getDropURL(event.dataTransfer);
    if (url) {
      onChange(url);
    }
  }

  const notify = useNotify();
  const onDrop = useCallback(
    (acceptedFiles: FileInfo[], rejectedNames: string[]) => {
      const file = acceptedFiles[0];
      if (file) {
        onChange(encodeFilePath(file.path));
        onFileName(cleanFileName(file.name));
      } else if (rejectedNames.length > 0) {
        notify({
          severity: "info",
          message: `"${rejectedNames[0]}" isn't an audio file Kenku FM can play. Choose an ${AUDIO_FORMATS_LABEL} file.`,
        });
      }
    },
    [onChange, onFileName, notify]
  );

  const { rootProps, inputProps, isDragging } = useFileDrop({
    onDrop,
    fileType: audioFileType,
    multiple: false,
  });

  const warning = value && !hasAudioExtension(value);

  return (
    <>
      <TextField
        autoFocus
        margin="dense"
        id="url"
        label="Source"
        placeholder="Enter a URL or select a track below"
        fullWidth
        variant="standard"
        autoComplete="off"
        InputLabelProps={{
          shrink: true,
        }}
        value={value}
        onChange={handleURLChange}
        onDrop={handleURLDrop}
        color={warning ? "warning" : undefined}
        helperText={
          warning ? (
            <>
              Unable to verify audio format, this file may not be supported. See{" "}
              <Link
                href="https://www.kenku.fm/docs/using-kenku-player"
                target="_blank"
                rel="noopener noreferrer"
              >
                here
              </Link>{" "}
              for more information.
            </>
          ) : undefined
        }
      />
      <Button
        sx={{
          p: 2,
          borderStyle: "dashed",
          my: 1,
        }}
        variant="outlined"
        fullWidth
        {...rootProps}
      >
        <input {...inputProps} />
        {isDragging ? (
          <Typography variant="caption">Drop the track here...</Typography>
        ) : (
          <Typography variant="caption">
            Drag and drop or click to select a track
          </Typography>
        )}
      </Button>
    </>
  );
}
