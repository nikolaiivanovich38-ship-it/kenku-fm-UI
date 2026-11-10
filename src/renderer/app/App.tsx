import React, { useEffect, useState } from "react";

import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import styled from "@mui/material/styles/styled";

import { ActionDrawer } from "../common/ActionDrawer";

import { Tabs } from "../features/tabs/Tabs";
import { onAppError } from "../common/appErrors";
import { isErrorCause, type ErrorCause } from "../../common/errorCause";
import { errorShown, outputHasProblem } from "../features/errors/errorsSlice";
import { useStore } from "react-redux";
import { startWindowSettingsSync } from "../features/settings/windowSettingsSync";
import type { RootState } from "./store";

import icon from "../../assets/icon.svg";

import "./App.css";
import Typography from "@mui/material/Typography";

const WallPaper = styled("div")({
  position: "absolute",
  width: "100%",
  height: "100%",
  top: 0,
  left: 0,
  overflow: "hidden",
  background: "linear-gradient(#2D3143 0%, #1e2231 100%)",
  zIndex: -1,
});

export function App() {
  const [message, setMessage] = useState<string>();
  const [fatalError, setFatalError] = useState<string>();
  const store = useStore<RootState>();

  useEffect(() => {
    window.kenku.on("MESSAGE", (args) => {
      const message = args[0];
      setMessage(message);
    });
    // UX finding 4: shown in the sidebar (or Settings) by ErrorMessages.
    const showError = (message: string, cause?: ErrorCause) => {
      const bot = cause?.kind === "output" ? store.getState().output.bots.find((b) => b.id === cause.id) : undefined;
      store.dispatch(errorShown({ message, cause, causeSeen: Boolean(bot && outputHasProblem(bot)) }));
    };
    window.kenku.on("ERROR", (args) => {
      const [error, cause] = args;
      if (typeof error === "string") {
        showError(error, isErrorCause(cause) ? cause : undefined);
      }
    });
    window.kenku.on("FATAL_ERROR", (args) => {
      const error = args[0];
      setFatalError(error);
    });

    const stopAppErrors = onAppError(showError);
    // OUT-8 (w6-rooms): Settings in Lyre shows and changes Sound to Discord and Website tabs, kept here.
    const stopWindowSettings = window.kenku.windowSettings ? startWindowSettingsSync(store, window.kenku.windowSettings) : (): void => undefined;

    return () => {
      stopAppErrors();
      stopWindowSettings();
      window.kenku.removeAllListeners("MESSAGE");
      window.kenku.removeAllListeners("ERROR");
      window.kenku.removeAllListeners("FATAL_ERROR");
    };
  }, [store]);

  if (fatalError) {
    return (
      <Stack direction="row">
        <WallPaper />
        <Stack
          position="absolute"
          left="0"
          right="0"
          width="100%"
          height="100%"
          alignItems="center"
          justifyContent="center"
          gap={1}
        >
          <Stack sx={{ width: "68px", height: "68px", m: 1 }}>
            <img src={icon} alt="Lyre" />
          </Stack>
          <Typography variant="h4" color="white">
            Oops, something went wrong..
          </Typography>
          <Typography variant="body1" color="white">
            {fatalError}
          </Typography>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack direction="row">
      <WallPaper />
      <ActionDrawer />
      <Tabs />
      <Snackbar
        open={Boolean(message)}
        autoHideDuration={4000}
        onClose={() => setMessage(undefined)}
        message={message}
        sx={{ maxWidth: "192px" }}
      />
    </Stack>
  );
}
