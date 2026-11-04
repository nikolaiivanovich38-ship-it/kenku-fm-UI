import React, { useEffect, useRef, useState } from "react";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Link from "@mui/material/Link";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormHelperText from "@mui/material/FormHelperText";

import { RootState } from "../../app/store";
import { useSelector, useDispatch } from "react-redux";
import { setStatus } from "../connection/connectionSlice";
import {
  setExternalInputsEnabled,
  setMultipleInputsEnabled,
  setRemoteEnabled,
  setRemoteAddress,
  setRemotePort,
  setURLBarEnabled,
  setStreamingMode,
  StreamingMode,
  dismissLegacyTokenNotice,
} from "./settingsSlice";
import { LegacyTokenNotice, LEGACY_TOKEN_SESSION_ONLY } from "./LegacyTokenNotice";
import { showAppError } from "../../common/appErrors";
import { showWindowControls } from "../../common/showWindowControls";
import { LocalFilesSettings } from "./LocalFilesSettings";

import Alert from "@mui/material/Alert";
import type { OutputsState } from "../../../common/outputs";
import { overallStatus, setOutputsState } from "../output/outputSlice";
import { AddBotDialog } from "./AddBotDialog";
import { BotSettings } from "./BotSettings";

type SettingsProps = {
  open: boolean;
  onClose: () => void;
};

export function Settings({ open, onClose }: SettingsProps) {
  const settings = useSelector((state: RootState) => state.settings);
  const dispatch = useDispatch();

  const outputs = useSelector((state: RootState) => state.output);
  const [addingBot, setAddingBot] = useState(false);
  const sessionOnlyShown = useRef(false);

  // OUT-1: mirror the main process's output state, and log in the bots that
  // have a saved token, as Kenku FM did when the window opened.
  useEffect(() => {
    const apply = (state: OutputsState) => {
      dispatch(setOutputsState(state));
      dispatch(setStatus(overallStatus(state.bots)));
      // WP1 review 11: the user never typed this token; tell them now, not after a restart.
      if (state.legacyTokenSessionOnly && !sessionOnlyShown.current) {
        sessionOnlyShown.current = true;
        showAppError(LEGACY_TOKEN_SESSION_ONLY);
      }
    };
    window.kenku.on("OUTPUTS_STATE", (args) => apply(args[0]));
    void window.kenku.outputs.getState().then(apply);
    window.kenku.outputs.connectSaved();
    return () => {
      window.kenku.removeAllListeners("OUTPUTS_STATE");
    };
  }, [dispatch]);

  async function handleAddBot() {
    setAddingBot(false);
    await window.kenku.outputs.addBot();
  }

  const discordSettings = (
    <Stack spacing={2}>
      {settings.legacyTokenNotice && (
        <LegacyTokenNotice onDismiss={() => dispatch(dismissLegacyTokenNotice())} />
      )}
      {!outputs.encryption && (
        // A standing note, not an alert: error messages own role="alert".
        <Alert severity="warning" variant="outlined" role="note">
          This computer has no secure place to save passwords, so bot tokens are kept only until Cue Desk
          closes. You will need to enter them again next time.
        </Alert>
      )}
      {outputs.bots.map((bot, index) => (
        <BotSettings key={bot.id} bot={bot} removable={outputs.bots.length > 1} autoFocus={index === 0} />
      ))}
      <Link
        href="https://kenku.fm/docs/getting-a-discord-token"
        variant="caption"
        textAlign="center"
        target="_blank"
        rel="noopener noreferrer"
      >
        Where do I get my token?
      </Link>
      <Button onClick={() => setAddingBot(true)} fullWidth variant="text" size="small">
        {outputs.bots.length < 2 ? "Add a second bot" : "Add another bot"}
      </Button>
      <AddBotDialog
        open={addingBot}
        botCount={outputs.bots.length}
        onCancel={() => setAddingBot(false)}
        onAdd={handleAddBot}
      />
    </Stack>
  );

  function handleRemoteToggle() {
    const enabled = !settings.remoteEnabled;
    if (enabled) {
      window.kenku.playerStartRemote(
        settings.remoteAddress,
        settings.remotePort,
      );
    } else {
      window.kenku.playerStopRemote();
    }
    dispatch(setRemoteEnabled(enabled));
  }

  function handleRemoteAddressChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    dispatch(setRemoteAddress(event.target.value));
  }

  function handleRemotePortChange(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch(setRemotePort(event.target.value));
  }

  useEffect(() => {
    if (settings.remoteEnabled) {
      window.kenku.playerStartRemote(
        settings.remoteAddress,
        settings.remotePort,
      );
    }
  }, []);

  const remoteSettings = (
    <Stack spacing={1}>
      <Stack direction="row">
        <TextField
          margin="dense"
          size="small"
          id="remote-address"
          label="Address"
          variant="standard"
          autoComplete="off"
          InputLabelProps={{
            shrink: true,
          }}
          inputProps={{ pattern: "d{1,3}.d{1,3}.d{1,3}.d{1,3}" }}
          value={settings.remoteAddress}
          onChange={handleRemoteAddressChange}
          disabled={settings.remoteEnabled}
          sx={{ mr: 0.5 }}
        />
        <TextField
          margin="dense"
          size="small"
          id="remote-port"
          label="Port"
          variant="standard"
          autoComplete="off"
          InputLabelProps={{
            shrink: true,
          }}
          inputProps={{ pattern: "d+" }}
          value={settings.remotePort}
          onChange={handleRemotePortChange}
          disabled={settings.remoteEnabled}
          sx={{ ml: 0.5 }}
        />
      </Stack>
      <Button
        onClick={handleRemoteToggle}
        fullWidth
        variant="outlined"
        size="small"
        disabled={!settings.remoteAddress || !settings.remotePort}
      >
        {settings.remoteEnabled ? "Stop Remote" : "Start Remote"}
      </Button>
      <Link
        href="https://www.kenku.fm/docs/using-kenku-remote"
        variant="caption"
        textAlign="center"
        target="_blank"
        rel="noopener noreferrer"
        py={2}
      >
        What is Kenku Remote?
      </Link>
    </Stack>
  );

  const [streamingModeChanged, setStreamingModeChanged] = useState(false);

  function handleStreamingModeChange(event: SelectChangeEvent) {
    dispatch(setStreamingMode(event.target.value as StreamingMode));
    setStreamingModeChanged(true);
  }

  // PERF-4: audio capture no longer starts here; it starts when an output
  // joins a voice channel, with the mode chosen at that moment.
  useEffect(() => {
    window.kenku.setStreamingMode(settings.streamingMode);
  }, [settings.streamingMode]);

  const streamingSettings = (
    <FormControl fullWidth variant="standard" margin="dense">
      <InputLabel id="streaming-mode-select-label">Mode</InputLabel>
      <Select
        labelId="streaming-mode-select-label"
        label="Mode"
        value={settings.streamingMode}
        onChange={handleStreamingModeChange}
      >
        {/* PERF-8: both modes now have the same short delay; the stored
            values keep their old names so saved settings still work. */}
        <MenuItem value="lowLatency">Best sound quality</MenuItem>
        <MenuItem value="performance">Lighter on the computer</MenuItem>
      </Select>
      <FormHelperText>
        {streamingModeChanged
          ? "Applies the next time Cue Desk joins a voice channel."
          : "Both send sound to Discord with the same short delay."}
      </FormHelperText>
    </FormControl>
  );

  function handleShowControlsToggle() {
    dispatch(setURLBarEnabled(!settings.urlBarEnabled));
  }

  function handleExternalInputsToggle() {
    dispatch(setExternalInputsEnabled(!settings.externalInputsEnabled));
  }

  function handleMultipleInputsToggle() {
    dispatch(setMultipleInputsEnabled(!settings.multipleInputsEnabled));
  }

  const [clearingCache, setClearingCache] = useState(false);
  async function handleCacheClear() {
    setClearingCache(true);
    await window.kenku.clearCache();
    setClearingCache(false);
  }

  const otherSettings = (
    <Stack spacing={1}>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.urlBarEnabled}
              onChange={handleShowControlsToggle}
            />
          }
          sx={{ marginLeft: "-8px" }}
          label={<Typography variant="caption">Show Tab URL Bar</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.externalInputsEnabled}
              onChange={handleExternalInputsToggle}
            />
          }
          sx={{ marginLeft: "-8px" }}
          label={<Typography variant="caption">External Inputs</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.multipleInputsEnabled}
              onChange={handleMultipleInputsToggle}
            />
          }
          disabled={!settings.externalInputsEnabled}
          sx={{ marginLeft: "-8px" }}
          label={
            <Typography
              variant="caption"
              sx={{ opacity: settings.externalInputsEnabled ? undefined : 0.5 }}
            >
              Multiple Inputs
            </Typography>
          }
        />
      </FormGroup>
      <Button
        onClick={handleCacheClear}
        fullWidth
        variant="outlined"
        size="small"
      >
        {clearingCache ? <CircularProgress size={24} /> : "Clear Cache"}
      </Button>
    </Stack>
  );

  return (
    <Dialog fullScreen sx={{ width: 240 }} open={open} onClose={onClose}>
      <DialogTitle
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        Settings
      </DialogTitle>
      <DialogContent>
        <DialogContentText>Discord bots</DialogContentText>
        {discordSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Remote</DialogContentText>
        {remoteSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Streaming</DialogContentText>
        {streamingSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Other</DialogContentText>
        {otherSettings}
        <LocalFilesSettings />
        <Stack my={1}>
          <Typography
            variant="caption"
            color="text.secondary"
            textAlign="center"
          >
            v{window.kenku.version}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
