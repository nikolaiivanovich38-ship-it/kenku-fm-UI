/**
 * FND-16 step 5 (0.5.1, design/prototype/ROUND8.md §2): update news, which only the old main window showed until 0.5.1
 * (SEC-14 wants a failure "where Nik will see it"). Lowest in the Saved pop-up's corner:
 *   - an update has downloaded: a standing note, "Lyre has an update. Restart Lyre to use it.", with Restart now and
 *     Dismiss; it stays until dismissed;
 *   - a check or an install failed: the plain message once, as a warning card that says what to do, until dismissed;
 *     the main process marks the first failure since a check worked (`tell`), so a repeat is not shown again.
 * The words are src/main/updateStatus.ts's.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { UpdateState, UpdatesBridge } from "../../common/appUpdates";
import { Icon } from "../kit/Icon";
import { UPDATE_SLOT_ID } from "../shell/Announcer";

/** What the note and the card show: the ready message until dismissed, the failure to tell until dismissed. */
export interface UpdateNewsState {
  ready: string | null;
  failure: string | null;
}

/** The news after the updater's next state. */
export function nextNews(news: UpdateNewsState, state: UpdateState): UpdateNewsState {
  switch (state.kind) {
    case "ready":
      return { ready: state.message, failure: null };
    case "error":
      return state.tell ? { ...news, failure: state.message } : news;
    default:
      return news;
  }
}

/** The failure's reason (bold) and what happens next, split at "It tries again". */
function splitFailure(message: string): [string, string] {
  const at = message.indexOf(" It tries again");
  return at < 0 ? [message, ""] : [message.slice(0, at), message.slice(at + 1)];
}

export function UpdateNews({ bridge = (window as unknown as { lyre?: { updates?: UpdatesBridge } }).lyre?.updates ?? null }: { bridge?: UpdatesBridge | null }) {
  const [news, setNews] = useState<UpdateNewsState>({ ready: null, failure: null });
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(UPDATE_SLOT_ID)), []);
  useEffect(() => {
    if (!bridge) return;
    let current = true;
    const stop = bridge.onChange((state) => current && setNews((was) => nextNews(was, state)));
    // An update that downloaded before the page opened (a reload) is still news; a failure from then has been told.
    bridge.get().then(
      (state) => current && state.kind === "ready" && setNews((was) => nextNews(was, state)),
      (): void => undefined,
    );
    return () => {
      current = false;
      stop();
    };
  }, [bridge]);
  if (!slot || (!news.ready && !news.failure)) return null;
  const [reason, then] = news.failure ? splitFailure(news.failure) : ["", ""];
  return createPortal(
    <>
      {news.failure && (
        <div className="toast t-fail" role="alert">
          <Icon name="warn" size="s" />
          <div className="grow">
            <b>{reason}</b> {then && <span>{then}</span>}
          </div>
          <button type="button" className="closer" aria-label={`Dismiss: ${reason}`} title="Dismiss" onClick={() => setNews((was) => ({ ...was, failure: null }))}>
            <Icon name="close" />
          </button>
        </div>
      )}
      {news.ready && (
        <div className="toast t-stand" role="status">
          <Icon name="restart" size="s" />
          <span className="grow">{news.ready}</span>
          <button type="button" className="btn s primary" onClick={() => bridge?.restart()}>
            Restart now
          </button>
          <button type="button" className="closer" aria-label="Dismiss: Lyre has an update" title="Dismiss" onClick={() => setNews((was) => ({ ...was, ready: null }))}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>,
    slot,
  );
}
