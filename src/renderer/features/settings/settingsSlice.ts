import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * SEC-5: the Discord token is no longer a setting (the main process keeps it
 * encrypted); OUT-1: "Multiple Outputs" is replaced by the output list.
 */
export type ConnectionStatus = "disconnected" | "connecting" | "ready";
export type StreamingMode = "lowLatency" | "performance";

export interface SettingsState {
  urlBarEnabled: boolean;
  remoteEnabled: boolean;
  remoteAddress: string;
  remotePort: string;
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
  remoteEnabled: false,
  remoteAddress: "127.0.0.1",
  remotePort: "3333",
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
    setRemoteEnabled: (state, action: PayloadAction<boolean>) => {
      state.remoteEnabled = action.payload;
    },
    setRemoteAddress: (state, action: PayloadAction<string>) => {
      state.remoteAddress = action.payload;
    },
    setRemotePort: (state, action: PayloadAction<string>) => {
      state.remotePort = action.payload;
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
  setRemoteEnabled,
  setRemoteAddress,
  setRemotePort,
  setExternalInputsEnabled,
  setMultipleInputsEnabled,
  setStreamingMode,
  dismissLegacyTokenNotice,
} = connectionSlice.actions;

export default connectionSlice.reducer;
