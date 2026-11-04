import React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import type { Theme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/ComputerRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";
import { useSelector } from "react-redux";

import type { RootState } from "../../app/store";
import { LOCAL_OUTPUT_ID, botLabel, type BotState } from "../../../common/outputs";
import { botChip } from "./OutputStatusChip";

type StatusColor = ReturnType<typeof botChip>["color"];

function ringColor(theme: Theme, color: StatusColor) {
  return color === "default" ? theme.palette.text.disabled : theme.palette[color].main;
}

/** The bot's number ("Bot 2" → "2"), so two bots can be told apart at a glance. */
function botMark(bot: BotState): string {
  return /(\d+)$/.exec(bot.name)?.[1] ?? bot.name.charAt(0);
}

type RailOutputProps = {
  label: string;
  status: string;
  color: StatusColor;
  /** For a bot: muted. For This Computer: switched on. */
  pressed: boolean;
  muted: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

/**
 * One output as a round button: a ring in its status colour (as the status
 * chip in the expanded sidebar), and a crossed-out speaker while it is silent.
 */
function RailOutput({ label, status, color, pressed, muted, onClick, children }: RailOutputProps) {
  return (
    <IconButton
      aria-label={label}
      aria-pressed={pressed}
      aria-description={status}
      data-status={color}
      // A native tooltip: it is drawn above website views, where MUI's would be hidden.
      title={`${label}: ${status}`}
      onClick={onClick}
      sx={{ p: 0.5 }}
    >
      <Box
        sx={(theme) => ({
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: `2px ${color === "default" ? "dashed" : "solid"} ${ringColor(theme, color)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          typography: "body2",
          fontWeight: 600,
          color: muted ? "text.disabled" : "text.primary",
        })}
      >
        {muted ? <VolumeOffIcon sx={{ fontSize: 18 }} /> : children}
      </Box>
    </IconButton>
  );
}

/**
 * UX finding 9: the outputs in the collapsed sidebar, so a bot that drops
 * out is still noticed: This Computer, then every bot that is in use, each
 * with its status colour. A click mutes or unmutes it, as in the full list.
 */
export function OutputRail() {
  const output = useSelector((state: RootState) => state.output);
  const shownBots = output.bots.filter((bot) => bot.status !== "offline" || bot.voice.length > 0);
  return (
    <Stack role="group" aria-label="Outputs" alignItems="center" spacing={0.5} sx={{ py: 1 }}>
      <RailOutput
        label="This Computer"
        status={output.local.muted ? "Off" : "On"}
        color={output.local.muted ? "default" : "success"}
        pressed={!output.local.muted}
        muted={output.local.muted}
        onClick={() => window.kenku.outputs.setMuted(LOCAL_OUTPUT_ID, !output.local.muted)}
      >
        <ComputerIcon sx={{ fontSize: 18 }} />
      </RailOutput>
      {shownBots.map((bot) => {
        const chip = botChip(bot);
        const label = botLabel(bot);
        return (
          <RailOutput
            key={bot.id}
            label={`Mute ${label}`}
            status={chip.label}
            color={chip.color}
            pressed={bot.muted}
            muted={bot.muted}
            onClick={() => window.kenku.outputs.setMuted(bot.id, !bot.muted)}
          >
            {botMark(bot)}
          </RailOutput>
        );
      })}
    </Stack>
  );
}
