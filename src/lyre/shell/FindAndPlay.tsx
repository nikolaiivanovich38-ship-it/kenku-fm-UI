/**
 * UX-12 Find and play (design round 7, r7shell.js): Ctrl+K on every screen, Live included (the key follows Settings ›
 * Keyboard shortcuts). Type part of a name: tracks, playlists, pads and scenes are found (`library.find`, with Live's
 * session first). Enter plays it on air (a pad fires, a scene starts), Alt+Enter previews it, Shift+Enter adds it to
 * the queue (the bottom of Up next in the first room), Ctrl+Enter opens it; the same four as buttons for the mouse.
 * Esc closes it and focus goes back where it was. The rules (order, keys) are in findModel.ts.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { keyName, shortcutKey } from "../../common/domain";
import { shownTitle } from "../../common/lyre/text";
import { useLyreApi, useSettings, useTracks } from "../api";
import { useLyreAudio } from "../audio";
import { Icon } from "../kit/Icon";
import { useLiveSession } from "../kit/liveSession";
import { PLAY_ON_AIR_FADE_MS } from "../kit/SoundButtons";
import { useAnnounce } from "./Announcer";
import { actionOfKey, canDo, foundItems, moveActive, optionLabel, type FindAction, type FoundItem } from "./findModel";

const KEYS_HELP = "Enter plays it on air. Alt+Enter previews it. Shift+Enter adds it to the queue. Ctrl+Enter opens it. Escape closes.";

/** Always on the page (AppProviders gives it to the shell): it listens for its key and opens the palette. */
export function FindAndPlay() {
  const [open, setOpen] = useState(false);
  const back = useRef<HTMLElement | null>(null);
  const shortcuts = useSettings().data?.shortcuts;
  const key = shortcutKey(shortcuts ?? {}, "palette");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (open || event.defaultPrevented || keyName(event) !== key) return;
      // Not over a dialog (a sheet, the tour); a menu closes by itself when focus leaves it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, key]);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    const was = back.current;
    back.current = null;
    if (refocus && was && document.contains(was)) was.focus({ preventScroll: true });
    else if (refocus) {
      const heading = document.querySelector<HTMLElement>("#view h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    }
  }, []);
  return open ? <Palette onClose={close} /> : null;
}

function Palette({ onClose }: { onClose: (refocus: boolean) => void }) {
  const api = useLyreApi();
  const audio = useLyreAudio();
  const live = useLiveSession();
  const { say, toast } = useAnnounce();
  const tracks = useTracks().data;
  const titles = useMemo(() => new Map((tracks ?? []).map((t) => [t.id, { title: shownTitle(t), kind: t.kind }])), [tracks]);
  const [text, setText] = useState("");
  const [items, setItemsNow] = useState<FoundItem[]>([]);
  const [active, setActiveNow] = useState(0);
  /**
   * The results and the chosen one as they are now, for a key pressed before the screen has drawn them: a key
   * handler of the drawing before would still hold the results of the text before.
   */
  const itemsNow = useRef<FoundItem[]>([]);
  const activeNow = useRef(0);
  const setItems = (list: FoundItem[]) => {
    itemsNow.current = list;
    setItemsNow(list);
  };
  const setActive = (at: number | ((was: number) => number)) => {
    activeNow.current = typeof at === "function" ? at(activeNow.current) : at;
    setActiveNow(activeNow.current);
  };
  /** The text the listed items were found for; a key pressed before the answer to the newest text waits for it. */
  const answered = useRef("");
  const waiting = useRef<FindAction | null>(null);
  /** `run` as drawn last, for an answer that arrives after a key. */
  const runLater = useRef<(action: FindAction, at: number, list: FoundItem[]) => void>(() => undefined);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-o${i}`;

  useEffect(() => {
    field.current?.focus();
    say("Find and play");
  }, [say]);

  // Each answer is for the text typed when it was asked; a later one replaces it.
  useEffect(() => {
    const words = text.trim();
    if (!words) {
      setItems([]);
      answered.current = "";
      return;
    }
    let current = true;
    api.library.find({ text: words, ...(live ? { in: { campaignId: live.campaignId, sessionId: live.sessionId } } : {}) }).then(
      (found) => {
        if (!current) return;
        const list = foundItems(found, (t) => titles.get(t) ?? null);
        setItems(list);
        setActive(0);
        answered.current = words;
        const action = waiting.current;
        waiting.current = null;
        if (action) runLater.current(action, 0, list);
      },
      (): void => undefined,
    );
    return () => {
      current = false;
    };
  }, [api, text, titles, live]);

  function run(action: FindAction, at = activeNow.current, list = itemsNow.current) {
    const item = list[at];
    if (!item || !canDo(item, action)) return;
    onClose(action !== "open");
    if (action === "open") {
      window.location.hash = item.playlistId
        ? `#/playlist/${item.playlistId}`
        : item.pad
          ? `#/board/${item.pad.boardId}`
          : item.scene
            ? `#/session/${item.scene.campaignId}/${item.scene.sessionId}`
            : `#/library/${item.trackId}`;
      return;
    }
    if (action === "preview") {
      if (item.trackId) audio.previewTrack(item.trackId);
      else if (item.playlistId) audio.previewPlaylist(item.playlistId);
      else if (item.pad) audio.previewPad(item.pad.boardId, item.pad.padId);
      return;
    }
    if (action === "queue") {
      if (item.trackId) audio.addToQueue({ kind: "track", trackId: item.trackId });
      else if (item.playlistId) audio.addToQueue({ kind: "playlist", playlistId: item.playlistId, place: item.place ?? null });
      return;
    }
    if (item.trackId) audio.playTrack(item.trackId, { fadeMs: PLAY_ON_AIR_FADE_MS });
    else if (item.playlistId) audio.playPlaylist(item.playlistId, item.place ? { fadeMs: PLAY_ON_AIR_FADE_MS, place: item.place } : { fadeMs: PLAY_ON_AIR_FADE_MS });
    else if (item.pad) {
      audio.firePad(item.pad.boardId, item.pad.padId);
      toast(`Pad on air: ${item.name}`);
    } else if (item.scene) {
      audio.startScene(item.scene);
      toast(`Scene on air: ${item.name}`);
    }
  }

  runLater.current = run;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) return;
      event.preventDefault();
      setActive((a) => moveActive(a, items.length, event.key as "ArrowDown" | "ArrowUp"));
      return;
    }
    const action = event.target === field.current ? actionOfKey(event) : null;
    if (action) {
      event.preventDefault();
      // Typed fast and pressed at once: the answer for what is typed now is still on its way. The field itself says
      // what is typed (the screen may not have drawn the newest text yet).
      if (answered.current !== (field.current?.value ?? text).trim()) waiting.current = action;
      else run(action);
      return;
    }
    if (event.key === "Tab") {
      // Focus stays in the palette while it is open.
      const all = Array.from(box.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? []);
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    // Keys typed here are the palette's, not the screen's (Live's single-key shortcuts).
    event.stopPropagation();
  };

  const chosen = items[active];
  return (
    <div
      className="pal-wrap"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose(true);
      }}
    >
      <div className="pal" role="dialog" aria-modal="true" aria-label="Find and play" aria-describedby={`${id}-keys`} ref={box} onKeyDown={onKeyDown}>
        <div className="search pal-search">
          <Icon name="search" />
          <input
            ref={field}
            className="input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={items.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={items.length ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            aria-label="Type a track, playlist, pad or scene"
            placeholder="Type a track, playlist, pad or scene"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <ul id={`${id}-list`} className="pal-list" role="listbox" aria-label="Found" hidden={items.length === 0}>
          {items.map((item, i) => (
            <li
              key={item.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-label={optionLabel(item)}
              ref={i === active ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
              onClick={() => run("air", i)}
            >
              <span className="pal-k">{item.kind}</span>
              <span className="ellipsis grow" title={item.name}>
                {item.name}
              </span>
              {item.sub && <span className="faint ellipsis">{item.sub}</span>}
            </li>
          ))}
        </ul>
        <p className="faint pal-none" role="status">
          {text.trim() && items.length === 0 ? "Nothing is called that" : ""}
        </p>
        {chosen && (
          <div className="pal-acts">
            <button type="button" className="btn s primary" onClick={() => run("air")}>
              <Icon name="broadcast" size="s" />
              Play on air
            </button>
            <button type="button" className="btn s" disabled={!canDo(chosen, "preview")} onClick={() => run("preview")}>
              <Icon name="headphones" size="s" />
              Preview
            </button>
            <button type="button" className="btn s" disabled={!canDo(chosen, "queue")} onClick={() => run("queue")}>
              <Icon name="queue" size="s" />
              Add to queue
            </button>
            <button type="button" className="btn s ghost" onClick={() => run("open")}>
              <Icon name="chevright" size="s" />
              Open
            </button>
          </div>
        )}
        <p className="sr-only" id={`${id}-keys`}>
          {KEYS_HELP}
        </p>
      </div>
    </div>
  );
}
