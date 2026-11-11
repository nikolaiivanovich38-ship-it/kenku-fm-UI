/**
 * Find a track or playlist (live.js find, found; was the Off script box): a search field in the top strip whose
 * results open under it, over the boxes, which stay where they are. The results open on a click in the field, on / and
 * on typing (not on Tab, which only passes through), and close with Esc, × or a click or focus elsewhere. Narrow to
 * Music, Ambience or FX; pick moods (All tags shows every group) and clear them with the X beside them. ORG-14: the
 * results are Playlists first (each unfolds to its tracks), then Tracks, each row with the buttons it has everywhere in
 * Live. An effect played on air layers over the music. Sound goes to Find's room (To:).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { UsePlace } from "../../../common/domain";
import { Icon } from "../../kit/Icon";
import { useSayWhenSettled } from "../../kit/useSayWhenSettled";
import { useAnnounce } from "../../shell/Announcer";
import { useLive } from "./liveData";
import { findSearch, moodsByUse, type OffScriptQuery, type TagPick } from "./liveModel";
import { getLiveState, updateLive } from "./liveState";
import { focusLive } from "./focus";
import { PlaylistRow, TrackRow, trackOnAir } from "./Rows";
import { ToChip } from "./ToChip";

const LANES: [OffScriptQuery["lane"], string][] = [
  ["all", "All"],
  ["music", "Music"],
  ["amb", "Ambience"],
  ["fx", "FX"],
];
/** Moods shown before All tags. */
const FIRST_MOODS = 8;
/** The results' widest. */
const RESULTS_PX = 680;

export function openFind(): void {
  if (!getLiveState().findOpen) updateLive({ findOpen: true });
}

export function closeFind(refocus: boolean): boolean {
  if (!getLiveState().findOpen) return false;
  updateLive({ findOpen: false });
  if (refocus) focusLive("search");
  return true;
}

/** The field, and the results while open. */
export function Find() {
  const { state, keys1, keys } = useLive();
  const wrap = useRef<HTMLDivElement>(null);
  const setSearch = (change: Partial<OffScriptQuery>) => updateLive((s) => ({ search: { ...s.search, ...change }, findOpen: true }));

  // A click or focus anywhere else closes the results (a menu opened from them, such as To:, keeps them).
  useEffect(() => {
    if (!state.findOpen) return;
    const away = (target: EventTarget | null) => {
      const el = target as Element | null;
      if (!el?.closest || el.closest(".lv-find") || el.closest(".menu")) return;
      closeFind(false);
    };
    const onFocus = (event: FocusEvent) => away(event.target);
    const onPointer = (event: PointerEvent) => away(event.target);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [state.findOpen]);

  const singleFind = keys1 && keys.find.length === 1;
  return (
    <div className="lv-find" ref={wrap}>
      <div className="search lv-find-f">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          data-lv="search"
          value={state.search.q}
          placeholder="Find a track or playlist"
          aria-label="Find a track or playlist in the whole library"
          aria-controls={state.findOpen ? "lv-found" : undefined}
          aria-keyshortcuts={singleFind ? keys.find : undefined}
          onPointerDown={() => setTimeout(openFind, 0)}
          onChange={(event) => setSearch({ q: event.target.value })}
        />
        {singleFind && (
          <span className="kbd" aria-hidden="true">
            {keys.find}
          </span>
        )}
      </div>
      {state.findOpen && <Results anchor={wrap} />}
    </div>
  );
}

function Results({ anchor }: { anchor: React.RefObject<HTMLDivElement> }) {
  const d = useLive();
  const { index, state, tagGroups, session, campaign } = d;
  const { say } = useAnnounce();
  const box = useRef<HTMLElement>(null);
  const { tags, lane } = state.search;
  const result = useMemo(() => findSearch(index, state.search), [index, state.search]);
  // UX-R7: the count is read out once typing (or picking tags) pauses, without the Clear button's name.
  useSayWhenSettled(result ? (result.count ? `${result.count} found` : "Nothing found") + (result.any ? ": none has all these tags, so tracks with some of them" : "") : null);
  const moodValues = tagGroups.find((g) => g.id === "mood")?.values;
  const moods = useMemo(() => moodsByUse(index.tracks, moodValues ?? []), [index.tracks, moodValues]);
  const shown = state.moreTags ? moods : moods.slice(0, FIRST_MOODS);
  const isOn = (t: TagPick) => tags.some((x) => x.group === t.group && x.value === t.value);
  const extra = tags.filter((x) => (x.group !== "mood" ? !state.moreTags : !shown.includes(x.value)));
  const setSearch = (change: Partial<OffScriptQuery>) => updateLive((s) => ({ search: { ...s.search, ...change } }));
  const toggle = (t: TagPick) => {
    const next = isOn(t) ? tags.filter((x) => !(x.group === t.group && x.value === t.value)) : [...tags, t];
    setSearch({ tags: next });
  };
  const chip = (t: TagPick) => (
    <button key={`${t.group}:${t.value}`} type="button" className="chip lv-mood" aria-pressed={isOn(t)} title={tagGroups.find((g) => g.id === t.group)?.name} onClick={() => toggle(t)}>
      {isOn(t) && <Icon name="check" size="s" />}
      {t.value}
    </button>
  );
  const prefer = tags.filter((x) => x.group === "mood").map((x) => x.value);
  // PLY-13: a session's or the campaign's playlist plays in its order for that place.
  const placeOf = (playlistId: string): UsePlace | null =>
    session.playlistIds.includes(playlistId) ? { kind: "session", campaignId: campaign.id, sessionId: session.id } : campaign.playlistIds.includes(playlistId) ? { kind: "campaign", campaignId: campaign.id } : null;

  // The results stay inside the window: under the field, moved left when the field is near the right edge.
  useLayoutEffect(() => {
    const el = box.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!el || !at) return;
    const width = Math.min(RESULTS_PX, window.innerWidth - 24);
    el.style.width = `${width}px`;
    el.style.left = `${Math.min(0, window.innerWidth - 12 - width - at.left)}px`;
  });

  const clear = () => {
    setSearch({ q: "", tags: [] });
    focusLive("search");
    say("Search cleared");
  };
  return (
    <section className="lv-found" id="lv-found" aria-label="Find a track or playlist" ref={box}>
      <div className="lv-off-f">
        <div className="seg s" role="group" aria-label="Show">
          {LANES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={lane === value} onClick={() => setSearch({ lane: value })}>
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <ToChip box="off" />
        <button type="button" className="closer" aria-label="Close Find" title="Close (Esc)" onClick={() => closeFind(true)}>
          <Icon name="close" />
        </button>
      </div>
      <div className="chips lv-tagrow" role="group" aria-label="Moods">
        {shown.map((value) => chip({ group: "mood", value }))}
        {extra.map(chip)}
        <button type="button" className="lv-more" aria-expanded={state.moreTags} onClick={() => updateLive({ moreTags: !state.moreTags })}>
          {state.moreTags ? "Fewer tags" : "All tags"}
        </button>
        {tags.length > 0 && (
          <button
            type="button"
            className="closer lv-tagx"
            aria-label="Clear selected tags"
            title="Clear selected tags"
            onClick={() => {
              setSearch({ tags: [] });
              focusLive("search");
              say("Selected tags cleared");
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {state.moreTags &&
        tagGroups
          .filter((g) => g.id !== "mood")
          .map((g) => (
            <div className="lv-taggrp" key={g.id}>
              <span className="lv-taggrp-l">{g.name}</span>
              <div className="chips" role="group" aria-label={g.name}>
                {g.values.map((value) => chip({ group: g.id, value }))}
              </div>
            </div>
          ))}
      {result && (
        <>
          <div className="lv-off-count">
            <span>
              {result.count ? `${result.count} found` : "Nothing found"}
              {result.any ? ": none has all these tags, so tracks with some of them" : ""}
            </span>
            <button type="button" className="lv-more" onClick={clear}>
              Clear
            </button>
          </div>
          {result.playlists.length > 0 && (
            <>
              <h3 className="lv-found-h" id="lv-found-p">
                Playlists
              </h3>
              <ol className="lv-list" aria-labelledby="lv-found-p">
                {result.playlists.map((p) => {
                  const place = placeOf(p.id);
                  return (
                    <PlaylistRow
                      key={p.id}
                      playlist={p}
                      rowKey={`offp:${p.id}`}
                      place={place}
                      box="off"
                      trackRow={(t) => <TrackRow key={t.id} track={t} rowKey={`offp:${p.id}:${t.id}`} place={place} playlistId={p.id} from={{ playlistId: p.id, ...(place ? { place } : {}) }} box="off" on={trackOnAir(d, t.id)} inner />}
                    />
                  );
                })}
              </ol>
            </>
          )}
          {result.tracks.length > 0 && (
            <>
              <h3 className="lv-found-h" id="lv-found-t">
                Tracks
              </h3>
              <ol className="lv-list" aria-labelledby="lv-found-t">
                {result.tracks.map((t) => (
                  <TrackRow key={t.id} track={t} rowKey={`off:${t.id}`} place={null} playlistId={null} box="off" on={trackOnAir(d, t.id)} prefer={prefer} facts />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
