import React, { useState } from "react";

import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { botLabel, type BotState } from "../../../common/outputs";
import { botStatusText } from "../output/BotStatusLine";
// Connect below logs in afresh, so Settings needs no separate Reconnect button.
import { BotStatusChip } from "../output/OutputStatusChip";

type BotSettingsProps = {
  bot: BotState;
  /** Offer "Remove bot" (not for the only bot). */
  removable: boolean;
  autoFocus?: boolean;
};

/**
 * SEC-5 / OUT-1: one Discord bot's token and connection. The token is sent to
 * the main process, which keeps it encrypted; this form never shows a saved
 * token, it only says whether there is one.
 */
export function BotSettings({ bot, removable, autoFocus }: BotSettingsProps) {
  const [draft, setDraft] = useState("");
  const label = botLabel(bot);
  const busy = bot.status === "connecting";
  const connected = bot.status === "ready";

  /** UX finding 5: Connect is the form's submit button, so Enter in the Token field presses it. */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (!connected && draft.trim() === "" && !bot.hasToken)) {
      return;
    }
    await handleConnect();
  }

  async function handleConnect() {
    if (connected) {
      window.kenku.outputs.disconnect(bot.id);
      return;
    }
    if (draft.trim() !== "") {
      await window.kenku.outputs.setToken(bot.id, draft);
      setDraft("");
    }
    window.kenku.outputs.connect(bot.id);
  }

  function handleRemoveToken() {
    setDraft("");
    window.kenku.outputs.removeToken(bot.id);
  }

  // UX finding 5: what a token is, in one line, where the user types it.
  const tokenHelp = !bot.hasToken
    ? "Your bot's password, from the Bot page in the Discord Developer Portal."
    : bot.tokenRemembered
      ? "A token is saved, encrypted on this computer. Type a new one to replace it."
      : "A token is set for this session only. Type a new one to replace it.";

  return (
    <Stack
      spacing={1}
      role="group"
      aria-label={`Discord bot ${label}`}
      component="form"
      onSubmit={handleSubmit}
      noValidate
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="body2" component="h3" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <BotStatusChip bot={bot} />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {botStatusText(bot)}
      </Typography>

      <TextField
        autoFocus={autoFocus}
        margin="dense"
        size="small"
        id={`token-${bot.id}`}
        label="Token"
        type="password"
        fullWidth
        variant="standard"
        autoComplete="off"
        InputLabelProps={{ shrink: true }}
        placeholder={bot.hasToken ? "Saved" : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={busy || connected}
        helperText={tokenHelp}
      />
      <Button
        type="submit"
        disabled={busy || (!connected && draft.trim() === "" && !bot.hasToken)}
        fullWidth
        variant="outlined"
        size="small"
      >
        {busy ? <CircularProgress size={24} aria-label="Connecting" /> : connected ? "Disconnect" : "Connect"}
      </Button>
      {bot.hasToken && !busy && (
        <Button type="button" onClick={handleRemoveToken} fullWidth size="small" color="inherit">
          Remove token
        </Button>
      )}
      {removable && (
        <Button type="button" onClick={() => window.kenku.outputs.removeBot(bot.id)} fullWidth size="small" color="inherit">
          Remove {bot.name}
        </Button>
      )}
    </Stack>
  );
}
