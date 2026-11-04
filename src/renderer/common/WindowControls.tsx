import React from "react";

import MinimizeIcon from "@mui/icons-material/HorizontalRuleRounded";
import MaximizeIcon from "@mui/icons-material/CropSquareRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";

import IconButton from "@mui/material/IconButton";

/** Controls for the main app window */
export function WindowControls() {
  return (
    <>
      <IconButton
        size="small"
        sx={{ WebkitAppRegion: "no-drag" }}
        onClick={() => window.kenku.minimize()}
        aria-label="Minimize window"
      >
        <MinimizeIcon />
      </IconButton>
      <IconButton
        size="small"
        sx={{ WebkitAppRegion: "no-drag" }}
        onClick={() => window.kenku.toggleMaximize()}
        aria-label="Maximize window"
      >
        <MaximizeIcon />
      </IconButton>
      <IconButton
        size="small"
        sx={{ WebkitAppRegion: "no-drag" }}
        onClick={() => window.kenku.close()}
        aria-label="Close window"
      >
        <CloseIcon />
      </IconButton>
    </>
  );
}
