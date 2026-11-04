import React from "react";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";
import { useDispatch, useSelector } from "react-redux";

import type { RootState } from "../../app/store";
import { errorClosed } from "./errorsSlice";

/**
 * UX finding 1/4: the main window's error messages, newest first.
 *
 * Shown in the page's own layout (the sidebar, or the Settings panel while it
 * is open), never floating above it: website and player views are drawn over
 * the window's centre and would cover a floating message, and a floating
 * message would cover buttons. Each message stays until its cause is fixed
 * (errorsSlice) or the user closes it, never on a timer (WCAG 2.2.1).
 */
export function ErrorMessages({ sx }: { sx?: SxProps<Theme> }) {
  const errors = useSelector((state: RootState) => state.errors.list);
  const dispatch = useDispatch();
  if (errors.length === 0) {
    return null;
  }
  return (
    <Stack spacing={1} sx={sx} id="error-messages">
      {errors.map((error) => (
        <Alert
          key={error.id}
          severity="error"
          role="alert"
          variant="filled"
          onClose={() => dispatch(errorClosed(error.id))}
          sx={{
            bgcolor: "#5c1f2a",
            color: "#ffe3e6",
            "& .MuiAlert-icon": { color: "#ff8a95" },
            "& .MuiAlert-message": { overflowWrap: "anywhere" },
            typography: "body2",
          }}
        >
          {error.message}
        </Alert>
      ))}
    </Stack>
  );
}
