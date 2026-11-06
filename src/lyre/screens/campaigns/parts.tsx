/**
 * Pieces the Campaigns, Campaign and Session screens share: the library they read, Preview and Play on air buttons,
 * what is inside a playlist or pad board, the ⋯ row menu, the Prep or Live switch, fields that save as you type,
 * and moving focus to a control once the library has redrawn the screen.
 * (The prototype's _shared.js building blocks and the helpers at the top of views/campaigns.js.)
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { parseKeyOfPlace, placeKey, type PadMode, type ProfilePlace } from "../../../common/domain";
import { isRefused, type CampaignInfo, type Done, type PadBoard, type PlaylistInfo, type WriteResult } from "../../../common/lyre/api";
import { useBoards, usePlaylists, useProfileOverrides, useTagGroups, useTracks } from "../../api";
import { TagStrip } from "../../kit/TagStrip";
import { ownNameTitle, trackNameAt, useTrackNames } from "../../kit/trackName";
import { Icon, ICON_NAMES, type IconName } from "../../kit/Icon";
import { useLiveSession, runInLive } from "../../kit/liveSession";
import { ProfileLink } from "../../kit/ProfileLink";
import { PreviewButton } from "../../kit/SoundButtons";
import { Menu, type MenuEntry } from "../../kit/Menu";
import { useAnnounce } from "../../shell/Announcer";
import { boardPads, formatLength, libraryIndex, sessionForLive, STATUS_WORDS, type LibraryIndex } from "./model";
import type { SessionStatus } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";

/* ---------- data ---------- */

/** The library the screens show, once tracks, playlists and boards have all loaded (undefined until then). */
export function useLibraryIndex(): LibraryIndex | undefined {
  const tracks = useTracks().data;
  const playlists = usePlaylists().data;
  const boards = useBoards().data;
  return useMemo(() => (tracks && playlists && boards ? libraryIndex(tracks, playlists, boards) : undefined), [tracks, playlists, boards]);
}

/** Whether a track has its own audio settings in a place (the scene's "Own audio settings" mark). */
export function useOwnSettings(): (trackId: string, place: ProfilePlace) => boolean {
  const overrides = useProfileOverrides().data;
  return useCallback((trackId, place) => !!overrides?.[placeKey(place)]?.[trackId], [overrides]);
}

/**
 * Runs a write; a refusal is shown in its own plain words. Resolves to what was done, or undefined when refused.
 * The screen redraws from the "changed" event that follows every write.
 */
export function useWrite() {
  const { toast } = useAnnounce();
  return useCallback(
    async <T,>(write: Promise<WriteResult<T>>): Promise<Done<T> | undefined> => {
      const result = await write;
      if (isRefused(result)) {
        toast(result.refusal.message);
        return undefined;
      }
      return result;
    },
    [toast],
  );
}

/**
 * Focus a control once it is on the screen (after the library answers and the screen redraws), the way the
 * prototype's focusK works. Controls are found by their data-k. `atIndex`: wait until the control's row (data-idx)
 * is at that place, for a row that is being moved (moving a row in the page takes focus from it). `select`: select
 * a text field's text, so typing replaces it.
 */
export function useFocusLater(): (key: string, atIndex?: number, select?: boolean) => void {
  const pending = useRef<{ key: string; atIndex?: number; select?: boolean; until: number } | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    const element = document.querySelector<HTMLElement>(`#view [data-k="${CSS.escape(want.key)}"]`);
    const row = element?.closest<HTMLElement>("[data-idx]");
    if (element && (want.atIndex === undefined || row?.dataset.idx === String(want.atIndex))) {
      pending.current = null;
      element.focus();
      if (want.select && element instanceof HTMLInputElement) element.select();
    } else if (Date.now() > want.until) {
      pending.current = null;
    }
  });
  return useCallback((key: string, atIndex?: number, select?: boolean) => {
    pending.current = { key, atIndex, select, until: Date.now() + 3000 };
    redraw((n) => n + 1);
  }, []);
}

/* ---------- what is inside a playlist or board ---------- */

const PAD_COLOURS: Record<string, string> = {
  steel: "#8fb3d9",
  ember: "#f08a52",
  gold: "#e8bd62",
  moss: "#7fcf8f",
  violet: "#b69cff",
  plum: "#d394e0",
  sea: "#5fd4c0",
  bone: "#d9cfb8",
};
const MODE_WORDS: Record<PadMode, string> = { oneshot: "One-shot", toggle: "Toggle loop", hold: "Hold to play", retrigger: "Restart on press" };
const padIcon = (name: string): IconName => ((ICON_NAMES as string[]).includes(name) ? (name as IconName) : "star");

/**
 * A playlist's tracks (with Preview and a link to each track's audio profile in `place`) or a board's pads (with
 * Preview), shown under an open expander. `place` null: no profile links (pickers). In a scene or a session list
 * ("sc:…", "ss:…") each track shows its tags (ORG-11), its name in the scene (DAT-14) and the wave button to its
 * waveform, end and fades there (PLY-14).
 */
export function Contents({
  item,
  index,
  place,
  placeName,
}: {
  item: { kind: "playlist"; playlist: PlaylistInfo } | { kind: "board"; board: PadBoard };
  index: LibraryIndex;
  place?: string | null;
  /** The place in words for the link's hover text ("the scene Greyhollow inn"); the playlist's by default. */
  placeName?: string;
}) {
  if (item.kind === "playlist") {
    const p = item.playlist;
    const tracks = index.tracksOf(p);
    if (tracks.length === 0) return <p className="hint">No tracks yet{p.kind === "dynamic" ? ": no track matches its tags." : "."}</p>;
    const key = place === undefined ? `pl:${p.id}` : place;
    const where = key ? parseKeyOfPlace(key) : null;
    if (where && key && (where.kind === "scene" || where.kind === "session")) return <PlaceTracks name={p.name} playlistId={p.id} tracks={tracks} placeKey={key} />;
    return (
      <ol className="list" aria-label={`Tracks in ${p.name}`}>
        {tracks.map((t, i) => {
          const title = shownTitle(t);
          return (
            <li key={t.id} className="xp-row">
              <span className="faint num">{i + 1}</span>
              <span className="grow" title={title}>
                {title}
              </span>
              <span className="num faint">{formatLength(t.durationMs)}</span>
              {key !== null && <ProfileLink trackId={t.id} title={title} place={key} placeName={placeName ?? `the playlist ${p.name}`} iconOnly />}
              <PreviewButton target={{ kind: "track", id: t.id }} name={title} />
            </li>
          );
        })}
      </ol>
    );
  }
  const b = item.board;
  const pads = boardPads(b);
  return (
    <>
      <p className="hint">
        {b.cols} × {b.rows} grid, {pads.length} pads{b.spare.length ? `, ${b.spare.length} spare` : ""}
      </p>
      <ul className="list" aria-label={`Pads on ${b.name}`}>
        {pads.map((pad) => (
          <li key={pad.id} className="xp-row">
            <span className="lane-dot" style={{ background: PAD_COLOURS[pad.color] ?? "var(--fx)" }} aria-hidden="true" />
            <Icon name={padIcon(pad.icon)} size="s" />
            <span className="grow">{pad.label}</span>
            {pad.key && <span className="kbd">{pad.key.toUpperCase()}</span>}
            <span className="hint">{MODE_WORDS[pad.mode]}</span>
            <PreviewButton target={{ kind: "pad", boardId: b.id, padId: pad.id }} name={pad.label} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** A playlist's tracks in a scene or a session list (views/_shared.js contentsHTML with a scene's or session's key). */
function PlaceTracks({ name, playlistId, tracks, placeKey: key }: { name: string; playlistId: string; tracks: ReturnType<LibraryIndex["tracksOf"]>; placeKey: string }) {
  const groups = useTagGroups().data ?? [];
  const names = useTrackNames();
  const place = parseKeyOfPlace(key);
  const where = place?.kind === "scene" ? "scene" : "session";
  return (
    <ol className="list" aria-label={`Tracks in ${name}`}>
      {tracks.map((t, i) => {
        const n = trackNameAt(t, place, names);
        return (
          <li key={t.id} className="xp-row">
            <span className="faint num">{i + 1}</span>
            <span className="grow ellipsis" title={ownNameTitle(n)}>
              {n.name}
            </span>
            <TagStrip track={t} groups={groups} />
            <span className="num faint">{formatLength(t.durationMs)}</span>
            <a
              className="btn s icon cp-prof"
              href={`#/profile/${t.id}/${key}`}
              title={`Waveform, end and fades of ${n.name} in this ${where}`}
              aria-label={`Waveform, end and fades in this ${where}: ${n.name}`}
            >
              <Icon name="wave" size="s" />
            </a>
            <PreviewButton target={{ kind: "track", id: t.id, playlistId }} name={n.name} />
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- menus, switches and badges ---------- */

/** The ⋯ button of a row (a quiet 24 px square) and its menu. `k` lets the screen give focus back to it. */
export function RowMenu({ label, items, k, title }: { label: string; items: readonly MenuEntry[]; k: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="closer cp-more-btn"
        data-k={k}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && <Menu id={menuId} label={label} items={items} anchor={button} onClose={close} />}
    </>
  );
}

/**
 * Prep | Live for this campaign (the prototype's L.modeSwitch): Prep is pressed on these screens; Live loads the
 * session shown (on a session page), else this campaign's session already in Live, else its next one, and opens Live.
 */
export function ModeSwitch({ campaign, sessionId }: { campaign: CampaignInfo; sessionId?: string }) {
  const live = useLiveSession();
  const goLive = () => {
    const sid = sessionId ?? (live?.campaignId === campaign.id ? live.sessionId : sessionForLive(campaign)?.id);
    if (sid) runInLive({ campaignId: campaign.id, sessionId: sid });
  };
  return (
    <div className="seg mode-switch" role="group" aria-label="Prep or live">
      <button type="button" aria-pressed="true">
        <Icon name="edit" size="s" />
        Prep
      </button>
      <button type="button" aria-pressed="false" onClick={goLive}>
        <Icon name="broadcast" size="s" />
        Live
      </button>
    </div>
  );
}

/** Played, Next or Draft: always in words; the colour only adds to them. */
export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={`cp-status ${status}`}>
      {status === "played" && <Icon name="check" size="s" />}
      {STATUS_WORDS[status]}
    </span>
  );
}

/* ---------- fields that save as you type ---------- */

/** How long typing rests before the field is saved (one undo step per pause, not per letter). */
const SAVE_AFTER_MS = 300;

type DraftProps = {
  value: string;
  /** Saves the text (a LyreApi write); called after a pause in typing, on leaving the field and when it goes away. */
  onSave: (value: string) => void;
  /** Called on every change, before saving (to show the new text elsewhere at once). */
  onDraft?: (value: string) => void;
  multiline?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue">;

/**
 * A text field or text area that keeps what is typed while the library saves it, so a reload never moves the
 * cursor. It takes the library's value again when it is not being edited.
 */
export const DraftField = React.forwardRef<HTMLInputElement & HTMLTextAreaElement, DraftProps>(function DraftField(
  { value, onSave, onDraft, multiline, onBlur, ...rest },
  ref,
) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const unsaved = useRef<string | null>(null);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (unsaved.current !== null) {
      const text = unsaved.current;
      unsaved.current = null;
      save.current(text);
    }
  }, []);
  useEffect(() => {
    if (!editing.current && unsaved.current === null) setDraft(value);
  }, [value]);
  useEffect(() => flush, [flush]);

  const props = {
    ...rest,
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      editing.current = true;
      setDraft(event.target.value);
      onDraft?.(event.target.value);
      unsaved.current = event.target.value;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      editing.current = false;
      flush();
      onBlur?.(event);
    },
  };
  return multiline ? <textarea ref={ref} {...props} /> : <input ref={ref} {...props} />;
});

/* ---------- Obsidian placeholders ---------- */

const OBSIDIAN_REASON = "Lyre will open these notes in a later version.";

/** "Open in Obsidian", greyed out with its reason (nothing connects yet). */
export function ObsidianButton({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="cp-obs-btn">
      <button type="button" className="btn s" disabled aria-describedby={`${idPrefix}why`}>
        <Icon name="link" size="s" />
        Open in Obsidian
      </button>
      <span className="hint" id={`${idPrefix}why`}>
        Not working yet: {OBSIDIAN_REASON}
      </span>
    </div>
  );
}

export interface ObsidianValues {
  vault: string;
  note: string;
  sessionsFolder: string;
}

/** Vault, campaign note and session notes folder: kept for a later version. */
export function ObsidianFields({ idPrefix, values, onChange }: { idPrefix: string; values: ObsidianValues; onChange: (field: keyof ObsidianValues, value: string) => void }) {
  const field = (key: keyof ObsidianValues, label: string, placeholder: string) => (
    <div className="field">
      <label htmlFor={`${idPrefix}${key}`}>{label}</label>
      <DraftField
        className="input"
        id={`${idPrefix}${key}`}
        data-k={`${idPrefix}${key}`}
        value={values[key]}
        placeholder={placeholder}
        autoComplete="off"
        onSave={(value) => onChange(key, value)}
      />
    </div>
  );
  return (
    <>
      <div className="cp-obs-grid">
        {field("vault", "Vault", "Name of your Obsidian vault")}
        {field("note", "Campaign note", "e.g. Campaigns/The Sunken Crown/Overview.md")}
        {field("sessionsFolder", "Session notes folder", "e.g. Campaigns/The Sunken Crown/Sessions")}
      </div>
      <ObsidianButton idPrefix={idPrefix} />
    </>
  );
}

/**
 * While the library answers, a screen shows no heading yet: the page (and the acceptance tests, which wait for the
 * heading) then finds the screen whole, with every control in place, when its heading appears.
 */
export function Opening() {
  return (
    <div className="viewhead" aria-busy="true">
      <span className="muted">Opening…</span>
    </div>
  );
}

/**
 * The shell moves focus to a new screen's heading when the address changes; a screen that was still opening then had
 * none. Once it is ready, its heading takes the focus if nothing else has it.
 */
export function useHeadingFocusWhenReady(): void {
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const heading = document.querySelector<HTMLElement>("#view h1");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, []);
}

/** A screen whose campaign or session is gone (an old link, or deleted in another window). */
export function NotFound({ what }: { what: string }) {
  return (
    <>
      <div className="viewhead">
        <h1>{what} not found</h1>
      </div>
      <div className="viewbody">
        <p className="empty">
          <a href="#/campaigns">Back to Campaigns</a>
        </p>
      </div>
    </>
  );
}
