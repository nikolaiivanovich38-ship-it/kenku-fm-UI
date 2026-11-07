/**
 * Settings' folded boxes (design/prototype/src/views/settings.js): Sound to Discord with the crossfade (OUT-8, PLY-8),
 * Headphones and speakers (PRV-2), Remote control (SEC-4), Keyboard shortcuts (UX-12), Website tabs and Local files
 * (OUT-8). Each change saves at once and says so ("Saved: …").
 *
 * PRV-2, lead decision (B6-NOTES, 7 Nov): there is no "On air, on this computer" device: what the players hear is
 * heard only through Discord (BUG-19); the split puts the preview in one ear of the headset.
 */
import React, { useEffect, useId, useRef, useState } from "react";

import { isRefused, type LyreSettings } from "../../../common/lyre/api";
import { DEFAULT_WINDOW_SETTINGS, type StreamingMode, type WindowSettings, type WindowSettingsChange } from "../../../common/windowSettings";
import { globalKeyProblem } from "../../../common/globalKeys";
import { shortcutKey, type AudioDevices, type ShortcutAction } from "../../../common/domain";
import type { RemoteState } from "../../../common/remoteControl";
import { useLyreApi, useLyreSettings } from "../../api";
import { useLyreAudio } from "../../audio";
import type { OutputDeviceInfo } from "../../audio/lyreAudio";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { useGlobalKeyRefusals } from "../../settings/SettingsAppliers";
import { useAnnounce } from "../../shell/Announcer";
import { Radio, RadioButtons, Switch, useSaved, useSettingsBridges } from "./common";
import { CROSSFADE_CHOICES, STREAMING_MODES, crossfadeSaved, keyPressed, remoteListen, shortcutRows } from "./settingsModel";

/** The main window's settings, kept current; Kenku FM's defaults until the main window has told them. */
function useWindowSettings(): [WindowSettings, (change: WindowSettingsChange) => Promise<boolean>] {
  const { windowSettings } = useSettingsBridges();
  const [state, setState] = useState<WindowSettings>(DEFAULT_WINDOW_SETTINGS);
  useEffect(() => {
    if (!windowSettings) return;
    let current = true;
    const stop = windowSettings.onChange((next) => current && setState(next));
    windowSettings.get().then(
      (next) => current && next && setState(next),
      (): void => undefined,
    );
    return () => {
      current = false;
      stop();
    };
  }, [windowSettings]);
  const set = async (change: WindowSettingsChange) => {
    if (!windowSettings) return false;
    // Shown at once; the main window's answer follows (onChange).
    setState((s) => ({ ...s, ...change }));
    return windowSettings.set(change);
  };
  return [state, set];
}

/** A LyreApi settings write: the refusal's words as a note, else Saved. */
function useSettingsWrite() {
  const saved = useSaved();
  const { toast } = useAnnounce();
  return async (write: Promise<{ ok: boolean } & object>, what: string, detail?: string): Promise<boolean> => {
    const answer = await write;
    if (isRefused(answer as never)) {
      toast((answer as unknown as { refusal: { message: string } }).refusal.message);
      return false;
    }
    saved(what, detail);
    return true;
  };
}

/* ---------- Sound to Discord ---------- */

export function SoundPane() {
  const [win, setWin] = useWindowSettings();
  const settings = useLyreSettings().data;
  const api = useLyreApi();
  const write = useSettingsWrite();
  const saved = useSaved();
  const { say } = useAnnounce();
  const ids = useId();
  const crossfade = settings?.crossfade ?? { ms: 3000, curve: "even" as const };
  return (
    <Pane id="st-sound" title="Sound to Discord" icon="broadcast" kind="plain" size="auto" noMax collapsed describe="Both send sound to Discord with the same short delay. A change applies the next time a bot joins a voice channel.">
      <RadioButtons<StreamingMode>
        label="Sound to Discord"
        options={STREAMING_MODES}
        value={win.streamingMode}
        onChange={(mode) => {
          if (mode === win.streamingMode) return;
          const name = STREAMING_MODES.find((m) => m.value === mode)!.name;
          void setWin({ streamingMode: mode }).then((went) => went && saved(`setting: ${name}`));
          say(`${name}. Applies the next time a bot joins a voice channel.`);
        }}
      />
      <div className="st-xf">
        <div className="field">
          <label htmlFor={`${ids}-xf`}>Between tracks</label>
          <select
            className="input"
            id={`${ids}-xf`}
            title="How one track hands over to the next when nothing else says"
            value={String(Math.round(crossfade.ms / 1000))}
            disabled={!settings}
            onChange={(event) => {
              const ms = Number(event.target.value) * 1000;
              void write(api.settings.setCrossfade({ ...crossfade, ms }), crossfadeSaved(ms));
            }}
          >
            {CROSSFADE_CHOICES.map((c) => (
              <option key={c.seconds} value={c.seconds}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-curve`}>Crossfade curve</label>
          <select
            className="input"
            id={`${ids}-curve`}
            title="Equal power keeps the level steady in the middle of a crossfade"
            value={crossfade.curve}
            disabled={!settings}
            onChange={(event) => {
              const curve = event.target.value as "even" | "power";
              void write(api.settings.setCrossfade({ ...crossfade, curve }), `crossfade curve ${curve === "even" ? "Even" : "Equal power"}`);
            }}
          >
            <option value="even">Even</option>
            <option value="power">Equal power</option>
          </select>
        </div>
      </div>
    </Pane>
  );
}

/* ---------- Headphones and speakers ---------- */

const DEFAULT_DEVICE_NAME = "System default";

export function DevicesPane() {
  const settings = useLyreSettings().data;
  const api = useLyreApi();
  const audio = useLyreAudio();
  const write = useSettingsWrite();
  const ids = useId();
  const [list, setList] = useState<OutputDeviceInfo[]>([]);
  useEffect(() => {
    let current = true;
    audio.previewDevices().then(
      (found) => current && setList(found.filter((d) => d.deviceId !== "" && d.deviceId !== "default")),
      (): void => undefined,
    );
    return () => {
      current = false;
    };
  }, [audio]);
  const devices = settings?.devices;
  const set = (patch: Partial<AudioDevices>, what: string): void => void write(api.settings.setComputer({ devices: patch }), what);
  const nameOf = (id: string) => (id ? (list.find((d) => d.deviceId === id)?.label ?? "a device that is not plugged in") : DEFAULT_DEVICE_NAME);
  const split = devices?.split ?? false;
  const ear = devices?.previewEar ?? "left";
  const missing = devices && devices.previewDevice !== "" && !list.some((d) => d.deviceId === devices.previewDevice);
  return (
    <Pane id="st-devices" title="Headphones and speakers" icon="headphones" kind="plain" size="auto" noMax collapsed describe="If a device is unplugged, Lyre uses the computer's default until it is back.">
      <p className="hint">What the players hear goes only to Discord; this is where you hear the preview.</p>
      <div className="field">
        <label htmlFor={`${ids}-pv`}>{split ? "Headset" : "Preview (only you)"}</label>
        <select className="input" id={`${ids}-pv`} value={devices?.previewDevice ?? ""} disabled={!devices} onChange={(event) => set({ previewDevice: event.target.value }, `preview plays on ${nameOf(event.target.value)}`)}>
          <option value="">{DEFAULT_DEVICE_NAME}</option>
          {missing && <option value={devices!.previewDevice}>Not plugged in now (the default plays until it is back)</option>}
          {list.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <Switch
        label="Split one headset"
        title="The preview in one ear and what you hear of Discord in the other, on one headset"
        checked={split}
        disabled={!devices}
        onChange={(on) => set({ split: on }, on ? `one headset split: preview in the ${ear} ear` : "headset not split")}
      />
      {split && (
        <div className="st-ears" role="radiogroup" aria-label="Which ear has the preview">
          {(["left", "right"] as const).map((side) => (
            <Radio key={side} name={`${ids}-ear`} label={`Preview in the ${side} ear`} checked={ear === side} onChange={() => set({ previewEar: side }, `preview in the ${side} ear`)} />
          ))}
        </div>
      )}
    </Pane>
  );
}

/* ---------- Remote control ---------- */

const STREAM_DECK = "https://github.com/owlbear-rodeo/kenku-fm";

export function RemotePane() {
  const { remote } = useSettingsBridges();
  const saved = useSaved();
  const { toast, say } = useAnnounce();
  const [state, setState] = useState<RemoteState | null>(null);
  const ids = useId();
  useEffect(() => {
    if (!remote) return;
    let current = true;
    const stop = remote.onChange((next) => current && setState(next));
    remote.get().then(
      (next) => current && setState(next),
      (): void => undefined,
    );
    return () => {
      current = false;
      stop();
    };
  }, [remote]);
  const change = async (patch: Parameters<NonNullable<typeof remote>["set"]>[0], what: string) => {
    if (!remote) return;
    const answer = await remote.set(patch);
    if ("error" in answer) {
      toast(answer.error);
      return;
    }
    setState(answer);
    saved(what);
  };
  const on = state?.enabled ?? false;
  const listen = state ? remoteListen(state) : "local";
  const home = state?.homeAddress ?? null;
  return (
    <Pane
      id="st-remote"
      title="Remote control"
      icon="link"
      kind="plain"
      size="auto"
      noMax
      collapsed
      status={on ? { text: "On", tone: "on" } : undefined}
      describe="Off until you turn it on. Each device needs the secret code."
    >
      <Switch
        label="Let other devices control Lyre"
        title="The Stream Deck plugin, a phone or another program on this computer or your network"
        checked={on}
        disabled={!state}
        onChange={(next) => {
          void change({ enabled: next }, `remote control ${next ? "on" : "off"}`);
          say(`Remote control ${next ? "on" : "off"}`);
        }}
      />
      {on && state && (
        <>
          <div className="st-code" role="group" aria-label="Secret code">
            <span className="st-l">Code</span>
            <output className="num st-codev">{state.code}</output>
            <button
              type="button"
              className="btn s"
              onClick={() => {
                void navigator.clipboard?.writeText(state.code).then(
                  () => toast("Code copied"),
                  () => toast("Lyre could not copy the code: type it on the other device."),
                );
              }}
            >
              <Icon name="file" size="s" />
              Copy code
            </button>
            <button
              type="button"
              className="btn s ghost"
              title="The old code stops working at once; type the new one on each device"
              onClick={() => {
                void remote?.newCode().then((next) => {
                  setState(next);
                  saved("new remote control code", "the old one stops working");
                });
              }}
            >
              <Icon name="restart" size="s" />
              Make a new code
            </button>
          </div>
          {!state.codeRemembered && <p className="hint">This computer cannot keep the code encrypted, so Lyre makes a new one each time it starts.</p>}
          <div className="st-listen" role="radiogroup" aria-label="Listens on">
            <Radio name={`${ids}-listen`} label="This computer only" checked={listen === "local"} onChange={() => void change({ address: "127.0.0.1" }, "remote control listens on this computer only")} />
            <Radio
              name={`${ids}-listen`}
              label="Your home network"
              checked={listen === "home"}
              disabled={!home && listen !== "home"}
              title={home ? "For a phone or tablet on the same Wi-Fi" : "This computer is on no home network now"}
              onChange={() => home && void change({ address: home }, "remote control listens on your home network")}
            />
          </div>
          <p className="st-addr2">
            <span className="st-l">Address</span>
            <span className="num" title="Type this address and the code on the remote device">
              {state.address}:{state.port}
            </span>
          </p>
          {listen === "home" && home && home !== state.address && (
            <p className="st-err">
              <Icon name="warn" size="s" />
              <span className="grow">This computer&apos;s address on your network is now {home}.</span>
              <button type="button" className="btn s" onClick={() => void change({ address: home }, "remote control listens on your home network")}>
                Use {home}
              </button>
            </p>
          )}
          {state.problem && (
            <p className="st-err" role="alert">
              <Icon name="warn" size="s" />
              {state.problem}
            </p>
          )}
        </>
      )}
      <a className="st-link" href={STREAM_DECK} target="_blank" rel="noopener noreferrer">
        About the Kenku FM Stream Deck plugin
      </a>
    </Pane>
  );
}

/* ---------- Keyboard shortcuts ---------- */

export function KeysPane() {
  const settings = useLyreSettings().data;
  const api = useLyreApi();
  const write = useSettingsWrite();
  const { toast, say } = useAnnounce();
  const refused = useGlobalKeyRefusals();
  const [changing, setChanging] = useState<ShortcutAction | null>(null);
  const [sheet, setSheet] = useState(false);
  const map = settings?.shortcuts ?? {};
  const rows = shortcutRows(map);
  const mapRef = useRef(map);
  mapRef.current = map;

  // While a key is being changed, the next key pressed is the new key, and nothing else hears it.
  useEffect(() => {
    if (!changing) return;
    const action = changing;
    const onKeyDown = (event: KeyboardEvent) => {
      const answer = keyPressed(mapRef.current, action, event);
      if (answer.kind === "wait") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (answer.kind === "refused") {
        toast(answer.message);
        return;
      }
      setChanging(null);
      setTimeout(() => document.querySelector<HTMLElement>(`[data-k="st-key-${action}"]`)?.focus(), 0);
      if (answer.kind === "keep") {
        say(answer.message);
        return;
      }
      const name = rows.find((r) => r.id === action)!.name;
      const lyreKey = shortcutKey({}, action);
      void write(api.settings.setShortcut(action, answer.key === lyreKey ? null : answer.key), `key for ${name}: ${answer.key}`);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // rows follow map, which mapRef holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changing]);

  const globalProblem = settings?.globalKeys
    ? (["nextScene", "fadeAll"] as const).map((action) => globalKeyProblem(action, shortcutKey(map, action))).filter(Boolean)
    : [];
  const problems = refused.length ? refused.map((r) => r.message) : (globalProblem as string[]);

  return (
    <Pane id="st-keys" title="Keyboard shortcuts" icon="grid" kind="plain" size="auto" noMax collapsed describe="Ctrl+K finds and plays anything. Change any key here.">
      <table className="grid st-keys" aria-label="Keyboard shortcuts">
        <tbody>
          {rows.map((row) => {
            const now = changing === row.id;
            return (
              <tr key={row.id} aria-label={row.name}>
                <th scope="row">{row.name}</th>
                <td>{now ? <span className="st-press">Press the new key (Esc keeps {row.key})</span> : <span className="kbd">{row.key}</span>}</td>
                <td className="faint">{row.where}</td>
                <td>
                  <button
                    type="button"
                    className="btn s ghost"
                    data-k={`st-key-${row.id}`}
                    aria-label={`Change the key for ${row.name}`}
                    aria-pressed={now || undefined}
                    disabled={!settings}
                    onClick={() => {
                      setChanging(row.id);
                      say(`Press the new key, or Esc to keep ${row.key}`);
                    }}
                  >
                    Change…
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Switch
        label="Ignore a second Next scene within a second"
        title="So a double press never skips a scene"
        checked={settings?.nextSceneGuard ?? true}
        disabled={!settings}
        onChange={(on) => void write(api.settings.setNextSceneGuard(on), `a second Next scene within a second is ${on ? "ignored" : "not ignored"}`)}
      />
      <Switch
        label="Next scene and Fade everything out work in other programs too"
        title="While Discord or your VTT is in front. Off: the keys work only in Lyre."
        checked={settings?.globalKeys ?? false}
        disabled={!settings}
        onChange={(on) => void write(api.settings.setComputer({ globalKeys: on }), `keys in other programs ${on ? "on" : "off"}`)}
      />
      {problems.map((message) => (
        <p className="st-err" role="alert" key={message}>
          <Icon name="warn" size="s" />
          {message}
        </p>
      ))}
      <p className="hint">Pad keys are set on each pad board.</p>
      <div className="row-flex">
        <button type="button" className="btn s" disabled={!settings} onClick={() => void write(api.settings.resetShortcuts(), "Lyre's keys put back")}>
          <Icon name="restart" size="s" />
          Put back Lyre&apos;s keys
        </button>
        <button type="button" className="btn s" onClick={() => setSheet(true)}>
          <Icon name="file" size="s" />
          Printable sheet
        </button>
      </div>
      {sheet && <KeysSheet settings={settings} onClose={() => setSheet(false)} />}
    </Pane>
  );
}

/** Every key on one sheet, to print and keep beside the screen. */
function KeysSheet({ settings, onClose }: { settings: LyreSettings | undefined; onClose: () => void }) {
  const rows = shortcutRows(settings?.shortcuts ?? {});
  return (
    <Dialog
      open
      title="Lyre's keys"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              try {
                window.print();
              } catch {
                // No printer on this computer: the sheet stays on screen.
              }
            }}
          >
            <Icon name="file" size="s" />
            Print
          </button>
        </>
      }
    >
      <div className="st-print">
        <table className="grid st-keys">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Key</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                <td>
                  <span className="kbd">{row.key}</span>
                </td>
                <td>{row.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Pad keys are on each pad board.</p>
      </div>
    </Dialog>
  );
}

/* ---------- Website tabs ---------- */

export function TabsPane() {
  const [win, setWin] = useWindowSettings();
  const { windowSettings } = useSettingsBridges();
  const { toast, say } = useAnnounce();
  const saved = useSaved();
  const set = (change: WindowSettingsChange, what: string): void => void setWin(change).then((went) => went && saved(`setting: ${what}`));
  return (
    <Pane id="st-tabs" title="Website tabs" icon="grid" kind="plain" size="auto" noMax collapsed>
      <Switch label="Show the address bar on tabs" checked={win.urlBarEnabled} onChange={(on) => set({ urlBarEnabled: on }, `address bar ${on ? "shown" : "hidden"}`)} />
      <Switch label="Microphones and other inputs" checked={win.externalInputsEnabled} onChange={(on) => set(on ? { externalInputsEnabled: true } : { externalInputsEnabled: false, multipleInputsEnabled: false }, `inputs ${on ? "on" : "off"}`)} />
      <Switch
        label="Use several inputs at once"
        checked={win.multipleInputsEnabled}
        disabled={!win.externalInputsEnabled}
        why="Turn on Microphones and other inputs first."
        onChange={(on) => set({ multipleInputsEnabled: on }, `several inputs at once ${on ? "on" : "off"}`)}
      />
      <button
        type="button"
        className="btn s"
        disabled={!windowSettings}
        title="Logs you out of websites in tabs and deletes their saved files. Your library, playlists and settings are kept."
        onClick={() => {
          void windowSettings?.clearWebsiteData().then(
            () => {
              toast("Website data cleared: tabs are logged out");
              say("Website data cleared");
            },
            () => toast("Lyre could not clear the website data. Try again."),
          );
        }}
      >
        Clear website data
      </button>
    </Pane>
  );
}

/* ---------- Local files ---------- */

export function FilesPane() {
  const { windowSettings } = useSettingsBridges();
  const saved = useSaved();
  const { say } = useAnnounce();
  const [folders, setFolders] = useState<string[] | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!windowSettings) return;
    let current = true;
    windowSettings.localFolders().then(
      (list) => current && setFolders(list),
      (): void => undefined,
    );
    return () => {
      current = false;
    };
  }, [windowSettings]);
  return (
    <Pane id="st-files" title="Local files" icon="folder" kind="plain" size="auto" noMax collapsed describe="Lyre asks before opening a file from your computer. Folders you choose not to be asked about again are listed here.">
      {!folders || folders.length === 0 ? (
        <p className="faint">None</p>
      ) : (
        <ul className="list st-folders" aria-label="Folders opened without asking" ref={listRef}>
          {folders.map((folder, i) => (
            <li className="lrow" key={folder}>
              <span className="grow ellipsis num" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                className="btn s ghost"
                aria-label={`Ask again before opening files in ${folder}`}
                onClick={() => {
                  void windowSettings?.forgetLocalFolder(folder).then((left) => {
                    setFolders(left);
                    say(`Lyre asks again before opening files in ${folder}`);
                    saved(`setting: ask before opening files in ${folder}`);
                    // Focus goes to the folder that took its place, or the box's header.
                    setTimeout(() => {
                      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
                      const next = buttons?.[Math.min(i, buttons.length - 1)];
                      (next ?? document.querySelector<HTMLElement>('[data-pane="st-files"] .pane-toggle'))?.focus();
                    }, 0);
                  });
                }}
              >
                Ask again
              </button>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}
