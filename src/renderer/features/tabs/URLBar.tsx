import React, { useEffect, useId, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";

import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";

import {
  checkTabUrl,
  checkTypedTabUrl,
  isLocalFile,
  isRefused,
  type LocalFileCheck,
} from "../../../common/security/urlPolicy";

/** An address the user may open: a web page, or a file the main process will ask about. */
export type OpenableAddress = { ok: true; url: string; insecure: boolean } | LocalFileCheck;
import { getBounds } from "./getBounds";

type URLBarProps = {
  viewId: number;
  url: string;
  onURLChange: (url: string) => void;
  disabled?: boolean;
  /** SEC-15: the current tab shows a file from the computer, not a website. */
  localFile?: boolean;
  /**
   * SEC-15: open the address in a new view in place of this tab: files and
   * websites never share a tab.
   */
  onOpenInNewTab?: (address: OpenableAddress) => void;
};

/**
 * Address bar for website tabs.
 * SEC-6: the typed address is checked with the shared tab URL policy (after
 * adding https:// when no scheme was typed); refused addresses are not sent
 * to the main process and a plain-language message is shown instead. Plain
 * http pages get a "Not secure" hint. Links dropped on the field are inserted
 * as text by the browser.
 * SEC-15: a file address (or a pasted file path) is handed to
 * `onOpenInNewTab`; the main process asks the user before it opens.
 */
export function URLBar({
  viewId,
  url,
  onURLChange,
  disabled,
  localFile,
  onOpenInNewTab,
}: URLBarProps) {
  const [error, setError] = useState<string>();
  const errorId = useId();
  const insecureId = useId();
  const insecure = isInsecurePage(url);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkTypedTabUrl(url);
    if (isRefused(check)) {
      setError(check.reason);
      return;
    }
    setError(undefined);
    if (isLocalFile(check) || localFile) {
      onOpenInNewTab?.(check);
      return;
    }
    window.kenku.loadURL(viewId, check.url);
  }

  function handleURLChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    onURLChange(e.target.value);
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
            startAdornment={
              insecure ? (
                <Typography
                  id={insecureId}
                  variant="caption"
                  color="warning.light"
                  sx={{ mr: 1, whiteSpace: "nowrap", fontWeight: 500 }}
                >
                  Not secure
                </Typography>
              ) : undefined
            }
            inputProps={{
              "aria-label": "Web address",
              "aria-invalid": hasError,
              "aria-describedby":
                [hasError && errorId, insecure && insecureId]
                  .filter(Boolean)
                  .join(" ") || undefined,
            }}
            value={url}
            fullWidth
            onChange={handleURLChange}
            disabled={disabled}
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

/**
 * True for a plain http page, which the URL policy allows but flags as
 * `insecure`: anything sent to it, including passwords, can be read on the way.
 */
function isInsecurePage(url: string): boolean {
  const check = checkTabUrl(url);
  return !isRefused(check) && check.insecure;
}
