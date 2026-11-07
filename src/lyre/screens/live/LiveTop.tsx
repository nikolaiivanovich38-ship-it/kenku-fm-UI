/**
 * Live's top strip (live.js top, keysPop): Prep | Live, the session loaded (a menu of every session; F2 or Rename
 * session renames it in place, BUG-21), a warning
 * with one-click Join when no bot is in a voice channel, Fade all (Shift+Esc), Stop all, and Keys: the list of the
 * screen's keys with the switch for single-key shortcuts (WCAG 2.1.4).
 */
import React, { useEffect, useRef } from "react";

import { useLyreApi } from "../../api";
import { Icon } from "../../kit/Icon";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { RenameField, renameKeys, useRenameInPlace } from "../../kit/RenameInPlace";
import { useAnnounce } from "../../shell/Announcer";
import { TopLead } from "../../shell/TopBar";
import { useOpenHelp } from "../../help/useHelp";
import { sessionLabel } from "../campaigns/model";
import { useWrite } from "../campaigns/parts";
import { useLive } from "./liveData";
import { busiestChannel, currentBoard, padKeys } from "./liveModel";

export interface TopProps {
  keysOpen: boolean;
  setKeysOpen: (open: boolean, refocus: boolean) => void;
  setKeys1: (on: boolean) => void;
  loadSession: (campaignId: string, sessionId: string) => void;
}

const STATUS_WORDS = { next: "next", played: "played", draft: "draft" } as const;

export function LiveTop({ keysOpen, setKeysOpen, setKeys1, loadSession }: TopProps) {
  const live = useLive();
  const { campaign, session, campaigns, audio, rooms, outputs, client, keys1 } = live;
  const { toast, say } = useAnnounce();
  const api = useLyreApi();
  const write = useWrite();
  const rename = useRenameInPlace();
  const renameSession = async (name: string) => {
    if ((await write(api.sessions.update(campaign.id, session.id, { name }))) !== undefined) say(`Session ${session.number} is now called ${name}`);
  };

  const sessions = (): PopMenuEntry[] => [
    {
      key: "rename",
      content: (
        <>
          <Icon name="edit" size="s" />
          <span className="grow">Rename session</span>
        </>
      ),
      onSelect: () => rename.start(document.querySelector<HTMLElement>('[data-k="lv-sess"]')),
    },
    { separator: true },
    ...campaigns.flatMap((c): PopMenuEntry[] => [
      { group: c.name },
      ...c.sessions.map((s): PopMenuEntry => {
        const here = c.id === campaign.id && s.id === session.id;
        return {
          key: `${c.id}/${s.id}`,
          role: "menuitemradio",
          checked: here,
          content: (
            <>
              {here ? <Icon name="check" size="s" /> : <span className="lv-mi-gap" />}
              <span className="grow ellipsis">{sessionLabel(s)}</span> <span className="faint">{STATUS_WORDS[s.status]}</span>
            </>
          ),
          onSelect: () => loadSession(c.id, s.id),
        };
      }),
    ]),
  ];

  const joining = outputs?.bots.some((b) => b.room?.status === "joining") ?? false;
  const fixBot = outputs?.bots.find((b) => b.login === "ready" && !b.room);
  const best = busiestChannel(outputs);

  return (
    <div className="lv-top">
      <TopLead />
      <h1 className="sr-only">Live</h1>
      <div className="seg mode-switch" role="group" aria-label="Prep or live">
        <button type="button" aria-pressed="false" onClick={() => (window.location.hash = `#/session/${campaign.id}/${session.id}`)}>
          <Icon name="edit" size="s" />
          Prep
        </button>
        <button type="button" aria-pressed="true">
          <Icon name="broadcast" size="s" />
          Live
        </button>
      </div>
      {rename.editing ? (
        <span className="lv-sess lv-sess-edit">
          <Icon name="crown" size="s" />
          <span className="lv-sess-c">{campaign.name}</span>{" "}
          <span className="lv-sess-sep" aria-hidden="true">
            ›
          </span>{" "}
          <span className="lv-sess-s">Session {session.number}:</span>
          <RenameField className="input lv-sess-rename" value={session.name} label={`Name of Session ${session.number}`} placeholder="No name yet" onSave={(name) => void renameSession(name)} onDone={rename.done} />
        </span>
      ) : (
        <PopMenuButton
          label="Load a session"
          className="lv-sess"
          dataK="lv-sess"
          title={`Loaded: ${campaign.name} › ${sessionLabel(session)}. Choose another session, or press F2 to rename it`}
          items={sessions}
          onKeyDown={renameKeys(rename.start)}
        >
          <Icon name="crown" size="s" />
          <span className="lv-sess-c">{campaign.name}</span>{" "}
          <span className="lv-sess-sep" aria-hidden="true">
            ›
          </span>{" "}
          <span className="lv-sess-s">{sessionLabel(session)}</span>
          <Icon name="chevdown" size="s" />
        </PopMenuButton>
      )}
      {rooms.length === 0 && (
        <>
          <span className="lv-warn" role="status" title="Players hear nothing: no bot is in a voice channel">
            <Icon name="broadcast" size="s" />
            <span className="lv-warn-t">{joining ? "Joining…" : "No room: players hear nothing"}</span>
          </span>
          {client && fixBot && best && !joining && (
            <button
              type="button"
              className="btn s lv-fix"
              title={`${fixBot.name} joins ${best.serverName} › ${best.name} (${best.people} there)`}
              onClick={() => {
                client.move(fixBot.id, best.channelId);
                toast(`${fixBot.name} is joining ${best.name}`);
              }}
            >
              Join {best.name}
            </button>
          )}
        </>
      )}
      <span className="grow" />
      <button type="button" className="btn s lv-fade" aria-label="Fade all" aria-keyshortcuts="Shift+Escape" title="Fade everything out over 3 seconds (Shift+Esc)" onClick={() => audio.fadeAll()}>
        <Icon name="fade" size="s" />
        <span className="lv-btxt">Fade all</span>
      </button>
      <button type="button" className="btn s danger lv-stop" aria-label="Stop all" title="Stop everything at once" onClick={() => audio.stopAll()}>
        <Icon name="stop" size="s" />
        <span className="lv-btxt">Stop all</span>
      </button>
      <span className="lv-keyswrap">
        <button
          type="button"
          className="btn s"
          data-lv="keys"
          aria-expanded={keysOpen}
          aria-controls={keysOpen ? "lv-keys-pop" : undefined}
          title="Keyboard keys for the live screen"
          onClick={() => setKeysOpen(!keysOpen, false)}
        >
          Keys
          <Icon name={keysOpen ? "chevup" : "chevdown"} size="s" />
        </button>
        {keysOpen && <KeysPop setKeysOpen={setKeysOpen} setKeys1={setKeys1} keys1={keys1} />}
      </span>
    </div>
  );
}

/** A disclosure, not a menu: a switch and a list. A press outside closes it. */
function KeysPop({ setKeysOpen, setKeys1, keys1 }: { setKeysOpen: TopProps["setKeysOpen"]; setKeys1: TopProps["setKeys1"]; keys1: boolean }) {
  const { state, scene, index } = useLive();
  const ref = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLInputElement>(null);
  const openHelp = useOpenHelp();
  const board = currentBoard(state.board, scene, index);
  const keys = padKeys(board).join(" ") || "none";
  useEffect(() => {
    switchRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(".lv-keyswrap")) setKeysOpen(false, false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [setKeysOpen]);
  const row = (key: string, what: string, single: boolean) => (
    <li className={single && !keys1 ? "lv-off" : undefined}>
      <span className="kbd">{key}</span>
      <span>{what}</span>
    </li>
  );
  return (
    <div className="lv-pop" id="lv-keys-pop" role="group" aria-label="Keys on the live screen" ref={ref}>
      <label className="lv-switch">
        <input ref={switchRef} type="checkbox" role="switch" checked={keys1} onChange={(event) => setKeys1(event.target.checked)} />
        <span className="lv-switch-t">
          <b>Single-key shortcuts</b>
          <span className="hint">Space, / and the pad keys.</span>
        </span>
      </label>
      <ul className="lv-keylist">
        {row("Space", "Start the next scene", true)}
        {row("/", "Search Off script", true)}
        {row(keys, `Pads on ${board?.name ?? "the board"}`, true)}
        {row("Shift+Esc", "Fade everything out (3 s)", false)}
        {row("Ctrl+Z", "Undo the last scene change (for 8 s)", false)}
        {row("Esc", "Close a menu or clear the search", false)}
      </ul>
      <p className="hint">{keys1 ? "Keys do nothing while you type in a box." : "Single-key shortcuts are off. Shift+Esc and Ctrl+Z still work."}</p>
      {/* R6 review Should 12: what left Live's screen is in Help (F1 opens it anywhere). */}
      {openHelp && (
        <button type="button" className="btn s ghost lv-keys-help" aria-keyshortcuts="F1" onClick={openHelp}>
          <Icon name="help" size="s" />
          Help
        </button>
      )}
    </div>
  );
}
