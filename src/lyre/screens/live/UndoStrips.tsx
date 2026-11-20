/**
 * Live's one Undo place (round 10, table review M1 and T1; live.js undoSlot): a fixed place in the top bar, beside Find,
 * for every change Undo can take back: a scene started ("Started …"), and the last other change (Play on air, Play
 * next, Add to queue, a removal from Up next, Leave, moving a room, Fade all, Stop all). The place keeps its width
 * whether an Undo shows or not, so nothing under the pointer moves when one appears or goes; nothing is put into a box.
 * Each offer shows a bar running down for 8 seconds; the countdown waits while the pointer or focus is on it, so it
 * never goes from under a press. Ctrl+Z does the same. UX-R6: the offer is a group named Undo, not a live region; the
 * page's live region reads the change out once. Below 1100 px of app the button is an icon, its name and Ctrl+Z kept
 * (Nik, 18 Nov, answer 2 to round 10's questions).
 */
import React, { useEffect, useState } from "react";

import { Icon } from "../../kit/Icon";
import { UNDO_MS } from "./liveModel";
import { getLiveState, updateLive, useLiveState } from "./liveState";
import { focusLive } from "./focus";

/** Runs the offer's countdown: keeps it while it is pointed at or focused, removes it when its time is up. */
function useCountdown(active: boolean, held: boolean): number {
  const [left, setLeft] = useState(100);
  useEffect(() => {
    if (!active) return;
    setLeft(100);
    const timer = setInterval(() => {
      const s = getLiveState();
      const which = s.undo2 ? "undo2" : s.undo ? "undo" : null;
      const offer = which ? s[which] : null;
      if (!which || !offer) return;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.lv === "undo";
      if (held || focused) {
        updateLive({ [which]: { ...offer, until: Math.max(offer.until, Date.now() + 1500) } } as never);
        return;
      }
      if (Date.now() >= offer.until) {
        const focus = which === "undo2" ? s.undo2?.focus : "";
        updateLive({ [which]: null } as never);
        focusLiveIfLost(focus ?? "");
        return;
      }
      setLeft(Math.max(0, Math.min(100, ((offer.until - Date.now()) / UNDO_MS) * 100)));
    }, 250);
    return () => clearInterval(timer);
  }, [active, held]);
  return left;
}

/** The Undo place in Live's top bar: empty, a scene's "Started …", or the last other change, each with Undo. */
export function UndoPlace({ onUndo }: { onUndo: () => boolean }) {
  const { undo, undo2 } = useLiveState();
  const [held, setHeld] = useState(false);
  const offered = !!(undo2 || undo);
  const left = useCountdown(offered, held);
  useEffect(() => {
    if (!offered) setHeld(false);
  }, [offered]);
  const text = undo2 ? (
    <span className="ellipsis grow lv-undo-t" title={undo2.text}>
      {undo2.text}
    </span>
  ) : undo ? (
    <span className="ellipsis grow lv-undo-t" title={`Started ${undo.started}`}>
      Started <b>{undo.started}</b>
    </span>
  ) : null;
  const title = undo2 ? `Undo "${undo2.text}" (Ctrl+Z)` : undo ? `Go back to ${undo.label}, with its music and ambience (Ctrl+Z)` : "";
  return (
    <div className="lv-undoplace">
      {offered && (
        <div className="lv-undo" role="group" aria-label="Undo" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
          {text}
          <button type="button" className="btn s lv-undo-b" data-lv="undo" aria-label="Undo" aria-keyshortcuts="Control+Z" title={title} onClick={onUndo}>
            <Icon name="undo" size="s" />
            <span className="lv-btxt">Undo</span>
          </button>
          <span className="lv-undo-bar" aria-hidden="true">
            <span style={{ width: `${left}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}

/** When the Undo button had focus as its offer ended, focus goes where its change was made instead of to the page. */
function focusLiveIfLost(key: string): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) focusLive(key || "nextsc");
}
