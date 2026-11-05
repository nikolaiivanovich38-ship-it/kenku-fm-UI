/**
 * Campaigns, the top level (UX-1, round 4): one card per campaign in its own table theme, with its next session,
 * Run next session (straight to Live) and Open; New campaign. (views/campaigns.js part 1.)
 */
import React, { useLayoutEffect, useRef, useState } from "react";

import { isRefused, type CampaignInfo } from "../../../common/lyre/api";
import { useCampaigns, useLyreApi } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { runInLive } from "../../kit/liveSession";
import { useAnnounce } from "../../shell/Announcer";
import { useThemeChoice } from "../../shell/useThemeChoice";
import type { ScreenProps } from "..";
import { CAMPAIGN_THEME_IDS, DEFAULT_CAMPAIGN_THEME, formatDate, nextSession, plural, sessionLabel, shownTheme, SYSTEMS, themeName, themeNote } from "./model";
import { ObsidianFields, useAudioMessages, type ObsidianValues } from "./parts";

import "./campaigns.css";

export function CampaignsScreen(_props: ScreenProps) {
  const campaigns = useCampaigns().data;
  const [creating, setCreating] = useState(false);
  useAudioMessages();
  return (
    <>
      <div className="viewhead">
        <h1>Campaigns</h1>
        {campaigns && <span className="muted cp-count">{plural(campaigns.length, "campaign")}</span>}
        <span className="grow" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New campaign
        </Button>
      </div>
      <div className="viewbody">
        <div className="cp-grid">
          {campaigns?.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      </div>
      {creating && <NewCampaignSheet onClose={() => setCreating(false)} />}
    </>
  );
}

/** Playlists and pad boards a campaign uses anywhere (campaign, sessions, scenes), for the card's tooltip. */
function counts(c: CampaignInfo): string {
  const playlists = new Set(c.playlistIds);
  const boards = new Set(c.boardIds);
  for (const s of c.sessions) {
    s.playlistIds.forEach((id) => playlists.add(id));
    s.boardIds.forEach((id) => boards.add(id));
    for (const sc of s.scenes) {
      [...sc.music, ...(sc.ambience ? [sc.ambience] : [])].forEach((ref) => ref.kind === "playlist" && playlists.add(ref.id));
      sc.boardIds.forEach((id) => boards.add(id));
    }
  }
  return `${plural(c.sessions.length, "session")} · ${plural(playlists.size, "playlist")} · ${plural(boards.size, "pad board")}`;
}

function CampaignCard({ campaign: c }: { campaign: CampaignInfo }) {
  const [choice] = useThemeChoice();
  const next = nextSession(c);
  const headingId = `cph-${c.id}`;
  return (
    <article className="cp-card" data-theme={shownTheme(choice, c.theme)} aria-labelledby={headingId} title={counts(c)}>
      <div className="cp-card-top">
        <span className="cp-sys">{c.system || "No game system"}</span>
        <span className="cp-thname">
          <Icon name="palette" size="s" />
          {themeName(c.theme || DEFAULT_CAMPAIGN_THEME)}
        </span>
      </div>
      <h2 className="display cp-card-name" id={headingId}>
        {c.name}
      </h2>
      <p className="cp-blurb ellipsis" title={c.description}>
        {c.description || <span className="faint">No description</span>}
      </p>
      <p className="cp-next">
        <span className="cp-next-lbl">Next</span>
        {next ? (
          <>
            <span className="cp-next-name ellipsis">{sessionLabel(next)}</span>
            <span className="cp-next-date">{formatDate(next.date)}</span>
          </>
        ) : (
          <span className="faint">Nothing planned yet</span>
        )}
      </p>
      <div className="cp-card-btns">
        <a className="btn cp-btnlink" href={`#/campaign/${c.id}`} aria-label={`Open ${c.name}`}>
          Open
        </a>
        {next ? (
          <Button
            variant="primary"
            icon="broadcast"
            aria-label={`Run next session of ${c.name}: Session ${next.number}`}
            onClick={() => runInLive({ campaignId: c.id, sessionId: next.id })}
          >
            Run next session
          </Button>
        ) : (
          <Button variant="primary" icon="broadcast" aria-disabled="true" title="No session planned yet">
            Run next session
          </Button>
        )}
      </div>
    </article>
  );
}

/* ---------- New campaign ---------- */

function NewCampaignSheet({ onClose }: { onClose: () => void }) {
  const api = useLyreApi();
  const { say, toast } = useAnnounce();
  const [name, setName] = useState("");
  const [system, setSystem] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState<string>(DEFAULT_CAMPAIGN_THEME);
  const [obsidian, setObsidian] = useState<ObsidianValues>({ vault: "", note: "", sessionsFolder: "" });
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The sheet previews the chosen theme (the prototype colours the whole panel).
  useLayoutEffect(() => {
    const panel = bodyRef.current?.closest<HTMLElement>(".panel");
    if (panel) panel.dataset.theme = theme;
  }, [theme]);

  const refuseName = (message: string) => {
    setNameError(message);
    nameRef.current?.focus();
    say(message);
  };
  const create = async () => {
    if (!name.trim()) return refuseName("Give the campaign a name.");
    const result = await api.campaigns.create({
      name: name.trim(),
      system: system.trim(),
      description: description.trim(),
      theme: theme as CampaignInfo["theme"],
      obsidian,
    });
    if (isRefused(result)) {
      if (result.refusal.field === "name") return refuseName(result.refusal.message);
      return toast(result.refusal.message);
    }
    onClose();
    window.location.hash = `#/campaign/${result.value.id}`;
    toast(`Made "${result.value.name}" with a first draft session`);
  };

  return (
    <Dialog
      open
      title="New campaign"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="plus" onClick={create}>
            Create campaign
          </Button>
        </>
      }
    >
      <div className="cp-form" ref={bodyRef}>
        <div className="field">
          <label htmlFor="cp-n-name">Name</label>
          <input
            ref={nameRef}
            className="input"
            id="cp-n-name"
            autoComplete="off"
            placeholder="For example: The Sunken Crown"
            aria-describedby="cp-n-err"
            aria-invalid={nameError ? true : undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (event.target.value.trim()) setNameError(null);
            }}
          />
          <p className="cp-err" id="cp-n-err" hidden={!nameError}>
            {nameError ?? "Give the campaign a name."}
          </p>
        </div>
        <div className="field">
          <label htmlFor="cp-n-sys">Game system</label>
          <input className="input" id="cp-n-sys" list="cp-systems" autoComplete="off" placeholder="Type or pick one" value={system} onChange={(event) => setSystem(event.target.value)} />
          <SystemList id="cp-systems" />
        </div>
        <div className="field cp-wide">
          <label htmlFor="cp-n-blurb">
            Description <span className="faint">(one line)</span>
          </label>
          <input className="input" id="cp-n-blurb" autoComplete="off" placeholder="One line about the story" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <fieldset className="cp-themes cp-wide">
          <legend>Theme</legend>
          <p className="hint">How Lyre looks while this campaign is open. You can change it later.</p>
          <div className="cp-th-grid" role="radiogroup" aria-label="Theme">
            {CAMPAIGN_THEME_IDS.map((id) => (
              <ThemeOption
                key={id}
                id={id}
                checked={theme === id}
                onChoose={() => {
                  setTheme(id);
                  say(`Theme: ${themeName(id)}`);
                }}
              />
            ))}
          </div>
        </fieldset>
        <details className="cp-obs cp-wide">
          <summary>
            <Icon name="chevdown" size="s" />
            Obsidian <span className="cp-later">coming later</span>
          </summary>
          <p className="hint">Where this campaign&apos;s notes live in Obsidian. Lyre keeps these for a later version; nothing connects yet.</p>
          <ObsidianFields idPrefix="cp-n-o-" values={obsidian} onChange={(field, value) => setObsidian((o) => ({ ...o, [field]: value }))} />
        </details>
      </div>
    </Dialog>
  );
}

/** The game systems offered while typing one. */
export function SystemList({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {SYSTEMS.map((s) => (
        <option key={s} value={s} />
      ))}
    </datalist>
  );
}

/** A theme to choose, with a small preview of its colours and heading type. */
function ThemeOption({ id, checked, onChoose }: { id: string; checked: boolean; onChoose: () => void }) {
  const note = themeNote(id);
  return (
    <label className="cp-th" data-theme={id}>
      <span className="cp-th-prev" aria-hidden="true">
        <span className="cp-th-h">Aa</span>
        <span className="cp-th-row">
          <i className="m" />
          <i className="a" />
        </span>
        <span className="cp-th-btn" />
      </span>
      <span className="cp-th-name">
        <input type="radio" name="cp-theme" value={id} checked={checked} onChange={onChoose} />
        {themeName(id)}
      </span>
      <span className="cp-th-sub">
        {note}
        {id === DEFAULT_CAMPAIGN_THEME && !/default/i.test(note) ? " · default" : ""}
      </span>
    </label>
  );
}
