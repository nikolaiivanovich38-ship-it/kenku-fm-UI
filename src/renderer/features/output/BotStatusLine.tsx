import React from "react";
import type { BotState } from "../../../common/outputs";

/**
 * A bot's state in plain words, e.g. "In Tavern", or the reason something
 * failed. Errors stay until the bot reconnects or leaves the channel; the
 * error message box shows them too, until it is closed.
 */
export function botStatusText(bot: BotState): string {
  if (bot.error) {
    // The message box says "Error connecting to bot: …"; here it reads as a state.
    return bot.error.replace(/^Error connecting to bot: /, "Could not connect: ");
  }
  const problem = bot.voice.find((session) => session.status === "error" || session.status === "reconnecting");
  if (problem?.error) {
    return problem.error;
  }
  const joining = bot.voice.find((session) => session.status === "joining");
  if (joining) {
    return `Joining ${joining.channelName}…`;
  }
  const connected = bot.voice.filter((session) => session.status === "connected");
  if (connected.length > 0) {
    return `In ${connected.map((session) => session.channelName).join(", ")}${bot.muted ? " (muted)" : ""}`;
  }
  if (bot.notice) {
    // WP1 review 5: the bot left a channel by itself (a moderator moved it).
    return bot.notice;
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
