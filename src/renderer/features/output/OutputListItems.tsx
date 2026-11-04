import React, { useState } from "react";

import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";

import ExpandLess from "@mui/icons-material/ExpandLessRounded";
import ExpandMore from "@mui/icons-material/ExpandMoreRounded";
import VolumeOnIcon from "@mui/icons-material/VolumeUpRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";

import { RootState } from "../../app/store";
import { useSelector } from "react-redux";
import { LOCAL_OUTPUT_ID, botLabel, type BotState } from "../../../common/outputs";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";

import { OutputListItem } from "./OutputListItem";
import { BotStatusLine } from "./BotStatusLine";
import { BotStatusChip, LocalStatusChip, canReconnect, canTryNow } from "./OutputStatusChip";

/** Shown under "This Computer" when a bot's join switched it off (OutputManager.updateActive). */
export const LOCAL_OFF_NOTE =
  "So you don't hear everything twice, This Computer turns off while a bot is in a channel. Turn it back on if you want to listen here too.";

/** A bot is in, or joining, a voice channel. */
export function botInChannel(bot: BotState): boolean {
  return bot.voice.some((session) => session.status !== "error");
}

/**
 * OUT-1: the outputs in the side bar: this computer, then each Discord bot
 * with its servers' voice channels. Every output can be switched off on its
 * own; each bot can be in a different channel, including in the same server.
 */
export function OutputListItems() {
  const [open, setOpen] = useState(true);
  const output = useSelector((state: RootState) => state.output);
  const shownBots = output.bots.filter((bot) => bot.status !== "offline" || bot.voice.length > 0);
  const localOffForBot = output.local.muted && output.bots.some(botInChannel);

  function toggleLocal() {
    window.kenku.outputs.setMuted(LOCAL_OUTPUT_ID, !output.local.muted);
  }

  return (
    <>
      <ListItemButton onClick={() => setOpen(!open)} aria-expanded={open}>
        <ListItemText primary="Outputs" />
        {open ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          <OutputListItem
            voiceChannel={{ id: LOCAL_OUTPUT_ID, name: "This Computer" }}
            selected={!output.local.muted}
            trailing={<LocalStatusChip muted={output.local.muted} />}
            onClick={toggleLocal}
          />
          {localOffForBot && (
            <Typography variant="caption" component="p" color="text.secondary" sx={{ px: 2, pb: 1 }}>
              {LOCAL_OFF_NOTE}
            </Typography>
          )}
          {shownBots.map((bot) => (
            <BotOutput key={bot.id} bot={bot} />
          ))}
        </List>
      </Collapse>
    </>
  );
}

function BotOutput({ bot }: { bot: BotState }) {
  const label = botLabel(bot);
  const sessionIn = (channelId: string) => bot.voice.find((session) => session.channelId === channelId);

  function handleChannel(channelId: string) {
    const session = sessionIn(channelId);
    if (session && session.status !== "error") {
      window.kenku.outputs.leaveChannel(bot.id, channelId);
    } else {
      // Also retries a channel that failed.
      window.kenku.outputs.joinChannel(bot.id, channelId);
    }
  }

  return (
    <List role="group" aria-label={label} sx={{ py: 0 }}>
      <Divider variant="middle" />
      <ListItem
        secondaryAction={
          <IconButton
            edge="end"
            size="small"
            // A fixed name with aria-pressed: "Mute …, pressed" means muted.
            aria-label={`Mute ${label}`}
            aria-pressed={bot.muted}
            onClick={() => window.kenku.outputs.setMuted(bot.id, !bot.muted)}
          >
            {bot.muted ? <VolumeOffIcon fontSize="small" /> : <VolumeOnIcon fontSize="small" />}
          </IconButton>
        }
      >
        <ListItemText
          primary={label}
          secondary={
            <Stack spacing={0.5} alignItems="flex-start" component="span">
              <BotStatusChip bot={bot} />
              <BotStatusLine bot={bot} />
              {canReconnect(bot) && (
                <Button size="small" variant="outlined" onClick={() => window.kenku.outputs.reconnect(bot.id)}>
                  Reconnect
                </Button>
              )}
              {/* UX finding 6: no need to wait for the countdown once the network is back. */}
              {canTryNow(bot) && (
                <Button size="small" variant="outlined" onClick={() => window.kenku.outputs.reconnect(bot.id)}>
                  Try now
                </Button>
              )}
            </Stack>
          }
          primaryTypographyProps={{ sx: { fontSize: "0.875rem", fontWeight: 500 } }}
          secondaryTypographyProps={{ component: "div" }}
        />
      </ListItem>
      {bot.guilds.map((guild) => (
        <List key={guild.id} sx={{ py: 0 }} aria-label={guild.name}>
          <ListItem alignItems="center">
            <ListItemAvatar sx={{ minWidth: "36px", marginTop: 0, marginLeft: "8px" }}>
              <Avatar sx={{ width: "24px", height: "24px" }} alt={guild.name} src={guild.icon ?? undefined} />
            </ListItemAvatar>
            <ListItemText
              sx={{ backgroundColor: "inherit", color: "rgba(255, 255, 255, 0.7)", padding: 0 }}
              primaryTypographyProps={{ sx: { fontSize: "0.875rem" } }}
            >
              {guild.name}
            </ListItemText>
          </ListItem>
          {guild.voiceChannels.map((channel) => {
            const session = sessionIn(channel.id);
            return (
              <OutputListItem
                key={channel.id}
                voiceChannel={channel}
                selected={Boolean(session && session.status !== "error")}
                status={session?.status}
                problem={session?.error}
                onClick={handleChannel}
              />
            );
          })}
        </List>
      ))}
      {bot.status === "ready" && bot.guilds.length === 0 && (
        <Typography variant="caption" component="p" sx={{ px: 2, pb: 1 }} color="text.secondary">
          This bot is not in any server yet. Invite it to your Discord server first.
        </Typography>
      )}
    </List>
  );
}
