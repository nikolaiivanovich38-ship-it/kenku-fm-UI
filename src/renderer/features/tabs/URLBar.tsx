import React, { useEffect, useId, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";

import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";

import { getDropURL } from "../../common/drop";
import {
  checkTypedTabUrl,
  isRefused,
} from "../../../common/security/urlPolicy";
import { getBounds } from "./getBounds";

type URLBarProps = {
  viewId: number;
  url: string;
  onURLChange: (url: string) => void;
  disabled?: boolean;
};

/**
 * Address bar for website tabs.
 * SEC-6: the typed address is checked with the shared tab URL policy (after
 * adding https:// when no scheme was typed); refused addresses are not sent
 * to the main process and a plain-language message is shown instead.
 */
export function URLBar({ viewId, url, onURLChange, disabled }: URLBarProps) {
  const [error, setError] = useState<string>();
  const errorId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkTypedTabUrl(url);
    if (isRefused(check)) {
      setError(check.reason);
      return;
    }
    setError(undefined);
    window.kenku.loadURL(viewId, check.url);
  }

  function handleURLChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    onURLChange(e.target.value);
  }

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const url = getDropURL(event.dataTransfer);
    if (url) {
      onURLChange(url);
    }
  }

  function handleBack() {
    window.kenku.goBack(viewId);
  }

  function handleForward() {
    window.kenku.goForward(viewId);
  }

  function handleReload() {
    window.kenku.reload(viewId);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus URL bar when changing tabs to an empty URL
    if (url === "") {
      inputRef.current?.focus();
    }
  }, [viewId, url]);

  useEffect(() => {
    // A message from another tab does not apply to this one
    setError(undefined);
  }, [viewId]);

  const hasError = Boolean(error);
  const firstRender = useRef(true);
  useEffect(() => {
    // Website views are drawn above the page, so move the view down (or back
    // up) when the error line appears or goes, otherwise it hides the message.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (viewId >= 0) {
      const bounds = getBounds();
      window.kenku.setBrowserViewBounds(
        viewId,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
      );
    }
  }, [hasError, viewId]);

  return (
    <Stack
      direction="column"
      sx={{
        flexGrow: 1,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ py: 0.5, pb: 1, px: 2, alignItems: "center" }}
      >
        <IconButton
          onClick={handleBack}
          disabled={disabled}
          size="small"
          aria-label="Back"
        >
          <ArrowBackRounded />
        </IconButton>
        <IconButton
          onClick={handleForward}
          disabled={disabled}
          size="small"
          aria-label="Forward"
        >
          <ArrowForwardRounded />
        </IconButton>
        <form onSubmit={handleSubmit} style={{ flexGrow: 1 }}>
          <InputBase
            inputRef={inputRef}
            sx={{
              bgcolor: "rgba(0, 0, 0, 0.15)",
              px: 2,
              borderRadius: "16px",
              outline: hasError ? "1px solid" : "none",
              outlineColor: "error.main",
            }}
            placeholder={disabled ? "" : "Enter a URL"}
            error={hasError}
            inputProps={{
              "aria-label": "Web address",
              "aria-invalid": hasError,
              "aria-describedby": hasError ? errorId : undefined,
            }}
            value={url}
            fullWidth
            onChange={handleURLChange}
            disabled={disabled}
            onDrop={handleURLDrop}
          />
        </form>
        <IconButton
          onClick={handleReload}
          disabled={disabled}
          size="small"
          aria-label="Reload"
        >
          <RefreshRounded />
        </IconButton>
      </Stack>
      {hasError && (
        <Typography
          id={errorId}
          role="alert"
          variant="caption"
          color="error"
          sx={{ px: 4, pb: 1, mt: -0.5 }}
        >
          {error}
        </Typography>
      )}
    </Stack>
  );
}
