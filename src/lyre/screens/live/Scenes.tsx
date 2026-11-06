/**
 * The Scenes box (live.js scenes): Next scene (Space), the Undo strip for about 8 seconds after a scene change
 * (Ctrl+Z), and the session's scenes with Now and Next, each with Start or Restart. Scenes always start in the first
 * room. In one column only Now and Next show, with Show all.
 */
import React, { useEffect, useState } from "react";

import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { cx } from "../../kit/cx";
import { useRememberedOpen } from "../../shell/ShellSettings";
import { useLive } from "./liveData";
import { UNDO_MS } from "./liveModel";
import { getLiveState, updateLive } from "./liveState";

/** Where Next scene, Undo and the others are found again after a change (focus). */
export function focusLive(key: string): void {
  const find = () => document.querySelector<HTMLElement>(`[data-lv="${key}"]`);
  const now = find();
  // Not drawn yet (its box was folded): once it is.
  if (now) now.focus({ preventScroll: true });
  else setTimeout(() => find()?.focus({ preventScroll: true }));
}

/** The box's one-line summary, shown only while it is folded (the prototype's collapsed(id) ? … : ""). */
export function useFoldedSummary(id: string, openByDefault: boolean, summary: React.ReactNode): React.ReactNode {
  const [open] = useRememberedOpen(id, openByDefault);
  return open ? undefined : summary;
}

export interface SceneActions {
  start: (index: number) => void;
  next: () => void;
  undo: () => boolean;
}

export function ScenesPane({ compact, actions }: { compact: boolean; actions: SceneActions }) {
  const { session, state, rooms, keys1 } = useLive();
  const scenes = session.scenes;
  const nowAt = state.now;
  const next = scenes[state.standby];
  const short = compact && !state.allScenes && scenes.length > 2;
  const current = scenes[nowAt];
  const standby = nowAt < 0;
  const firstRoom = rooms[0]?.name;
  const summary = useFoldedSummary("lv-scenes", true, [current && `Now: ${current.name}`, next && `Next: ${next.name}`].filter(Boolean).join(" · "));
  return (
    <Pane
      id="lv-scenes"
      title="Scenes"
      icon="scroll"
      kind="scenes"
      size="auto"
      flush
      noMax
      status={standby ? { text: "Ready", tone: "on" } : { text: `Scene ${nowAt + 1} of ${scenes.length}`, tone: "on" }}
      summary={summary}
    >
      <div className="lv-sc-top">
        <button
          type="button"
          className="btn primary lv-nextsc"
          data-lv="nextsc"
          aria-disabled={next ? undefined : "true"}
          aria-keyshortcuts={next && keys1 ? "Space" : undefined}
          title={next ? `Start ${next.name}${keys1 ? " (Space)" : ""}${rooms.length > 1 && firstRoom ? `. Scenes always play in ${firstRoom}` : ""}` : "That was the last scene"}
          onClick={actions.next}
        >
          <Icon name="next" size="s" />
          <span className="ellipsis">{next ? `${standby ? "Start: " : "Next scene: "}${next.name}` : "No more scenes"}</span>
          {next && keys1 && (
            <span className="kbd" aria-hidden="true">
              Space
            </span>
          )}
        </button>
        {state.undo && <UndoStrip onUndo={actions.undo} />}
      </div>
      <ol className="lv-scenes">
        {scenes.map((sc, i) => {
          const isNow = i === nowAt;
          const isNext = i === state.standby;
          if (short && !isNow && !isNext) return null;
          const name = `${isNow ? "Restart" : "Start"} scene ${i + 1}: ${sc.name}`;
          return (
            <li key={sc.id} className={cx("lv-sc", isNow && "now", isNext && "next", nowAt > -1 && i < nowAt && "done")} aria-current={isNow ? "step" : undefined}>
              <div className="lv-sc-1">
                <span className="num lv-sc-n" aria-hidden="true">
                  {i + 1}
                </span>
                {isNow ? <span className="badge lv-nowb">Now</span> : isNext ? <span className="badge lv-nextb">Next</span> : null}
                <span className="lv-sc-name ellipsis" title={sc.name + (sc.startsWhen ? `. Starts when: ${sc.startsWhen}` : "")}>
                  {sc.name}
                </span>
                <button type="button" className="btn s icon lv-sc-go" aria-label={name} title={`${isNow ? "Restart" : "Start"} this scene`} onClick={() => actions.start(i)}>
                  <Icon name={isNow ? "restart" : "play"} size="s" />
                </button>
              </div>
              {(isNow || isNext) && sc.startsWhen && (
                <div className="lv-sc-when ellipsis" title={`Starts when: ${sc.startsWhen}`}>
                  <span className="faint">Starts when</span> {sc.startsWhen}
                </div>
              )}
              {isNow && sc.notes && <Notes text={sc.notes} />}
            </li>
          );
        })}
      </ol>
      {compact && scenes.length > 2 && (
        <button type="button" className="lv-more lv-allsc" aria-expanded={state.allScenes} onClick={() => updateLive({ allScenes: !state.allScenes })}>
          {state.allScenes ? "Show only Now and Next" : `Show all ${scenes.length} scenes`}
        </button>
      )}
    </Pane>
  );
}

function Notes({ text }: { text: string }) {
  const { state } = useLive();
  const open = state.notesOpen;
  return (
    <div className={cx("lv-sc-notes", open && "open")} id="lv-notes">
      <span className="lv-sc-notes-t">{text}</span>
      {text.length > 70 && (
        <button type="button" className="lv-more" aria-expanded={open} aria-controls="lv-notes" onClick={() => updateLive({ notesOpen: !open })}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** The strip's countdown waits while the pointer or focus is on it, so it never goes from under a press. */
function UndoStrip({ onUndo }: { onUndo: () => boolean }) {
  const undo = useLive().state.undo!;
  const [left, setLeft] = useState(100);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      const offer = getLiveState().undo;
      if (!offer) return;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.lv === "undo";
      if (held || focused) {
        updateLive({ undo: { ...offer, until: Math.max(offer.until, Date.now() + 1500) } });
        return;
      }
      if (Date.now() >= offer.until) {
        updateLive({ undo: null });
        return;
      }
      setLeft(Math.max(0, Math.min(100, ((offer.until - Date.now()) / UNDO_MS) * 100)));
    }, 250);
    return () => clearInterval(timer);
  }, [held]);
  return (
    <div className="lv-undo" role="status" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <span className="ellipsis grow">
        Started <b>{undo.started}</b>
      </span>
      <button type="button" className="btn s" data-lv="undo" aria-keyshortcuts="Control+Z" title={`Go back to ${undo.label}, with its music and ambience (Ctrl+Z)`} onClick={onUndo}>
        <Icon name="restart" size="s" />
        <span className="ellipsis">Undo</span>
      </button>
      <span className="lv-undo-bar" aria-hidden="true">
        <span style={{ width: `${left}%` }} />
      </span>
    </div>
  );
}
