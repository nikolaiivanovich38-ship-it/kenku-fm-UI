/**
 * One campaign (round 4): its name, game system, theme and description; its sessions in order, each with Run; the
 * playlists and pad boards on hand in every session; notes; and the Obsidian placeholders. (views/campaigns.js part 2.)
 */
import React, { useEffect, useState } from "react";

import type { CampaignInfo, CampaignPatch, SessionInfo } from "../../../common/lyre/api";
import { useCampaign, useLyreApi } from "../../api";
import { Button } from "../../kit/Button";
import { Icon } from "../../kit/Icon";
import { runInLive } from "../../kit/liveSession";
import { Column, Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { useThemeChoice } from "../../shell/useThemeChoice";
import type { ScreenProps } from "..";
import { SystemList } from "./CampaignsScreen";
import { CAMPAIGN_THEME_IDS, formatDate, nextSession, plural, sessionLabel, themeName } from "./model";
import { OnHandPane } from "./OnHand";
import { DraftField, ModeSwitch, NotFound, ObsidianFields, RowMenu, StatusBadge, useAudioMessages, useFocusLater, useLibraryIndex, useWrite } from "./parts";
import { useDragReorder } from "./reorder";

import "./campaigns.css";

export function CampaignScreen({ route }: ScreenProps) {
  const id = route.params.cid ?? "";
  const query = useCampaign(id);
  const index = useLibraryIndex();
  useAudioMessages();
  const campaign = query.data;
  if (campaign === null) return <NotFound what="Campaign" />;
  if (!campaign || !index) {
    return (
      <div className="viewhead">
        <h1>Campaign</h1>
      </div>
    );
  }
  return <CampaignPage key={campaign.id} campaign={campaign} index={index} />;
}

function CampaignPage({ campaign: c, index }: { campaign: CampaignInfo; index: NonNullable<ReturnType<typeof useLibraryIndex>> }) {
  const api = useLyreApi();
  const write = useWrite();
  const { say, toast } = useAnnounce();
  const [choice] = useThemeChoice();
  // The heading follows the name field as it is typed.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  // Once the library has the text, the screen shows the library's again.
  useEffect(() => setNameDraft((d) => (d !== null && d.trim() === c.name ? null : d)), [c.name]);
  useEffect(() => setNotesDraft((d) => (d !== null && d === c.notes ? null : d)), [c.notes]);
  const next = nextSession(c);
  const forced = choice !== "campaign";

  const update = (patch: CampaignPatch) => write(api.campaigns.update(c.id, patch));
  const newSession = async () => {
    const made = (await write(api.sessions.create(c.id)))?.value;
    if (!made) return;
    window.location.hash = `#/session/${c.id}/${made.id}`;
    toast(`Added Session ${made.number}`);
  };

  const played = c.sessions.filter((s) => s.status === "played").length;
  const shownName = nameDraft ?? c.name;
  return (
    <>
      <div className="viewhead">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="#/campaigns">Campaigns</a>
          <span className="sep" aria-hidden="true">
            ›
          </span>
        </nav>
        <h1>{shownName || "Untitled campaign"}</h1>
        <span className="grow" />
        <ModeSwitch campaign={c} />
        {next && (
          <Button variant="primary" icon="broadcast" onClick={() => runInLive({ campaignId: c.id, sessionId: next.id })}>
            Run next session <span className="cp-btnsub">S{next.number}</span>
          </Button>
        )}
      </div>
      <div className="viewbody fill cp-body">
        <div className="cp-details">
          <div className="field cp-f-name">
            <label htmlFor="cp-c-name">Name</label>
            <DraftField
              className="input"
              id="cp-c-name"
              autoComplete="off"
              value={c.name}
              onDraft={setNameDraft}
              onSave={(name) => void update({ name })}
            />
          </div>
          <div className="field cp-f-sys">
            <label htmlFor="cp-c-sys">Game system</label>
            <DraftField className="input" id="cp-c-sys" list="cp-systems-c" autoComplete="off" value={c.system} onSave={(system) => void update({ system })} />
            <SystemList id="cp-systems-c" />
          </div>
          <div className="field cp-f-theme">
            <label htmlFor="cp-c-theme">Theme</label>
            <select
              className="input"
              id="cp-c-theme"
              value={c.theme}
              aria-describedby={forced ? "cp-forced" : undefined}
              onChange={async (event) => {
                const theme = event.target.value as CampaignInfo["theme"];
                if ((await update({ theme })) !== undefined) say(`Theme: ${themeName(theme)}`);
              }}
            >
              {CAMPAIGN_THEME_IDS.map((t) => (
                <option key={t} value={t}>
                  {themeName(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="field cp-f-blurb">
            <label htmlFor="cp-c-blurb">Description</label>
            <DraftField className="input" id="cp-c-blurb" autoComplete="off" value={c.description} onSave={(description) => void update({ description })} />
          </div>
          {forced && (
            <p className="hint cp-forced" id="cp-forced">
              Look and feel is showing every page in {themeName(choice)}. Choose &quot;Each campaign&apos;s own&quot; there to see this campaign&apos;s theme.
            </p>
          )}
        </div>
        <div className="cp-split">
          <Column>
            <Pane
              id="cp-sessions"
              title="Sessions"
              icon="scroll"
              kind="scenes"
              status={{ text: c.sessions.length ? plural(c.sessions.length, "session") : "Empty" }}
              summary={played && next ? `Next: ${sessionLabel(next)}` : undefined}
              actions={
                <Button size="s" icon="plus" onClick={newSession}>
                  New session
                </Button>
              }
              flush
            >
              <SessionList campaign={c} />
            </Pane>
            <Pane id="cp-notes" title="Notes" icon="edit" size="auto" kind="plain" status={{ text: (notesDraft ?? c.notes) ? "Saved" : "Empty" }}>
              <label className="sr-only" htmlFor="cp-c-notes">
                Campaign notes
              </label>
              <DraftField
                multiline
                className="input cp-notes"
                id="cp-c-notes"
                rows={4}
                placeholder="Anything to remember across sessions"
                value={c.notes}
                onDraft={setNotesDraft}
                onSave={(notes) => void update({ notes })}
              />
            </Pane>
          </Column>
          <Column className="cp-side">
            <OnHandPane
              paneId="cp-cpl"
              title="Campaign playlists"
              kind="playlists"
              owner={{ campaignId: c.id }}
              ids={c.playlistIds}
              index={index}
              why="In every session."
              where={`every session of ${c.name}`}
              ownerWord="campaign"
            />
            <OnHandPane
              paneId="cp-cbd"
              title="Campaign pad boards"
              kind="boards"
              owner={{ campaignId: c.id }}
              ids={c.boardIds}
              index={index}
              why="In every session."
              where={`every session of ${c.name}`}
              ownerWord="campaign"
            />
            <Pane id="cp-obs" title="Obsidian" icon="link" size="auto" collapsed kind="plain" status={{ text: "Coming later" }}>
              <p className="hint cp-why">Placeholders; nothing connects yet.</p>
              <ObsidianFields idPrefix="cp-c-o-" values={c.obsidian} onChange={(field, value) => void update({ obsidian: { ...c.obsidian, [field]: value } })} />
            </Pane>
          </Column>
        </div>
      </div>
    </>
  );
}

/** The sessions in order: drag a handle, or use a row's ⋯ menu, to move one; they are numbered in their order. */
function SessionList({ campaign: c }: { campaign: CampaignInfo }) {
  const api = useLyreApi();
  const write = useWrite();
  const { say } = useAnnounce();
  const focusLater = useFocusLater();

  const move = async (from: number, to: number) => {
    const s = c.sessions[from];
    if (!s || to < 0 || to >= c.sessions.length || from === to) return;
    focusLater(`sm-${s.id}`, to);
    if ((await write(api.sessions.move(c.id, s.id, to))) === undefined) return;
    // Sessions are numbered in their order from the lowest number (session numbers are derived from order).
    const number = Math.min(...c.sessions.map((x) => x.number)) + to;
    say(`${s.name || "That session"} is now Session ${number}, ${to + 1} of ${c.sessions.length}`);
  };
  const drag = useDragReorder("sessions", (from, to) => void move(from, to));

  if (c.sessions.length === 0) return <p className="cp-none">No sessions yet.</p>;
  return (
    <ol className="list cp-slist" aria-label="Sessions in order">
      {c.sessions.map((s, i) => (
        <li key={s.id} className={`lrow cp-srow ${drag.rowClass(i)}`} {...drag.rowProps(i)}>
          <span className="cp-handle" title="Drag to reorder" aria-hidden="true" {...drag.handleProps}>
            <Icon name="drag" size="s" />
          </span>
          <span className="num cp-sn" aria-hidden="true">
            {s.number}
          </span>
          <a className="grow ellipsis cp-sname" href={`#/session/${c.id}/${s.id}`} title={`${sessionLabel(s)} · ${plural(s.scenes.length, "scene")}`}>
            <span className="sr-only">Session {s.number}:</span> {s.name || <span className="faint">No name yet</span>}
          </a>
          <span className="cp-sdate">{formatDate(s.date)}</span>
          <StatusBadge status={s.status} />
          <RunButton campaign={c} session={s} />
          <RowMenu
            label={`More for ${sessionLabel(s)}`}
            k={`sm-${s.id}`}
            items={[
              { label: "Open", icon: "right", onSelect: () => (window.location.hash = `#/session/${c.id}/${s.id}`) },
              ...(i > 0 ? [{ label: "Move up", icon: "chevup" as const, onSelect: () => { void move(i, i - 1); } }] : []),
              ...(i < c.sessions.length - 1 ? [{ label: "Move down", icon: "chevdown" as const, onSelect: () => { void move(i, i + 1); } }] : []),
            ]}
          />
        </li>
      ))}
    </ol>
  );
}

/** Every session can be run; the next one's button is the coloured one, the others grey. */
function RunButton({ campaign, session: s }: { campaign: CampaignInfo; session: SessionInfo }) {
  const next = s.status === "next";
  return (
    <Button
      size="s"
      variant={next ? "primary" : undefined}
      icon="broadcast"
      aria-label={`Run ${sessionLabel(s)}${s.status === "played" ? " again" : ""}`}
      title={next ? "Run the next session" : s.status === "played" ? "Run this session again" : "Run this session"}
      onClick={() => runInLive({ campaignId: campaign.id, sessionId: s.id })}
    >
      Run
    </Button>
  );
}
