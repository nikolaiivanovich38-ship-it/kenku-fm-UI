import React, { useEffect, useState } from "react";
import type { BotState } from "../../../common/outputs";

const WAIT_TEXT = /Trying again in \d+ s…/;

/**
 * UX finding 6: "Trying again in 8 s…" counts down to the attempt's due
 * time (`retryAt`, from the main process) instead of keeping its first number.
 */
function withCountdown(reason: string, retryAt: number | undefined, now: number): string {
  if (retryAt === undefined || !WAIT_TEXT.test(reason)) {
    return reason;
  }
  const seconds = Math.ceil((retryAt - now) / 1000);
  return reason.replace(WAIT_TEXT, seconds > 0 ? `Trying again in ${seconds} s…` : "Trying again now…");
}

/** When the bot's next automatic attempt is due, if it is waiting to try again. */
export function nextRetryAt(bot: BotState): number | undefined {
  if (bot.retryAt !== undefined) {
    return bot.retryAt;
  }
  return bot.voice.find((session) => session.status === "reconnecting" && session.retryAt !== undefined)?.retryAt;
}

/**
 * A bot's state in plain words, e.g. "In Tavern", or the reason something
 * failed. Errors stay until the bot reconnects or leaves the channel; the
 * error messages show them too, until they are closed or the cause is fixed.
 */
export function botStatusText(bot: BotState, now = Date.now()): string {
  if (bot.error) {
    // The message box says "Error connecting to bot: …"; here it reads as a state.
    return withCountdown(bot.error.replace(/^Error connecting to bot: /, "Could not connect: "), bot.retryAt, now);
  }
  const problem = bot.voice.find((session) => session.status === "error" || session.status === "reconnecting");
  if (problem?.error) {
    return withCountdown(problem.error, problem.retryAt, now);
  }
  const joining = bot.voice.find((session) => session.status === "joining");
  if (joining) {
    return `Joining ${joining.channelName}…`;
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

/** Re-renders once a second while `until` is in the future, for a countdown. */
function useNow(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (until === undefined || until <= Date.now()) {
      return;
    }
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= until) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}

/**
 * The bot's state in a line. The countdown is not announced every second:
 * the status chip (role="status") already says the bot is reconnecting.
 */
export function BotStatusLine({ bot }: { bot: BotState }) {
  const now = useNow(nextRetryAt(bot));
  return <span>{botStatusText(bot, now)}</span>;
}
