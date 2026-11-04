import React from "react";
import type { BotState } from "../../../common/outputs";

/** A bot's state in a few words, e.g. "In Tavern" or "Connecting…". */
export function botStatusText(bot: BotState): string {
  const problem = bot.voice.find((session) => session.status === "error");
  if (bot.status === "error") {
    return "Not connected: there was a problem";
  }
  if (problem) {
    return `Could not join ${problem.channelName}`;
  }
  const joining = bot.voice.find((session) => session.status === "joining");
  if (joining) {
    return `Joining ${joining.channelName}…`;
  }
  const reconnecting = bot.voice.find((session) => session.status === "reconnecting");
  if (reconnecting) {
    return `Reconnecting to ${reconnecting.channelName}…`;
  }
  const connected = bot.voice.filter((session) => session.status === "connected");
  if (connected.length > 0) {
    return `In ${connected.map((session) => session.channelName).join(", ")}${bot.muted ? " (muted)" : ""}`;
  }
  switch (bot.status) {
    case "connecting":
      return "Connecting…";
    case "ready":
      return "Connected: choose a voice channel";
    default:
      return bot.hasToken ? "Not connected" : "No token yet";
  }
}

export function BotStatusLine({ bot }: { bot: BotState }) {
  return <span>{botStatusText(bot)}</span>;
}
