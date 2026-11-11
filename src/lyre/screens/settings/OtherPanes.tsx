/**
 * Settings' folded boxes (design/prototype/src/views/settings.js): Sound to Discord with the crossfade and Empty the
 * audio cache (OUT-8, PLY-8, FND-16), Headphones and speakers (PRV-2), Remote control (SEC-4; hidden in 0.5.1 until
 * Stream Deck support, SHOW_REMOTE_CONTROL) and Keyboard shortcuts (UX-12). Each change saves at once and says so
 * ("Saved: …"). 0.5.1: Website tabs and Local files went with the old window (Nik, 11 Nov: "Keep the code, remove them
 * from the interface"; design/prototype/ROUND8.md §3).
 *
 * PRV-2, lead decision (B6-NOTES, 7 Nov): there is no "On air, on this computer" device: what the players hear is
 * heard only through Discord (BUG-19); the split puts the preview in one ear of the headset.
 */
import React, { useEffect, useId, useRef, useState } from "react";

import type { LyreSettings, WriteResult } from "../../../common/lyre/api";
import { globalKeyProblem } from "../../../common/globalKeys";
import { shortcutKey, type AudioDevices, type ShortcutAction, type StreamingMode } from "../../../common/domain";
import type { RemoteState } from "../../../common/remoteControl";
import { useLyreApi, useLyreSettings } from "../../api";
import { useLyreAudio } from "../../audio";
import type { OutputDeviceInfo } from "../../audio/lyreAudio";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { useGlobalKeyRefusals } from "../../settings/SettingsAppliers";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import { Radio, RadioButtons, Switch, useSaved, useSettingsBridges, useShownAtOnce } from "./common";
import { CROSSFADE_CHOICES, STREAMING_MODES, crossfadeSaved, keyPressed, remoteListen, shortcutRows } from "./settingsModel";

/** A LyreApi settings write through the shell's useSave: Saved, the failure card with Try again, or the refusal. */
function useSettingsWrite() {
  const save = useSave();
  return (write: () => Promise<WriteResult<LyreSettings>>, what: string, key?: string): Promise<unknown> => save(what, write, key ? { key } : undefined);
}

/* ---------- Sound to Discord ---------- */

export function SoundPane() {
  const settings = useLyreSettings().data;
  const api = useLyreApi();
  const write = useSettingsWrite();
  const { say } = useAnnounce();
  const ids = useId();
  const crossfade = settings?.crossfade ?? { ms: 3000, curve: "even" as const };
  // FND-16: this computer's setting (until 0.5.0 the old main window kept it); Kenku FM's default until it is read.
  const streamingMode: StreamingMode = settings?.streamingMode ?? "performance";
  return (
    <Pane id="st-sound" title="Sound to Discord" icon="broadcast" kind="plain" size="auto" noMax collapsed describe="Both send sound to Discord with the same short delay. A change applies the next time a bot joins a voice channel.">
      <RadioButtons<StreamingMode>
        label="Sound to Discord"
        options={STREAMING_MODES}
        value={streamingMode}
        onChange={(mode) => {
          if (mode === streamingMode) return;
          const name = STREAMING_MODES.find((m) => m.value === mode)!.name;
          void write(() => api.settings.setComputer({ streamingMode: mode }), `setting: ${name}`);
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
              void write(() => api.settings.setCrossfade({ ...crossfade, ms }), crossfadeSaved(ms));
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
              void write(() => api.settings.setCrossfade({ ...crossfade, curve }), `crossfade curve ${curve === "even" ? "Even" : "Equal power"}`);
            }}
          >
            <option value="even">Even</option>
            <option value="power">Equal power</option>
          </select>
        </div>
      </div>
      <EmptyAudioCache />
    </Pane>
  );
}

/**
 * FND-16 (ROUND8.md §3): Empty the audio cache. It was part of the old window's Clear website data; with website tabs
 * gone from the interface only the audio cache part stays. Nothing to confirm: Lyre makes the copies again.
 */
function EmptyAudioCache() {
  const { cache } = useSettingsBridges();
  const { toast } = useAnnounce();
  return (
    <div className="st-cache">
      <button
        type="button"
        className="btn s"
        disabled={!cache}
        title="Deletes the copies Lyre made of your music so tracks start at once. Lyre makes them again when it needs them. Your music files, library and settings are kept."
        onClick={() => {
          void cache?.emptyAudioCache().then(
            () => toast("Audio cache emptied"),
            () => toast("Lyre could not empty the audio cache. Try again."),
          );
        }}
      >
        Empty the audio cache
      </button>
    </div>
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
  const [devices, show] = useShownAtOnce(settings?.devices);
  const set = (patch: Partial<AudioDevices>, what: string): void => {
    if (devices) show({ ...devices, ...patch });
    void write(() => api.settings.setComputer({ devices: patch }), what);
  };
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
    // UX-R10: a change Lyre could not make work shows only its problem (the alert below), never Saved as well.
    if (!answer.problem) saved(what);
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
  const [guard, showGuard] = useShownAtOnce(settings?.nextSceneGuard ?? true);
  const [globalKeys, showGlobalKeys] = useShownAtOnce(settings?.globalKeys ?? false);
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
      void write(() => api.settings.setShortcut(action, answer.key === lyreKey ? null : answer.key), `key for ${name}: ${answer.key}`);
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
        checked={guard}
        disabled={!settings}
        onChange={(on) => {
          showGuard(on);
          void write(() => api.settings.setNextSceneGuard(on), `a second Next scene within a second is ${on ? "ignored" : "not ignored"}`);
        }}
      />
      <Switch
        label="Next scene and Fade all work in other programs too"
        title="While Discord or your VTT is in front. Off: the keys work only in Lyre."
        checked={globalKeys}
        disabled={!settings}
        onChange={(on) => {
          showGlobalKeys(on);
          void write(() => api.settings.setComputer({ globalKeys: on }), `keys in other programs ${on ? "on" : "off"}`);
        }}
      />
      {problems.map((message) => (
        <p className="st-err" role="alert" key={message}>
          <Icon name="warn" size="s" />
          {message}
        </p>
      ))}
      <p className="hint">Pad keys are set on each pad board.</p>
      <div className="row-flex">
        <button type="button" className="btn s" disabled={!settings} onClick={() => void write(() => api.settings.resetShortcuts(), "Lyre's keys put back")}>
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
