/**
 * Round 9 (ROUND9.md §8, item 42: "The dividers in playlists need to appear wherever playlists are visible not just in
 * the setup prep view") and round 10 fixes (R10-FIX §1): one list for a playlist's tracks wherever they are listed,
 * with its dividers as headings, and for a manual playlist a ⋯ on each track with Remove from this playlist (Undo)
 * and Open in Track library; Delete on a focused row does the same as Remove. r9lists.js L.dividersBefore and
 * L.dividerHeading, r10remove.js r10xpmore.
 *
 * The Playlists page uses it unfolded (PlaylistContents in shared.tsx). r10-prep (the planner, Add music) and r10-live
 * (Live with Play from here, the queue) put it in their screens:
 *
 *   <DividedTrackList label={`Tracks in ${pl.name}`} items={tracks} dividers={dividersBefore(pl)}
 *     renderItem={(t, i) => <li key={t.id} className="xp-row">…</li>}
 *     renderDivider={(name, firstTrack) => <DividerHeading key={…} name={name} onPlay={…} />} />
 *
 * Dividers follow the track under them (by id), so a list in its own order (a scene's) still shows each heading above
 * the track it named in the playlist.
 */
import React, { useCallback } from "react";
import type { PlaylistInfo } from "../../../common/lyre/api";
import { shownTitle } from "../../../common/lyre/text";
import { useLyreApi, useTracks } from "../../api";
import { Icon } from "../../kit/Icon";
import { PopMenuButton } from "../../kit/PopMenu";
import { useAnnounce } from "../../shell/Announcer";
import { hashOf } from "../../shell/routes";
import { useUndoNote } from "../../shell/UndoNote";
import { useSave } from "../../shell/useSave";

/** The dividers just above each track of a manual playlist, by track id (none for a dynamic playlist). */
export function dividersBefore(pl: Pick<PlaylistInfo, "kind" | "dividers"> & { trackIds?: readonly string[] }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (pl.kind !== "manual" || !pl.trackIds) return out;
  const byAt = [...(pl.dividers ?? [])].sort((a, b) => a.at - b.at);
  for (const d of byAt) {
    const under = pl.trackIds[d.at];
    // A divider below the last track has no track under it: it heads nothing, so it is not shown in a list of tracks.
    if (!under) continue;
    out.set(under, [...(out.get(under) ?? []), d.name || "Section"]);
  }
  return out;
}

/** A divider as a heading row in a list of tracks; Live adds Play from here (the playlist from the track under it). */
export function DividerHeading({ name, onPlay }: { name: string; onPlay?: () => void }) {
  return (
    <li className="r9-divh" aria-label={`Section: ${name}`}>
      <span className="r9-divh-line" aria-hidden="true" />
      <b className="ellipsis">{name}</b>
      <span className="r9-divh-line" aria-hidden="true" />
      {onPlay && (
        <button type="button" className="btn s ghost r9-divplay" title={`Play ${name} on air: the playlist from its first track under this heading`} aria-label={`Play from here: ${name}`} onClick={onPlay}>
          <Icon name="playair" size="s" />
          Play from here
        </button>
      )}
    </li>
  );
}

/** An ordered list of a playlist's tracks with its dividers as headings above the tracks they name. */
export function DividedTrackList<T extends { id: string }>({
  label,
  items,
  dividers,
  renderItem,
  renderDivider = (name, key) => <DividerHeading key={key} name={name} />,
  className = "list",
  id,
  onKeyDown,
}: {
  label: string;
  items: readonly T[];
  dividers: ReadonlyMap<string, readonly string[]>;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** `firstTrackId`: the track under the heading (Play from here starts there). */
  renderDivider?: (name: string, key: string, firstTrackId: string) => React.ReactNode;
  className?: string;
  /** f-live: Live's unfolded list is named by its playlist's expander (aria-controls). */
  id?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLOListElement>;
}) {
  const shown = new Set<string>();
  return (
    <ol className={className} id={id} aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        // A track listed twice gets its headings once, above its first place.
        const heads = shown.has(item.id) ? [] : (dividers.get(item.id) ?? []);
        shown.add(item.id);
        return (
          <React.Fragment key={`${item.id}:${i}`}>
            {heads.map((name, k) => renderDivider(name, `div:${item.id}:${k}`, item.id))}
            {renderItem(item, i)}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/**
 * Remove from this playlist, with Undo at the bottom of the screen and the Saved pop-up (R10-FIX §1). The track stays in
 * the Track library. Resolves true when it was taken out.
 */
export function useRemoveFromPlaylist() {
  const api = useLyreApi();
  const save = useSave();
  const { say } = useAnnounce();
  const { offer } = useUndoNote();
  const tracks = useTracks().data;
  return useCallback(
    async (pl: Pick<PlaylistInfo, "id" | "name">, trackId: string, at?: number): Promise<boolean> => {
      const t = tracks?.find((x) => x.id === trackId);
      const title = t ? shownTitle(t) : "the track";
      const done = await save(pl.name, () => api.playlists.removeTrack(pl.id, trackId, at), { detail: `removed ${title}`, key: `pl-${pl.id}` });
      if (!done) return false;
      const text = `Removed “${title}” from the playlist "${pl.name}". It is still in the Track library.`;
      say(`${text} To undo this, press Undo, at the bottom of the screen, or Ctrl+Z.`);
      if (done.ok) offer(text, done.undoLabel);
      return true;
    },
    [api, save, say, offer, tracks],
  );
}

/** The ⋯ of a manual playlist's track shown in a list: Remove from this playlist, Open in Track library. */
export function TrackInPlaylistMenu({ pl, trackId, title, onRemove }: { pl: Pick<PlaylistInfo, "id" | "name">; trackId: string; title: string; onRemove: () => void }) {
  return (
    <PopMenuButton
      label={`More for ${title}`}
      ariaLabel={`More for ${title}`}
      title="More"
      className="btn s icon ghost r10-xpmore"
      focusKey={`xpm-${pl.id}-${trackId}`}
      items={() => [
        {
          content: (
            <>
              <Icon name="close" size="s" />
              Remove from this playlist
            </>
          ),
          onSelect: onRemove,
        },
        { separator: true },
        {
          content: (
            <>
              <Icon name="library" size="s" />
              Open in Track library
            </>
          ),
          onSelect: () => (window.location.hash = hashOf(`library/${trackId}`)),
        },
      ]}
    >
      <Icon name="more" size="s" />
    </PopMenuButton>
  );
}

/**
 * Delete on a focused row (a control in the row has the focus) does what the row's ⋯ does to take it out (r10remove.js):
 * not while typing, not with a menu or dialog open, not with a modifier key.
 */
export function deleteKeyOnRow(event: React.KeyboardEvent): boolean {
  if (event.key !== "Delete" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const a = document.activeElement as HTMLElement | null;
  if (!a || a.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) return false;
  if (document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return false;
  return true;
}
