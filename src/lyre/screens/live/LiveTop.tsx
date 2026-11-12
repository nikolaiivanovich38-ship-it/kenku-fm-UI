/**
 * Live's top strip (live.js top, keysPop): Back and the trail (UX-18), the session loaded (a menu of every session; F2
 * or Rename session renames it in place, BUG-21), Prep | Live, Find a track or playlist (/), Fade all (Shift+Esc),
 * Stop all, and Keys: the list of the screen's keys, as Settings › Keyboard shortcuts has them (UX-12), with the switch
 * for single-key shortcuts (WCAG 2.1.4). Round 6 part 6: the warning that nobody hears anything is in On air.
 */
import React, { useEffect, useRef } from "react";

import { useLyreApi } from "../../api";
import { DEFAULT_FADES_MS } from "../../audio/lyreAudio";
import { Icon } from "../../kit/Icon";
import { PopMenuButton, type PopMenuEntry } from "../../kit/PopMenu";
import { RenameField, renameKeys, useRenameInPlace } from "../../kit/RenameInPlace";
import { useAnnounce } from "../../shell/Announcer";
import { TopLead } from "../../shell/TopBar";
import { useOpenHelp } from "../../help/useHelp";
import { sessionLabel } from "../campaigns/model";
import { useWrite } from "../campaigns/parts";
import { ariaKey } from "./Scenes";
import { useLive } from "./liveData";
import { currentBoard, isSingleKey, LIVE_BOXES, padKeys } from "./liveModel";
import { touched } from "./liveState";
import { Find } from "./Find";

export interface TopProps {
  keysOpen: boolean;
  setKeysOpen: (open: boolean, refocus: boolean) => void;
  setKeys1: (on: boolean) => void;
  loadSession: (campaignId: string, sessionId: string) => void;
}

/**
 * Go to another screen at once: the browser tells the shell of a new address only after the click is over, so for that
 * moment Live would still answer for the planner's controls (Prep and the planner both have "Scene 3: …").
 */
function goNow(hash: string): void {
  const oldURL = window.location.href;
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }));
}

const STATUS_WORDS = { next: "next", played: "played", draft: "draft" } as const;

export function LiveTop({ keysOpen, setKeysOpen, setKeys1, loadSession }: TopProps) {
  const live = useLive();
  const { campaign, session, campaigns, audio, keys1 } = live;
  const { say } = useAnnounce();
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

  return (
    <div className="lv-top">
      {/* Round 6 part 6: the trail is the campaign (a link to its page), then the session (its button, below). */}
      <TopLead trail={[{ href: `#/campaign/${campaign.id}`, label: campaign.name }]} />
      <h1 className="sr-only">Live</h1>
      {rename.editing ? (
        <span className="lv-sess lv-sess-edit">
          <Icon name="crown" size="s" />
          <span className="sr-only">{campaign.name}</span>{" "}
          <span className="lv-sess-s">Session {session.number}:</span>
          <RenameField className="input lv-sess-rename" value={session.name} label={`Name of Session ${session.number}`} placeholder="No name yet" onSave={(name) => void renameSession(name)} onDone={rename.done} />
        </span>
      ) : (
        <PopMenuButton
          label="Load a session"
          className="lv-sess"
          dataK="lv-sess"
          ariaLabel={`${campaign.name} Session ${session.number}: ${session.name}`}
          title={`Loaded: ${campaign.name} › ${sessionLabel(session)}. Choose another session, or press F2 to rename it`}
          items={sessions}
          onKeyDown={renameKeys(rename.start)}
        >
          {/* Round 6 part 6: the session is the trail's last part (the trail shows the campaign), so only its number
              shows; the campaign and the session's name are read out and on hover. */}
          <Icon name="crown" size="s" />
          <span className="sr-only">{campaign.name}</span>{" "}
          <span className="lv-sess-s">
            Session {session.number}
            <span className="sr-only">: {session.name}</span>
          </span>
          <Icon name="chevdown" size="s" />
        </PopMenuButton>
      )}
      <div className="seg mode-switch" role="group" aria-label="Prep or live">
        <button type="button" aria-pressed="false" onClick={() => goNow(`#/session/${campaign.id}/${session.id}`)}>
          <Icon name="edit" size="s" />
          Prep
        </button>
        <button type="button" aria-pressed="true">
          <Icon name="broadcast" size="s" />
          Live
        </button>
      </div>
      <Find />
      <button
        type="button"
        className="btn s lv-fade"
        aria-label="Fade all"
        aria-keyshortcuts={ariaKey(live.keys.fadeAll)}
        title={`Fade all: everything fades out over ${DEFAULT_FADES_MS.fadeAll / 1000} seconds (${live.keys.fadeAll})`}
        onClick={() => {
          touched();
          audio.fadeAll();
        }}
      >
        <Icon name="fade" size="s" />
        <span className="lv-btxt">Fade all</span>
      </button>
      <button
        type="button"
        className="btn s danger lv-stop"
        aria-label="Stop all"
        title="Stop everything at once"
        onClick={() => {
          touched();
          audio.stopAll();
        }}
      >
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
  const { state, scene, index, keys } = useLive();
  const switchRef = useRef<HTMLInputElement>(null);
  const openHelp = useOpenHelp();
  const board = currentBoard(state.boards.sc, scene, index);
  const padList = padKeys(board).join(" ") || "none";
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
    <div className="lv-pop" id="lv-keys-pop" role="group" aria-label="Keys on the live screen">
      <label className="lv-switch">
        <input ref={switchRef} type="checkbox" role="switch" checked={keys1} onChange={(event) => setKeys1(event.target.checked)} />
        <span className="lv-switch-t">
          <b>Single-key shortcuts</b>
          <span className="hint">Space, / and the pad keys. Turn off if they get in the way.</span>
        </span>
      </label>
      <ul className="lv-keylist">
        {row(keys.nextScene, "Start the next scene", isSingleKey(keys.nextScene))}
        {row(keys.find, "Find a track or playlist", isSingleKey(keys.find))}
        {/* UX-R15: Find and play works in Live too. */}
        {row(keys.palette, "Find and play anything", false)}
        {row(padList, board ? `Pads on ${board.name} (Current scene)` : "Pads of the current scene", true)}
        {row("Alt+1…7", `Go to a box: ${LIVE_BOXES.map((b) => b.name).join(", ")}`, false)}
        {row("F6", "Next box (Shift+F6: the one before)", false)}
        {row(keys.fadeAll, `Fade all (${DEFAULT_FADES_MS.fadeAll / 1000} s)`, false)}
        {row(keys.undo, "Undo the last change (for 8 s)", false)}
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
