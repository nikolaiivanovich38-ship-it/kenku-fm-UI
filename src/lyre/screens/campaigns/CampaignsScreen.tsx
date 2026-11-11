/**
 * Campaigns, the top level (UX-1, round 4): one card per campaign in its own table theme, with its next session,
 * Run next session (straight to Live) and Open; New campaign. (views/campaigns.js part 1.)
 *
 * 0.5.1 (Nik, 11 Nov): the cards are in the game master's order, kept in the library. Drag a card by its handle, press
 * Alt+Up or Alt+Down on any of its links or buttons, or switch Reorder on for Move up and Move down on each card (WCAG
 * 2.5.7, as in a playlist's tracks in a scene).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

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
import { ObsidianFields, Opening, useHeadingFocusWhenReady, useWrite, type ObsidianValues } from "./parts";
import { useDragReorder, type DragReorder } from "./reorder";

import "./campaigns.css";
import { TopLead } from "../../shell/TopBar";

export function CampaignsScreen(_props: ScreenProps) {
  const campaigns = useCampaigns().data;
  const [creating, setCreating] = useState(false);
  if (!campaigns) return <Opening />;
  return <CampaignsList campaigns={campaigns} creating={creating} setCreating={setCreating} />;
}

/** The Reorder switch, kept while Lyre is open (it shows the buttons; it changes nothing). */
let reorderingCampaigns = false;

function CampaignsList({ campaigns, creating, setCreating }: { campaigns: CampaignInfo[]; creating: boolean; setCreating: (on: boolean) => void }) {
  useHeadingFocusWhenReady();
  const api = useLyreApi();
  const write = useWrite();
  const { say } = useAnnounce();
  const [reordering, setReorderingNow] = useState(reorderingCampaigns);
  const setReordering = (on: boolean) => setReorderingNow((reorderingCampaigns = on));
  // A new order shows at once while it is saved; the library's answer then takes over (a refusal puts it back).
  const [shown, setShown] = useState<string[] | null>(null);
  useEffect(() => setShown(null), [campaigns]);
  const ordered = shown ? shown.flatMap((id) => campaigns.filter((c) => c.id === id)) : campaigns;
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ id: string; control: string } | null>(null);
  useEffect(() => {
    const want = focusAfter.current;
    const el = want && gridRef.current?.querySelector<HTMLElement>(`[data-cid="${CSS.escape(want.id)}"] [data-ctl="${want.control}"]`);
    if (el && !el.hasAttribute("disabled")) {
      focusAfter.current = null;
      el.focus();
    }
  });

  const move = async (from: number, to: number, control?: string) => {
    const c = ordered[from];
    if (!c || to < 0 || to >= ordered.length || from === to) return;
    const ids = ordered.map((x) => x.id);
    ids.splice(from, 1);
    ids.splice(to, 0, c.id);
    setShown(ids);
    if (control) focusAfter.current = { id: c.id, control };
    if ((await write(api.campaigns.move(c.id, to))) === undefined) return setShown(null);
    say(`${c.name} is now ${to + 1} of ${ids.length}`);
  };
  const drag = useDragReorder("campaigns", (from, to) => void move(from, to), { grid: true });
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const control = (event.target as HTMLElement).closest<HTMLElement>("[data-ctl]")?.dataset.ctl ?? "open";
    void move(index, index + (event.key === "ArrowUp" ? -1 : 1), control);
  };

  return (
    <>
      <div className="viewhead">
        <TopLead />
        {/* Round 6 (UX-R3): no count beside the heading; every card is on screen, so the cards are the count. */}
        <h1>Campaigns</h1>
        <span className="grow" />
        {campaigns.length > 1 && (
          <Button
            size="s"
            icon="drag"
            className="ghost ro-tog"
            pressed={reordering}
            title={reordering ? "Done reordering" : "Show Move up and Move down on each campaign (or drag a card)"}
            onClick={() => setReordering(!reordering)}
          >
            Reorder
          </Button>
        )}
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New campaign
        </Button>
      </div>
      <div className="viewbody" data-scroll="body">
        {campaigns.length ? (
          <div className="cp-grid" ref={gridRef}>
            {ordered.map((c, i) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                index={i}
                count={ordered.length}
                drag={drag}
                reordering={reordering}
                move={(to, control) => void move(i, to, control)}
                onKeyDown={(event) => onKeyDown(event, i)}
              />
            ))}
          </div>
        ) : (
          // w3-ux 9: a first-time user learns what a campaign is and what to do first.
          <div className="empty">
            <b>No campaigns yet.</b> A campaign holds your sessions, the scenes in each, and the music, ambience and pad boards you use in them. Start
            with <b>New campaign</b>.
          </div>
        )}
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

interface CardProps {
  campaign: CampaignInfo;
  index: number;
  count: number;
  drag: DragReorder;
  reordering: boolean;
  /** Move this card to another place; `control` (data-ctl) keeps the focus on that button. */
  move: (to: number, control: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}

function CampaignCard({ campaign: c, index: i, count, drag, reordering, move, onKeyDown }: CardProps) {
  const [choice] = useThemeChoice();
  const next = nextSession(c);
  const headingId = `cph-${c.id}`;
  return (
    // Round 6 (UX-R3): the card is drawn in its theme; the theme's name is in its hover text, not on the card.
    <article
      className={`cp-card ${drag.rowClass(i)}`}
      data-theme={shownTheme(choice, c.theme)}
      data-cid={c.id}
      aria-labelledby={headingId}
      title={`${counts(c)} · theme: ${themeName(c.theme || DEFAULT_CAMPAIGN_THEME)}`}
      onKeyDown={onKeyDown}
      {...drag.rowProps(i)}
    >
      <div className="cp-card-top">
        {count > 1 && (
          <span className="cp-handle" title="Drag to change the order (or Alt+Up / Alt+Down)" aria-hidden="true" {...drag.handleProps}>
            <Icon name="drag" size="s" />
          </span>
        )}
        <span className="cp-sys grow">{c.system || "No game system"}</span>
        {reordering && (
          <span className="ro-btns">
            <button type="button" className="closer" data-ctl="up" aria-label={`Move up: ${c.name}`} title="Move up (Alt+Up)" disabled={i === 0} onClick={() => move(i - 1, "up")}>
              <Icon name="chevup" size="s" />
            </button>
            <button type="button" className="closer" data-ctl="down" aria-label={`Move down: ${c.name}`} title="Move down (Alt+Down)" disabled={i === count - 1} onClick={() => move(i + 1, "down")}>
              <Icon name="chevdown" size="s" />
            </button>
          </span>
        )}
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
        <a className="btn cp-btnlink" href={`#/campaign/${c.id}`} aria-label={`Open ${c.name}`} data-ctl="open">
          Open
        </a>
        {next ? (
          <Button
            variant="primary"
            icon="broadcast"
            aria-label={`Run next session of ${c.name}: Session ${next.number}`}
            data-ctl="run"
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
