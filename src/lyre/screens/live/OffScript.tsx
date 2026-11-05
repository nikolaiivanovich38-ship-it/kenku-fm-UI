/**
 * Off script (live.js offScript): search the whole library by name or mood (/), narrow to Music, Ambience or FX, pick
 * moods (All tags shows every group), and clear picked tags with the X beside them. An effect played on air layers
 * over the music. Sound goes to the box's room (To:).
 */
import React, { useMemo } from "react";

import { Icon } from "../../kit/Icon";
import { Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { useLive } from "./liveData";
import { moodsByUse, offScriptSearch, type OffScriptQuery, type TagPick } from "./liveModel";
import { updateLive } from "./liveState";
import { ToChip } from "./ToChip";
import { TrackRow } from "./TrackRow";

const LANES: [OffScriptQuery["lane"], string][] = [
  ["all", "All"],
  ["music", "Music"],
  ["amb", "Ambience"],
  ["fx", "FX"],
];
/** Moods shown before All tags. */
const FIRST_MOODS = 8;

export function OffScriptPane({ open, onOpenChange, keys1 }: { open: boolean; onOpenChange: (open: boolean) => void; keys1: boolean }) {
  const { index, state, tagGroups, now } = useLive();
  const { say } = useAnnounce();
  const { q, tags, lane } = state.search;
  const active = q !== "" || tags.length > 0;
  // Searching is the heaviest thing on this screen: worked out only when the words, tags or library change.
  const result = useMemo(() => (active ? offScriptSearch(index.tracks, state.search) : null), [active, index.tracks, state.search]);
  const moodValues = tagGroups.find((g) => g.id === "mood")?.values;
  const moods = useMemo(() => moodsByUse(index.tracks, moodValues ?? []), [index.tracks, moodValues]);
  const shown = state.moreTags ? moods : moods.slice(0, FIRST_MOODS);
  const isOn = (t: TagPick) => tags.some((x) => x.group === t.group && x.value === t.value);
  const extra = tags.filter((x) => (x.group !== "mood" ? !state.moreTags : !shown.includes(x.value)));
  const setSearch = (change: Partial<OffScriptQuery>) => updateLive((s) => ({ search: { ...s.search, ...change } }));
  const toggle = (t: TagPick) => {
    const next = isOn(t) ? tags.filter((x) => !(x.group === t.group && x.value === t.value)) : [...tags, t];
    setSearch({ tags: next });
    say(`${offScriptSearch(index.tracks, { ...state.search, tags: next }).list.length} found`);
  };
  const chip = (t: TagPick) => (
    <button key={`${t.group}:${t.value}`} type="button" className="chip lv-mood" aria-pressed={isOn(t)} title={tagGroups.find((g) => g.id === t.group)?.name} onClick={() => toggle(t)}>
      {isOn(t) && <Icon name="check" size="s" />}
      {t.value}
    </button>
  );
  const prefer = tags.filter((x) => x.group === "mood").map((x) => x.value);
  const onAir = (id: string) => now.rooms.some((r) => r.music?.trackId === id || r.ambience?.trackId === id || r.effects.some((e) => e.trackId === id && !e.padKey));
  const count = result ? (result.list.length ? `${result.list.length} found` : "Nothing found") : "";

  return (
    <Pane
      id="lv-off"
      title="Off script"
      icon="search"
      kind="search"
      size="auto"
      flush
      noMax
      open={open}
      onOpenChange={onOpenChange}
      actions={<ToChip box="off" />}
      status={result ? { text: count, tone: "idle" } : undefined}
      summary={open ? undefined : [q, ...tags.map((t) => t.value)].filter(Boolean).join(", ")}
    >
      <div className="lv-off-f">
        <div className="search grow">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            data-lv="search"
            value={q}
            placeholder="Name or mood"
            aria-label="Off script: search the whole library"
            aria-keyshortcuts={keys1 ? "/" : undefined}
            onChange={(event) => setSearch({ q: event.target.value })}
          />
          {keys1 && (
            <span className="kbd" aria-hidden="true">
              /
            </span>
          )}
        </div>
        <div className="seg s" role="group" aria-label="Show">
          {LANES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={lane === value} onClick={() => setSearch({ lane: value })}>
              {label}
            </button>
          ))}
        </div>
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
              document.querySelector<HTMLElement>('[data-lv="search"]')?.focus();
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
          <div className="lv-off-count" role="status">
            {/* The box's status pill shows how many; this line is read when it changes and shown only when it needs words. */}
            <span className={result.list.length && !result.any ? "sr-only" : undefined}>
              {count}
              {result.any ? ": none has all these tags, so tracks with some of them" : ""}
            </span>
            <button
              type="button"
              className="lv-more"
              onClick={() => {
                setSearch({ q: "", tags: [] });
                document.querySelector<HTMLElement>('[data-lv="search"]')?.focus();
                say("Search cleared");
              }}
            >
              Clear
            </button>
          </div>
          {result.list.length > 0 && (
            <ol className="lv-list" aria-label="Off script results">
              {result.list.map((t) => (
                <TrackRow key={t.id} track={t} rowKey={`off:${t.id}`} place={null} playlistId={null} box="off" on={onAir(t.id)} prefer={prefer} />
              ))}
            </ol>
          )}
        </>
      )}
    </Pane>
  );
}
