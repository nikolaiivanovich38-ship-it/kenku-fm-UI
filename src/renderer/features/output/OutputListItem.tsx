import React from "react";

import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItem from "@mui/material/ListItem";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

import VolumeIcon from "@mui/icons-material/VolumeUpRounded";
import TickIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorIcon from "@mui/icons-material/ErrorOutlineRounded";

import type { VoiceChannelInfo, VoiceStatus } from "../../../common/outputs";

type OutputListItemProps = {
  voiceChannel: VoiceChannelInfo;
  /** The output is on (this computer) or the bot is in / joining this channel. */
  selected: boolean;
  /** A bot's voice status in this channel, if it is in it. */
  status?: VoiceStatus;
  /** Plain-language problem, read out with the channel name. */
  problem?: string;
  onClick: (channelId: string) => void;
};

export function OutputListItem({ voiceChannel, selected, status, problem, onClick }: OutputListItemProps) {
  const busy = status === "joining" || status === "reconnecting";
  const icon = busy ? (
    <CircularProgress size="1rem" aria-label={status === "joining" ? "Joining" : "Reconnecting"} />
  ) : status === "error" ? (
    <ErrorIcon sx={{ fontSize: "1rem" }} color="error" aria-label="Problem" />
  ) : selected ? (
    <TickIcon sx={{ fontSize: "1rem" }} aria-hidden />
  ) : null;
  return (
    <ListItem
      disablePadding
      secondaryAction={icon && <Box sx={{ height: "1rem", display: "flex" }}>{icon}</Box>}
      sx={{ "& .MuiListItemButton-root": { pr: icon ? "32px" : undefined } }}
    >
      <ListItemButton
        selected={selected}
        aria-pressed={selected}
        aria-description={problem}
        dense
        onClick={() => onClick(voiceChannel.id)}
      >
        <ListItemIcon sx={{ minWidth: "36px", color: selected ? "primary.main" : undefined }}>
          <VolumeIcon />
        </ListItemIcon>
        <ListItemText primary={voiceChannel.name} />
      </ListItemButton>
    </ListItem>
  );
}
