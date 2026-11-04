import React from "react";
import Chip from "@mui/material/Chip";
import type { BotState } from "../../../common/outputs";

type ChipLook = { label: string; color: "default" | "success" | "info" | "warning" | "error" };

/** OUT-2: one word for where a bot output stands. */
export function botChip(bot: BotState): ChipLook {
  const statuses = bot.voice.map((session) => session.status);
  if (bot.status === "error" || statuses.includes("error")) {
    return { label: "Error", color: "error" };
  }
  if (statuses.includes("reconnecting") || (bot.status === "connecting" && bot.error)) {
    return { label: "Reconnecting…", color: "warning" };
  }
  if (statuses.includes("joining")) {
    return { label: "Joining…", color: "info" };
  }
  if (bot.status === "connecting") {
    return { label: "Connecting…", color: "info" };
  }
  if (statuses.includes("connected")) {
    return { label: bot.muted ? "Muted" : "Connected", color: bot.muted ? "default" : "success" };
  }
  if (bot.status === "ready") {
    return { label: "Ready", color: "default" };
  }
  return { label: "Offline", color: "default" };
}

/** Whether the Reconnect button makes sense for this bot. */
export function canReconnect(bot: BotState): boolean {
  return bot.hasToken && botChip(bot).color === "error";
}

/** Status chip for a bot output; `role="status"` so changes are announced. */
export function BotStatusChip({ bot }: { bot: BotState }) {
  const look = botChip(bot);
  return <Chip role="status" size="small" variant="outlined" label={look.label} color={look.color} />;
}

/** Status chip for "This Computer". */
export function LocalStatusChip({ muted }: { muted: boolean }) {
  return (
    <Chip
      role="status"
      size="small"
      variant="outlined"
      label={muted ? "Off" : "On"}
      color={muted ? "default" : "success"}
    />
  );
}
