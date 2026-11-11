import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * SEC-5: the Discord token is no longer a setting (the main process keeps it
 * encrypted); OUT-1: "Multiple Outputs" is replaced by the output list.
 * Review 0.5.0 CR-3: the remote control's settings moved to Lyre's Settings
 * (remoteMigration.ts).
 */
export type ConnectionStatus = "disconnected" | "connecting" | "ready";
export type StreamingMode = "lowLatency" | "performance";

export interface SettingsState {
  urlBarEnabled: boolean;
  externalInputsEnabled: boolean;
  multipleInputsEnabled: boolean;
  streamingMode: StreamingMode;
  /**
   * WP1 review 4: a token saved unprotected by an older version was moved
   * out of these settings; Settings recommends resetting it until dismissed.
   */
  legacyTokenNotice?: boolean;
}

const initialState: SettingsState = {
  urlBarEnabled: true,
  externalInputsEnabled: false,
  multipleInputsEnabled: false,
  streamingMode: "performance",
};

export const connectionSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setURLBarEnabled: (state, action: PayloadAction<boolean>) => {
      state.urlBarEnabled = action.payload;
    },
    setExternalInputsEnabled: (state, action: PayloadAction<boolean>) => {
      state.externalInputsEnabled = action.payload;
    },
    setMultipleInputsEnabled: (state, action: PayloadAction<boolean>) => {
      state.multipleInputsEnabled = action.payload;
    },
    setStreamingMode: (state, action: PayloadAction<StreamingMode>) => {
      state.streamingMode = action.payload;
    },
    dismissLegacyTokenNotice: (state) => {
      delete state.legacyTokenNotice;
    },
  },
});

export const {
  setURLBarEnabled,
  setExternalInputsEnabled,
  setMultipleInputsEnabled,
  setStreamingMode,
  dismissLegacyTokenNotice,
} = connectionSlice.actions;

export default connectionSlice.reducer;
