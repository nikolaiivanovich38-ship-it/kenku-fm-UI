/**
 * Pieces the Library and Playlists screens share (the prototype's _shared.js building blocks): Preview and Play on air
 * buttons, a playlist's contents behind an expander, a menu whose items hold more than a line of text, and the
 * plumbing for writes. (The shell says the sound's own messages: shell/SoundMessages.tsx.)
 *
 * Kept in this folder rather than src/lyre/kit so the four wave 3 streams do not add files of the same name there;
 * Campaigns and Pad boards need the same buttons, so the lead may move them to the kit when merging.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isRefused, type WriteResult } from "../../../common/lyre/api";
import { Icon, type IconName } from "../../kit/Icon";
import { cx } from "../../kit/cx";
import { useLyreAudio, useNowPlaying, type NowPlaying } from "../../audio";
import { useAnnounce } from "../../shell/Announcer";
import { fmt } from "./model";

/* ---------- writes and sound messages ---------- */

/** Checks a write's answer: a refusal is shown as a toast in the API's own words. Returns the value, or null. */
export function useWriteResult() {
  const { toast } = useAnnounce();
  return useCallback(
    <T,>(result: WriteResult<T>): T | null => {
      if (isRefused(result)) {
        toast(result.refusal.message);
        return null;
      }
      return result.value as T;
    },
    [toast],
  );
}

/** Checks a write that answers nothing: true when done; a refusal is shown as a toast. */
export function useWriteOk() {
  const { toast } = useAnnounce();
  return useCallback(
    (result: WriteResult<unknown>): boolean => {
      if (isRefused(result)) {
        toast(result.refusal.message);
        return false;
      }
      return true;
    },
    [toast],
  );
}

/* ---------- what plays ---------- */

/** Track ids the players hear now (music, ambience, effects still sounding), in any room. */
export function onAirTrackIds(now: NowPlaying): Set<string> {
  const ids = new Set<string>();
  for (const room of now.rooms) {
    if (room.music) ids.add(room.music.trackId);
    if (room.ambience) ids.add(room.ambience.trackId);
    for (const fx of room.effects) ids.add(fx.trackId);
  }
  return ids;
}
/** Playlists the music or ambience plays through now, in any room. */
export function onAirPlaylistIds(now: NowPlaying): Set<string> {
  const ids = new Set<string>();
  for (const room of now.rooms) {
    if (room.music?.playlistId) ids.add(room.music.playlistId);
    if (room.ambience?.playlistId) ids.add(room.ambience.playlistId);
  }
  return ids;
}
export const previewKey = (kind: "track" | "playlist", id: string): string => (kind === "track" ? id : `pl:${id}`);

/* ---------- buttons ---------- */

export interface SoundButtonProps {
  kind: "track" | "playlist";
  id: string;
  /** The track's or playlist's name, for the button's accessible name. */
  name: string;
  /** -1 keeps a row button out of the Tab order (the Library's list is one Tab stop). */
  tabIndex?: number;
  className?: string;
}

/** Preview (headphones: only you hear it), or Stop preview while it plays (the prototype's L.previewButton). */
export function PreviewButton({ kind, id, name, tabIndex, className }: SoundButtonProps) {
  const audio = useLyreAudio();
  const now = useNowPlaying();
  const on = now.preview?.key === previewKey(kind, id);
  return (
    <button
      type="button"
      className={cx("btn s icon pv", className)}
      tabIndex={tabIndex}
      aria-pressed={on}
      title={on ? "Stop preview" : "Preview in your headphones"}
      aria-label={`${on ? "Stop preview of" : "Preview"} ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        if (kind === "track") audio.previewTrack(id);
        else audio.previewPlaylist(id);
      }}
    >
      <Icon name={on ? "stop" : "headphones"} size="s" />
    </button>
  );
}

/** Play on air (the players hear it), with the prototype's 3-second fade in. */
export function PlayOnAirButton({ kind, id, name, tabIndex, className, empty }: SoundButtonProps & { empty?: boolean }) {
  const audio = useLyreAudio();
  const { toast } = useAnnounce();
  return (
    <button
      type="button"
      className={cx("btn s icon", className)}
      tabIndex={tabIndex}
      title="Play on air (the players hear it)"
      aria-label={`Play on air: ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        if (kind === "track") audio.playTrack(id, { fadeMs: 3000 });
        else if (empty) toast("This playlist has no tracks yet");
        else audio.playPlaylist(id, { fadeMs: 3000 });
      }}
    >
      <Icon name="broadcast" size="s" />
    </button>
  );
}

/* ---------- a playlist's contents ---------- */

export interface ContentsTrack {
  id: string;
  title: string;
  durationMs: number;
}

/** The inside of a playlist's expander: its tracks in order, each with its Audio profile here and Preview. */
export function PlaylistContents({ playlistId, name, dynamic, tracks }: { playlistId: string; name: string; dynamic: boolean; tracks: ContentsTrack[] }) {
  if (!tracks.length) return <p className="hint">No tracks yet{dynamic ? ": no track matches its tags." : "."}</p>;
  return (
    <ol className="list" aria-label={`Tracks in ${name}`}>
      {tracks.map((t, i) => (
        <li key={t.id} className="xp-row">
          <span className="faint num">{i + 1}</span>
          <span className="grow" title={t.title}>
            {t.title}
          </span>
          <span className="num faint">{fmt(t.durationMs)}</span>
          <a
            className="btn s icon ap-link"
            href={`#/profile/${t.id}/pl:${playlistId}`}
            title={`Audio profile: where ${t.title} starts, ends, fades, loops or moves on (in ${name})`}
            aria-label={`Audio profile of ${t.title}`}
          >
            <Icon name="wave" size="s" />
          </a>
          <PreviewButton kind="track" id={t.id} name={t.title} />
        </li>
      ))}
    </ol>
  );
}

/* ---------- menus with rich items ---------- */

export type PopMenuEntry =
  | { content: React.ReactNode; onSelect: () => void; disabled?: boolean; className?: string; key?: string; hidden?: boolean }
  | { separator: true }
  | { group: React.ReactNode };

export interface PopMenuProps {
  label: string;
  items: readonly PopMenuEntry[];
  anchor: React.RefObject<HTMLElement>;
  /** refocus: give focus back to the anchor (after a choice or Escape). */
  onClose: (refocus: boolean) => void;
  /** Something above the items, such as a filter box; it takes focus first. */
  top?: React.ReactNode;
}

/**
 * A menu like the kit's (ui.css .menu, same keys: arrows, Home, End, Escape, Tab), whose items can hold two lines,
 * a count or an icon at the end: Add tracks, New playlist, Add to playlist, and a rule's tag values.
 */
export function PopMenu({ label, items, anchor, onClose, top }: PopMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!menu || !at) return;
    const left = Math.min(Math.max(4, at.left), window.innerWidth - menu.offsetWidth - 4);
    let y = at.bottom + 4;
    if (y + menu.offsetHeight > window.innerHeight - 4) y = Math.max(4, at.top - menu.offsetHeight - 4);
    setPosition({ left, top: y });
    (menu.querySelector<HTMLElement>("input") ?? enabledItems(menu)[0])?.focus();
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor.current?.contains(target)) onCloseRef.current(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = enabledItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current(true);
        break;
      case "Tab":
        onCloseRef.current(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? list.length - 1 : index - 1);
        break;
      case "Home":
        if (index < 0) break;
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        if (index < 0) break;
        event.preventDefault();
        focusAt(list.length - 1);
        break;
    }
  };

  return createPortal(
    <div ref={menuRef} className="menu" role="menu" aria-label={label} style={{ left: position.left, top: position.top, position: "fixed" }} onKeyDown={onKeyDown}>
      {top}
      {items.map((item, index) => {
        if ("separator" in item) return <div key={index} className="sep" role="separator" />;
        if ("group" in item)
          return (
            <div key={index} className="group" role="presentation">
              {item.group}
            </div>
          );
        if (item.hidden) return null;
        return (
          <button
            key={item.key ?? index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.className}
            tabIndex={-1}
            onClick={() => {
              onCloseRef.current(true);
              item.onSelect();
            }}
          >
            {item.content}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function enabledItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')) : [];
}

/** A button that opens a PopMenu; `items` is worked out when the menu opens. */
export function PopMenuButton({
  label,
  className,
  children,
  items,
  top,
  title,
  ariaLabel,
  focusKey,
  tabIndex,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  items: () => readonly PopMenuEntry[];
  top?: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  focusKey?: string;
  tabIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title}
        data-focus={focusKey}
        tabIndex={tabIndex}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {children}
      </button>
      {open && (
        <PopMenu
          label={label}
          items={items()}
          top={top}
          anchor={ref}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus && ref.current && document.contains(ref.current)) ref.current.focus();
          }}
        />
      )}
    </>
  );
}

/** A menu item with an icon, a bold first line and a hint under it (Add tracks, New playlist). */
export function TwoLines({ icon, first, second, bold }: { icon: IconName; first: string; second: string; bold?: boolean }) {
  return (
    <>
      <Icon name={icon} size={bold ? undefined : "s"} />
      <span className="grow">
        {bold ? <b>{first}</b> : <span style={{ display: "block" }}>{first}</span>}
        <span className="hint" style={{ display: "block" }}>
          {second}
        </span>
      </span>
    </>
  );
}

/* ---------- focus after a redraw ---------- */

/** Focus the element with this data-focus key once it is on the page (after the next paint). */
export function focusSoon(key: string, select = false): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-focus="${key.replace(/["\\]/g, "\\$&")}"]`);
    if (!el) return;
    el.focus();
    if (select && el instanceof HTMLInputElement) el.select();
  }, 30);
}
