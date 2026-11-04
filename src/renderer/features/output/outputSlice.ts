import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  EMPTY_OUTPUTS_STATE,
  type BotState,
  type GuildInfo,
  type OutputsState,
  type VoiceChannelInfo,
} from "../../../common/outputs";

/** OUT-1: a copy of the main process's output state (OutputManager), never persisted. */
export type OutputState = OutputsState;

/** @deprecated name kept for older imports; use VoiceChannelInfo. */
export type VoiceChannel = VoiceChannelInfo;
export type Guild = GuildInfo;

export const outputSlice = createSlice({
  name: "output",
  initialState: EMPTY_OUTPUTS_STATE as OutputState,
  reducers: {
    setOutputsState: (_state, action: PayloadAction<OutputsState>) => action.payload,
  },
});

export const { setOutputsState } = outputSlice.actions;

/** Overall Discord status for places that show one (the "Connect Discord" hint). */
export function overallStatus(bots: BotState[]): "disconnected" | "connecting" | "ready" {
  if (bots.some((bot) => bot.status === "ready")) {
    return "ready";
  }
  if (bots.some((bot) => bot.status === "connecting")) {
    return "connecting";
  }
  return "disconnected";
}

export default outputSlice.reducer;
