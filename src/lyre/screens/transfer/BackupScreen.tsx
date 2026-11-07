/**
 * Back up, move or share (route `backup`, DAT-7), ported from design/prototype/src/views/transfer.js and transfer.css.
 *
 * - Save to a file: the whole library, one campaign, session, scene, playlist or pad board, or the tags only, with or
 *   without the audio files (with their size, or why they cannot go in); Lyre asks where to save (`transfer.save`).
 * - Open a file: choose or drop a .lyre file; it shows what is in it, new or already yours, and for each duplicate
 *   Skip, Merge or Keep both (or the same for all) before Bring in, which is one undo step. A file Lyre does not open
 *   is refused in the main process's plain words and nothing changes.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

import { isRefused, type BringInReport, type DuplicateChoice, type OpenedFile, type SavedFile, type TransferEstimate } from "../../../common/lyre/api";
import { useBoards, useCampaigns, useLyreApi, usePlaylists } from "../../api";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { Badge } from "../../kit/Pills";
import { Column, Pane } from "../../kit/Pane";
import { cx } from "../../kit/cx";
import { useAnnounce } from "../../shell/Announcer";
import { hashOf } from "../../shell/routes";
import { CHOICES, KIND_WORDS, WHAT, plural, scopeOptions, sizeWords, type WhatKind } from "./model";
import { focusSoon, pathOfDropped } from "./parts";
import "./transfer.css";
import { TopLead } from "../../shell/TopBar";

export function BackupScreen() {
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Back up, move or share</h1>
      </div>
      <div className="viewbody tf-body">
        <div className="tf-cols">
          <Column>
            <SavePane />
          </Column>
          <Column>
            <OpenPane />
          </Column>
        </div>
      </div>
    </>
  );
}

/* ---------- Save to a file ---------- */

function SavePane() {
  const api = useLyreApi();
  const { say } = useAnnounce();
  const campaigns = useCampaigns().data;
  const playlists = usePlaylists().data;
  const boards = useBoards().data;
  const [what, setWhat] = useState<WhatKind>("library");
  const [picks, setPicks] = useState<Partial<Record<WhatKind, string>>>({});
  const [audio, setAudio] = useState(false);
  const [estimate, setEstimate] = useState<TransferEstimate | null>(null);
  const [saved, setSaved] = useState<SavedFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => scopeOptions(what, { campaigns: campaigns ?? [], playlists: playlists ?? [], boards: boards ?? [] }), [what, campaigns, playlists, boards]);
  const chosen = options.find((o) => o.value === picks[what]) ?? options[0];
  const scopeKey = chosen ? JSON.stringify(chosen.scope) : "";

  useEffect(() => {
    let current = true;
    if (!chosen) {
      setEstimate(null);
      return;
    }
    api.transfer.estimate(chosen.scope).then(
      (e) => current && setEstimate(e),
      () => current && setEstimate(null),
    );
    return () => {
      current = false;
    };
    // scopeKey names the scope; the option object itself is new on every load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, scopeKey]);

  const changed = () => {
    setSaved(null);
    setProblem(null);
  };
  const noAudio = estimate?.leaveAudioOutBecause ?? (what === "tags" ? "Tags have no audio files." : null);
  const withAudio = audio && !noAudio;

  const save = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    try {
      const result = await api.transfer.save({ scope: chosen.scope, includeAudio: withAudio });
      if (isRefused(result)) {
        setProblem(result.refusal.message);
        say(result.refusal.message);
      } else if (result.value) {
        setSaved(result.value);
        setProblem(null);
        say(result.value.summary);
      }
    } finally {
      setSaving(false);
    }
  };

  const audioWords = noAudio
    ? noAudio
    : withAudio && estimate
      ? `${estimate.audioBytes !== null ? `About ${sizeWords(estimate.audioBytes)}: ` : ""}${plural(estimate.audioFiles, "audio file")} go into the file, so it works on a PC that has none of them.`
      : "Without them the file stays small. The other PC needs the same files; Lyre finds them there with Find missing files.";

  return (
    <Pane id="tf-export" title="Save to a file" icon="download" kind="plain" noMax size="auto" status={{ text: saved ? "Saved" : "Ready", tone: "idle" }}>
      <fieldset className="tf-what">
        <legend>What to save</legend>
        {WHAT.map((w) => {
          const on = what === w.kind;
          const list = on && w.which ? options : [];
          return (
            <div key={w.kind} className={cx("tf-opt", on && "on")}>
              <label>
                <input
                  type="radio"
                  name="tf-what"
                  value={w.kind}
                  checked={on}
                  data-focus={`tf-w-${w.kind}`}
                  onChange={() => {
                    setWhat(w.kind);
                    changed();
                  }}
                />
                <span>
                  <b>{w.title}</b>
                  <span className="hint tf-sub">{w.sub}</span>
                </span>
              </label>
              {on && w.which && (
                list.length ? (
                  <select
                    className="input tf-pick"
                    aria-label={w.which}
                    value={chosen?.value}
                    onChange={(e) => {
                      setPicks({ ...picks, [w.kind]: e.target.value });
                      changed();
                    }}
                  >
                    {list.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="hint tf-pick">Your library has none yet.</p>
                )
              )}
            </div>
          );
        })}
      </fieldset>
      <label className="tf-check">
        <input
          type="checkbox"
          checked={withAudio}
          disabled={!!noAudio}
          onChange={(e) => {
            setAudio(e.target.checked);
            changed();
          }}
        />
        <span>
          <b>Include the audio files</b>
          <span className="hint tf-sub">{audioWords}</span>
        </span>
      </label>
      <div className="tf-actrow">
        <Button variant="primary" icon="download" onClick={() => void save()} disabled={!chosen || saving} data-focus="tf-save">
          Save to a file…
        </Button>
        {estimate && <span className="hint">Saves {estimate.fileName}</span>}
      </div>
      {saved && (
        <p className="tf-done" role="status">
          <Icon name="check" size="s" />
          <span className="grow">{saved.summary}</span>
        </p>
      )}
      {problem && (
        <p className="tf-refused" role="alert">
          <Icon name="warn" size="s" />
          <span>{problem}</span>
        </p>
      )}
    </Pane>
  );
}

/* ---------- Open a file ---------- */

type OpenState = { state: "ready" } | { state: "refused"; reason: string } | { state: "preview"; file: OpenedFile; choices: Record<string, DuplicateChoice> } | { state: "done"; report: BringInReport };

function OpenPane() {
  const api = useLyreApi();
  const { say } = useAnnounce();
  const [open, setOpen] = useState<OpenState>({ state: "ready" });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const opened = async (source: { from: "choose-file" } | { from: "path"; path: string }) => {
    const from = document.activeElement;
    setBusy(true);
    try {
      const result = await api.transfer.open(source);
      if (isRefused(result)) {
        setOpen({ state: "refused", reason: result.refusal.message });
        say(result.refusal.message);
        focusSoon(paneRef, "tf-choose", from);
        return;
      }
      const file = result.value;
      if (!file) return;
      const choices: Record<string, DuplicateChoice> = {};
      file.items.forEach((i) => i.status === "duplicate" && (choices[i.key] = "skip"));
      setOpen({ state: "preview", file, choices });
      const dupes = file.items.filter((i) => i.status === "duplicate").length;
      say(`Opened ${file.fileName}: ${plural(file.items.length, "kind of thing", "kinds of thing")} in it.${dupes ? " Choose what to do with the ones you have already." : ""}`);
      focusSoon(paneRef, "tf-bring", from);
    } finally {
      setBusy(false);
    }
  };

  const bring = async () => {
    if (open.state !== "preview" || busy) return;
    const from = document.activeElement;
    setBusy(true);
    try {
      const result = await api.transfer.bringIn(open.file.id, { each: open.choices });
      if (isRefused(result)) {
        setOpen({ state: "refused", reason: result.refusal.message });
        say(result.refusal.message);
        focusSoon(paneRef, "tf-choose", from);
        return;
      }
      setOpen({ state: "done", report: result.value });
      say(result.value.summary);
      focusSoon(paneRef, "tf-torelink", from);
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    const from = document.activeElement;
    setOpen({ state: "ready" });
    focusSoon(paneRef, "tf-choose", from);
  };

  let body: React.ReactNode;
  if (open.state === "ready" || open.state === "refused") {
    body = (
      <>
        <div
          className={cx("tf-drop", over && "over")}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            const file = e.dataTransfer?.files?.[0];
            setOver(false);
            if (!file) return;
            e.preventDefault();
            void opened({ from: "path", path: pathOfDropped(file) });
          }}
        >
          <p>
            <Icon name="upload" size="s" />
            <span>Drop a Lyre file here, or</span>
          </p>
          <Button icon="file" onClick={() => void opened({ from: "choose-file" })} disabled={busy} data-focus="tf-choose">
            Choose a file…
          </Button>
        </div>
        {open.state === "refused" && (
          <p className="tf-refused" role="alert">
            <Icon name="warn" size="s" />
            <span>{open.reason}</span>
          </p>
        )}
        <p className="hint">Open a file you saved on another PC, or one another GM shared with you. You see what is in it before anything changes.</p>
      </>
    );
  } else if (open.state === "preview") {
    const { file, choices } = open;
    const tracks = file.items.find((i) => i.kind === "tracks");
    const choose = (key: string, value: DuplicateChoice) => setOpen({ ...open, choices: { ...choices, [key]: value } });
    const forAll = (value: DuplicateChoice, label: string) => {
      setOpen({ ...open, choices: Object.fromEntries(Object.keys(choices).map((k) => [k, value])) });
      say(label);
    };
    body = (
      <>
        <p className="tf-file">
          <Icon name="file" size="s" />
          <b>{file.fileName}</b>
          <span className="hint">
            Made with {file.madeWith} · {file.includesAudio ? "audio files included" : "audio files not included"}
          </span>
        </p>
        <ul className="list tf-items" aria-label="What is in the file">
          {file.items.map((item) => (
            <li key={item.key} className={cx("tf-item", item.status === "duplicate" && "dup")}>
              <span className="tf-kind">{KIND_WORDS[item.kind]}</span>
              <span className="tf-iname grow">
                <b className="ellipsis">{item.name}</b>
                <span className="hint ellipsis">{item.detail}</span>
              </span>
              {item.status === "duplicate" ? (
                <ChoiceGroup label={`${KIND_WORDS[item.kind]} ${item.name}: you have this already`} value={choices[item.key] ?? "skip"} onChange={(v) => choose(item.key, v)} />
              ) : (
                <Badge>New</Badge>
              )}
            </li>
          ))}
        </ul>
        {Object.keys(choices).length > 0 && (
          <div className="tf-actrow">
            <span className="hint">For every item you have already:</span>
            {CHOICES.map((c) => {
              const label = `${c.label} for every item you have already`;
              return (
                <Button key={c.value} size="s" aria-label={label} title={c.hint} onClick={() => forAll(c.value, label)}>
                  {c.label}
                </Button>
              );
            })}
          </div>
        )}
        {!file.includesAudio && tracks && (
          <p className="hint">The {tracks.name} come without their audio files: Lyre lists them under Find missing files until you point it at a folder that has them.</p>
        )}
        <div className="tf-actrow">
          <Button variant="primary" icon="upload" onClick={() => void bring()} disabled={busy} data-focus="tf-bring">
            Bring in
          </Button>
          <Button onClick={again}>Cancel</Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="tf-done" role="status">
          <Icon name="check" size="s" />
          <span className="grow">{open.report.summary}</span>
        </p>
        <div className="tf-actrow">
          {open.report.missingFiles > 0 && (
            <a className="btn s" href={hashOf("relink")} data-focus="tf-torelink">
              <Icon name="folder" size="s" />
              Find missing files…
            </a>
          )}
          <Button size="s" variant="ghost" onClick={again} data-focus={open.report.missingFiles > 0 ? undefined : "tf-torelink"}>
            Open another file
          </Button>
        </div>
      </>
    );
  }
  const status = open.state === "ready" ? { text: "Ready", tone: "idle" as const } : open.state === "refused" ? { text: "Refused", tone: "warn" as const } : open.state === "preview" ? { text: "Not brought in yet", tone: "on" as const } : { text: "Brought in", tone: "idle" as const };
  return (
    <div ref={paneRef}>
      <Pane id="tf-import" title="Open a file" icon="upload" kind="plain" noMax size="auto" status={status}>
        {body}
      </Pane>
    </div>
  );
}

/** Skip, Merge or Keep both for one duplicate: a radio group, one Tab stop, the arrow keys move and choose. */
function ChoiceGroup({ label, value, onChange }: { label: string; value: DuplicateChoice; onChange: (value: DuplicateChoice) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = CHOICES.findIndex((c) => c.value === value);
  const move = (to: number) => {
    const next = (to + CHOICES.length) % CHOICES.length;
    onChange(CHOICES[next].value);
    refs.current[next]?.focus();
  };
  return (
    <span className="seg s" role="radiogroup" aria-label={label}>
      {CHOICES.map((c, i) => (
        <button
          key={c.value}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          tabIndex={value === c.value ? 0 : -1}
          title={c.hint}
          onClick={() => onChange(c.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(index + 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(index - 1);
            }
          }}
        >
          {c.label}
        </button>
      ))}
    </span>
  );
}
