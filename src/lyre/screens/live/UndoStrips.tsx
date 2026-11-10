/**
 * Live's Undo strips (live.js lv-undo, undoStrip): about 8 seconds after a scene change in Scenes, and after the last
 * other change where it happened (Add to queue in its room, Kick in On air). Each shows a bar running down; its
 * countdown waits while the pointer or focus is on it, so it never goes from under a press. Ctrl+Z does the same.
 */
import React, { useCallback, useEffect, useState } from "react";

import { Icon } from "../../kit/Icon";
import { UNDO_MS } from "./liveModel";
import { getLiveState, updateLive, useLiveState } from "./liveState";
import { focusLive } from "./focus";

/** Runs one strip's countdown: keeps it while it is pointed at or focused, removes it when its time is up. */
function useCountdown(which: "undo" | "undo2", active: boolean, held: boolean, focusKey: string, onEnd: () => void): number {
  const [left, setLeft] = useState(100);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const offer = getLiveState()[which];
      if (!offer) return;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.lv === focusKey;
      if (held || focused) {
        updateLive({ [which]: { ...offer, until: Math.max(offer.until, Date.now() + 1500) } } as never);
        return;
      }
      if (Date.now() >= offer.until) {
        updateLive({ [which]: null } as never);
        onEnd();
        return;
      }
      setLeft(Math.max(0, Math.min(100, ((offer.until - Date.now()) / UNDO_MS) * 100)));
    }, 250);
    return () => clearInterval(timer);
  }, [active, held, which, focusKey, onEnd]);
  return left;
}

const noop = (): void => undefined;

/** After a scene change, in Scenes under Next scene: "Started …" with Undo (Ctrl+Z). */
export function SceneUndoStrip({ onUndo }: { onUndo: () => boolean }) {
  const undo = useLiveState().undo;
  const [held, setHeld] = useState(false);
  const left = useCountdown("undo", !!undo, held, "undo", noop);
  if (!undo) return null;
  return (
    <div className="lv-undo" role="status" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <span className="ellipsis grow" title={`Started ${undo.started}`}>
        Started <b>{undo.started}</b>
      </span>
      <button type="button" className="btn s" data-lv="undo" aria-keyshortcuts="Control+Z" title={`Go back to ${undo.label}, with its music and ambience (Ctrl+Z)`} onClick={onUndo}>
        <Icon name="undo" size="s" />
        <span className="ellipsis">Undo</span>
      </button>
      <span className="lv-undo-bar" aria-hidden="true">
        <span style={{ width: `${left}%` }} />
      </span>
    </div>
  );
}

/** The last other change, where it happened ("onair", or "room:<id>"): its words with Undo (Ctrl+Z). */
export function SoftUndoStrip({ where, onUndo }: { where: string; onUndo: () => boolean }) {
  const undo2 = useLiveState().undo2;
  const [held, setHeld] = useState(false);
  const mine = undo2?.where === where;
  const focus = undo2 && mine ? undo2.focus : "";
  const onEnd = useCallback(() => focusLiveIfLost(focus), [focus]);
  const left = useCountdown("undo2", mine, held, "undo2", onEnd);
  if (!undo2 || !mine) return null;
  return (
    <div className="lv-undo lv-undo2" role="status" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      <span className="ellipsis grow" title={undo2.text}>
        {undo2.text}
      </span>
      <button type="button" className="btn s" data-lv="undo2" aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)" onClick={onUndo}>
        <Icon name="undo" size="s" />
        <span className="ellipsis">Undo</span>
      </button>
      <span className="lv-undo-bar" aria-hidden="true">
        <span style={{ width: `${left}%` }} />
      </span>
    </div>
  );
}

/** When a strip that had focus goes, focus goes where its change was made instead of to the page. */
function focusLiveIfLost(key: string): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) focusLive(key || "nextsc");
}
