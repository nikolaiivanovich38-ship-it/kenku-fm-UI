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

import { DISCORD_BOT_HELP_URL, STREAM_DECK_PLUGIN_HELP_URL } from "../../../common/helpLinks";
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
import ListItemText from "@mui/material/ListItemText";
import { ErrorMessages } from "../errors/ErrorMessages";
import { sidePanelProps } from "../../common/viewOverlay";

/**
 * UX finding 8: Settings grows with the window (so nothing is cut off at
 * 800 × 600 and long folder paths fit on large screens). It is a side panel:
 * the player or website moves to its right edge while it is open.
 */
export const SETTINGS_PANEL_WIDTH = "clamp(320px, 28vw, 440px)";

/** UX finding 8: each mode says how it differs, not only what both share. */
const STREAMING_MODES: { value: StreamingMode; name: string; description: string }[] = [
  // PERF-8: both modes have the same short delay; the stored values keep
  // their old names so saved settings still work.
  { value: "lowLatency", name: "Best sound quality", description: "Clearer sound; works the computer a little harder." },
  {
    value: "performance",
    name: "Lighter on the computer",
    description: "Leaves more power for other programs; slightly less clear.",
  },
];

/** A section heading in the panel. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <DialogContentText component="h3">{children}</DialogContentText>;
}

/**
 * UX finding 8: with no keyring, one line says what happens; "More" gives the reason.
 * A standing note, not an alert: error messages own role="alert".
 */
function KeyringNote() {
  const [more, setMore] = useState(false);
  return (
    <Alert
      severity="warning"
      variant="outlined"
      role="note"
      sx={{ py: 0, "& .MuiAlert-message": { py: 0.75 } }}
    >
      Tokens are forgotten when you close the app.
      {more && (
        <>
          {" "}
          This computer has no secure place to save passwords, so you will need to paste your bot tokens again
          each time you start.
        </>
      )}
      <Link
        component="button"
        variant="body2"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        sx={{ ml: 0.5, verticalAlign: "baseline" }}
      >
        {more ? "Less" : "More"}
      </Link>
    </Alert>
  );
}

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
      {!outputs.encryption && <KeyringNote />}
      {outputs.bots.map((bot, index) => (
        <BotSettings key={bot.id} bot={bot} removable={outputs.bots.length > 1} autoFocus={index === 0} />
      ))}
      <Link
        href={DISCORD_BOT_HELP_URL}
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
      {/* Minor finding: what the two fields mean, in plain words. */}
      <Typography variant="caption" color="text.secondary" component="p">
        Lets a Stream Deck or another program control the player. The address 127.0.0.1 means only programs on
        this computer can connect; the port is the number they use to reach it.
      </Typography>
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
      <Typography variant="caption" color="text.secondary" pt={1}>
        Every remote request must now carry Lyre's secret code, which the Lyre tab's Settings will show; the Kenku FM
        Stream Deck plugin does not send it yet. To use another device on your network, change the address to this
        computer's network address.
      </Typography>
      <Link
        href={STREAM_DECK_PLUGIN_HELP_URL}
        variant="caption"
        textAlign="center"
        target="_blank"
        rel="noopener noreferrer"
        pb={2}
      >
        About the Kenku FM Stream Deck plugin
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
        renderValue={(value) => STREAMING_MODES.find((mode) => mode.value === value)?.name ?? value}
      >
        {STREAMING_MODES.map((mode) => (
          <MenuItem key={mode.value} value={mode.value} sx={{ whiteSpace: "normal", maxWidth: 400 }}>
            <ListItemText
              primary={mode.name}
              secondary={mode.description}
              sx={{ my: 0 }}
              secondaryTypographyProps={{ variant: "caption" }}
            />
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>
        {streamingModeChanged
          ? "Applies the next time a bot joins a voice channel."
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
          label={<Typography variant="caption">Show the address bar on tabs</Typography>}
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
          label={<Typography variant="caption">Microphones and other inputs</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.multipleInputsEnabled}
              onChange={handleMultipleInputsToggle}
              inputProps={{
                "aria-describedby": settings.externalInputsEnabled ? undefined : "several-inputs-reason",
              }}
            />
          }
          disabled={!settings.externalInputsEnabled}
          sx={{ marginLeft: "-8px" }}
          label={
            <Typography
              variant="caption"
              sx={{ opacity: settings.externalInputsEnabled ? undefined : 0.5 }}
            >
              Use several inputs at once
            </Typography>
          }
        />
        {/* Minor finding: a greyed switch says why. */}
        {!settings.externalInputsEnabled && (
          <FormHelperText id="several-inputs-reason" sx={{ mt: 0 }}>
            Turn on Microphones and other inputs first.
          </FormHelperText>
        )}
      </FormGroup>
      <Button
        onClick={handleCacheClear}
        fullWidth
        variant="outlined"
        size="small"
        aria-describedby="clear-website-data-help"
      >
        {clearingCache ? <CircularProgress size={24} aria-label="Clearing website data" /> : "Clear website data"}
      </Button>
      <Typography id="clear-website-data-help" variant="caption" color="text.secondary" component="p">
        Logs you out of websites in tabs and deletes their saved files. Your playlists, bookmarks and settings are
        kept.
      </Typography>
    </Stack>
  );

  return (
    <Dialog
      fullScreen
      sx={{ width: SETTINGS_PANEL_WIDTH }}
      open={open}
      onClose={onClose}
      aria-labelledby="settings-title"
      {...sidePanelProps}
    >
      <DialogTitle
        id="settings-title"
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        Settings
      </DialogTitle>
      {/* UX finding 1: the panel covers the sidebar, so error messages show here while it is open. */}
      <ErrorMessages sx={{ px: 2, pb: 1 }} />
      <DialogContent>
        <SectionHeading>Discord bots</SectionHeading>
        {discordSettings}
        <Divider sx={{ my: 2 }} />
        <SectionHeading>Remote</SectionHeading>
        {remoteSettings}
        <Divider sx={{ mb: 2 }} />
        <SectionHeading>Streaming</SectionHeading>
        {streamingSettings}
        <Divider sx={{ my: 2 }} />
        <SectionHeading>Other</SectionHeading>
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
