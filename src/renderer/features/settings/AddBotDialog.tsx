import React from "react";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";

/** Where Discord bots are made. Opened in the system browser (https only, SEC-10). */
export const DISCORD_DEVELOPER_PORTAL = "https://discord.com/developers/applications";

type AddBotDialogProps = {
  open: boolean;
  /** How many bots there are now (the title says "second", "third", …). */
  botCount: number;
  onCancel: () => void;
  onAdd: () => void;
};

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

/** OUT-1: the guided "Add a second bot" step. */
export function AddBotDialog({ open, botCount, onCancel, onAdd }: AddBotDialogProps) {
  const ordinal = ORDINALS[botCount] ?? "another";
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby="add-bot-title">
      <DialogTitle id="add-bot-title">Add a {ordinal} bot</DialogTitle>
      <DialogContent>
        <DialogContentText gutterBottom>
          Discord lets one bot sit in only one voice channel per server. To play into a second room of the
          same server at the same time, you need a second bot. Each bot can also have its own volume
          switch.
        </DialogContentText>
        <DialogContentText component="ol" sx={{ pl: 2 }}>
          <li>
            Open the{" "}
            <Link href={DISCORD_DEVELOPER_PORTAL} target="_blank" rel="noopener noreferrer">
              Discord Developer Portal
            </Link>{" "}
            and create a new application.
          </li>
          <li>Under “Bot”, reset and copy the bot&apos;s token.</li>
          <li>Under “OAuth2”, invite the bot to your server with the Connect and Speak permissions.</li>
          <li>Come back here, paste the token in the new bot&apos;s Token field and press Connect.</li>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onAdd} variant="contained">
          Add bot
        </Button>
      </DialogActions>
    </Dialog>
  );
}
