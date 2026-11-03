import React from "react";
import Snackbar, { SnackbarCloseReason } from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";

type ErrorToastProps = {
  /** Message to show; nothing is shown while undefined. */
  error?: string;
  onClose: () => void;
};

/**
 * Error message for the main window.
 *
 * Errors stay on screen until the user closes them (WCAG 2.2.1 Timing
 * Adjustable): they often tell the user what to do next, so they must not
 * vanish on a timer. A click elsewhere does not dismiss them either.
 */
export function ErrorToast({ error, onClose }: ErrorToastProps) {
  function handleClose(_: unknown, reason?: SnackbarCloseReason) {
    if (reason === "clickaway") return;
    onClose();
  }

  return (
    <Snackbar
      open={Boolean(error)}
      autoHideDuration={null}
      onClose={handleClose}
      sx={{ maxWidth: "360px" }}
    >
      <Alert severity="error" role="alert" onClose={onClose}>
        {error}
      </Alert>
    </Snackbar>
  );
}
