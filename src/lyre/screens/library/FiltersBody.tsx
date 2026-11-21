/** The Library's Filters box: kind, New, Missing (DAT-8), shape (DAT-13), tag values, energy and folders (library.js filtersBody). */
import React, { useMemo } from "react";
import type { FolderRoot, LibraryTrack, TagGroup } from "../../../common/lyre/api";
import { Icon } from "../../kit/Icon";
import { focusSoon } from "../../kit/focusSoon";
import { useAnnounce } from "../../shell/Announcer";
import { cx } from "../../kit/cx";
import { getLibraryState, setLibraryState } from "./libraryState";
import { shapeOf } from "../../../common/domain";
import { ShapeGlyph } from "../../kit/ShapeGlyph";
import { tagTreeOf } from "../../../common/lyre/lookup";
import { trackHasTag } from "../../../common/domain/round7";
import { chipState, cycleChip, cycleFolder, folderRows, isNewish, KIND_NAMES, kindOk, shortPath, SHAPES, visibleTracks, type ChipState, type KindFilter, type LibraryFilter } from "./model";
import { FolderActions } from "./FolderActions";
import { inFilterOrder, useFilterOrder } from "./listPrefs";
import { SHAPE_WORDS, type TrackShape } from "../../../common/domain";

/** Round 9 (item 34): the one line that says how the chips work; each chip is described by it. */
const HINT_ID = "lb-fhint";
const SAID: Record<ChipState, string> = { off: "", show: ", shown", hide: ", hidden" };
const NEXT_TIP: Record<ChipState, string> = { off: "click to show only these", show: "click to hide these instead", hide: "click to clear" };
const SAY_NOW: Record<ChipState, string> = { off: "cleared", show: "shown", hide: "hidden" };

/** A filter chip with three states, in words for screen readers as well as the look (library.js chip3). */
function Chip3({ state, words, count, glyph, onClick }: { state: ChipState; words: string; count: number; glyph?: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cx("chip lb-fchip r9-c3", state === "hide" && "is-hide")}
      // The 0.6.0 usability test (F-P16): the state is in the name, "Heroic, hidden, 14", with no stray space before the
      // comma (a hidden tag is not pressed, as an unused one is not).
      aria-label={`${words}${SAID[state] ? `${SAID[state]},` : ""} ${count}`}
      aria-pressed={state === "show"}
      aria-describedby={HINT_ID}
      title={`${words}: ${NEXT_TIP[state]}`}
      onClick={onClick}
    >
      {state === "show" ? <Icon name="check" size="s" /> : state === "hide" ? <Icon name="close" size="s" /> : glyph}
      <span className="r9-c3-w">{words}</span>
      <span className="lb-n num">{count}</span>
    </button>
  );
}

const KINDS: [KindFilter, string][] = [
  ["all", "All"],
  ["music", "Music"],
  ["amb", "Ambience"],
  ["fx", "FX"],
];

export function FiltersBody({
  tracks,
  groups,
  folders,
  filter,
  missing,
}: {
  tracks: LibraryTrack[];
  groups: TagGroup[];
  folders: FolderRoot[];
  filter: LibraryFilter;
  /** Ids of the tracks whose files Lyre cannot find. */
  missing: ReadonlySet<string>;
}) {
  const { say } = useAnnounce();
  const order = useFilterOrder();
  const base = useMemo(() => tracks.filter((t) => kindOk(t, filter.kind)), [tracks, filter.kind]);
  const nNew = useMemo(() => base.filter(isNewish).length, [base]);
  const nMissing = useMemo(() => tracks.filter((t) => missing.has(t.id)).length, [tracks, missing]);
  // How many tracks of this kind have each shape (chosen, else suggested).
  const shapeCounts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of base) {
      const { shape } = shapeOf(t);
      if (shape) out.set(shape, (out.get(shape) ?? 0) + 1);
    }
    return out;
  }, [base]);
  // DAT-10: a tag finds the tracks of the tags inside it, here as in the list.
  const tree = useMemo(() => tagTreeOf(groups), [groups]);
  // Each tag value's count among the tracks of this kind (a tag's count includes the tags inside it).
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const g of groups) for (const v of g.values) out.set(`${g.id}\u0000${v}`, base.filter((t) => trackHasTag(t, g.id, v, tree)).length);
    return out;
  }, [base, groups, tree]);
  const folderList = useMemo(() => folderRows(tracks, folders, filter.folder, filter.kind), [tracks, folders, filter.folder, filter.kind]);
  const setFilter = (change: Partial<LibraryFilter>) => setLibraryState((s) => ({ filter: { ...s.filter, ...change } }));
  /** Item 21: Clear in one control takes off that control's filter only. */
  const clear = (change: Partial<LibraryFilter>, what: string) => {
    setFilter(change);
    say(`${what} filter cleared. ${shownCount()} tracks shown`);
  };
  const shownCount = () => {
    const s = getLibraryState();
    return visibleTracks(tracks, s.filter, s.q, s.sort, missing, tree).length;
  };

  return (
    <div className="lb-f">
      <div className="lb-fg">
        <div className="seg s lb-seg24 lb-kind" role="group" aria-label="Kind of track">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter.kind === k} title={k === "fx" ? "Sound effects and stings" : undefined} onClick={() => setFilter({ kind: k })}>
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn s lb-newbtn"
          aria-pressed={filter.newOnly}
          onClick={() => {
            setFilter({ newOnly: !filter.newOnly });
            say(filter.newOnly ? "Showing all tracks" : "Showing new tracks not tagged yet");
          }}
        >
          <Icon name={filter.newOnly ? "check" : "tag"} size="s" />
          <span className="grow lb-l">New, not tagged yet</span>
          <span className={cx("badge", nNew > 0 && "accent")}>{nNew}</span>
        </button>
        {nMissing > 0 && (
          <button
            type="button"
            className="btn s lb-newbtn lb-missbtn"
            aria-pressed={filter.missing}
            onClick={() => {
              setFilter({ missing: !filter.missing });
              say(filter.missing ? "Showing all tracks" : "Showing files Lyre cannot find");
            }}
          >
            <Icon name={filter.missing ? "check" : "warn"} size="s" />
            <span className="grow lb-l">Missing</span>
            <span className="badge warn">{nMissing}</span>
          </button>
        )}
      </div>
      {/* Round 9 (items 27, 34): one line says how the chips work; each chip is off, Show (✓) or Hide (struck out). */}
      <p className="hint r9-fhint" id={HINT_ID}>
        Click a filter once to show only those tracks, and again to hide them.
      </p>
      <div className="lb-fg" role="group" aria-labelledby="lb-fh-shape">
        <FilterHeading id="lb-fh-shape" name="Shape" onClear={filter.shapes.length || filter.hideShapes.length ? () => clear({ shapes: [], hideShapes: [] }, "Shape") : undefined} />
        <div className="chips">
          {inFilterOrder(
            SHAPES.map(([shape, word]) => [word, shapeCounts.get(shape) ?? 0, shape] as const),
            order,
          ).map(([word, n, shape]) => (
            <Chip3
              key={shape}
              state={chipState(filter.shapes, filter.hideShapes, shape)}
              words={word}
              count={n}
              glyph={<ShapeGlyph shape={shape} />}
              onClick={() => {
                const next = cycleChip<TrackShape>(filter.shapes, filter.hideShapes, shape);
                setFilter({ shapes: next.shown, hideShapes: next.hidden });
                say(`${SHAPE_WORDS[shape]} ${SAY_NOW[next.now]}. ${shownCount()} tracks shown`);
              }}
            />
          ))}
        </div>
      </div>
      {groups.map((g) => {
        const ticked = filter.tags[g.id] ?? [];
        const hidden = filter.hide[g.id] ?? [];
        const values = inFilterOrder(
          g.values.map((v) => [v, counts.get(`${g.id}\u0000${v}`) ?? 0] as const).filter(([v, n]) => n > 0 || ticked.includes(v) || hidden.includes(v)),
          order,
        );
        return (
          <div key={g.id} className="lb-fg" role="group" aria-labelledby={`lb-fh-${g.id}`}>
            <FilterHeading
              id={`lb-fh-${g.id}`}
              name={g.name}
              onClear={
                ticked.length || hidden.length
                  ? () => {
                      const tags = { ...filter.tags };
                      const hide = { ...filter.hide };
                      delete tags[g.id];
                      delete hide[g.id];
                      clear({ tags, hide }, g.name);
                    }
                  : undefined
              }
            />
            <div className="chips">
              {values.length ? (
                values.map(([v, n]) => (
                  <Chip3
                    key={v}
                    state={chipState(ticked, hidden, v)}
                    words={v}
                    count={n}
                    onClick={() => {
                      const next = cycleChip(ticked, hidden, v);
                      setFilter({ tags: { ...filter.tags, [g.id]: next.shown }, hide: { ...filter.hide, [g.id]: next.hidden } });
                      say(`${v} ${SAY_NOW[next.now]}. ${shownCount()} tracks shown`);
                    }}
                  />
                ))
              ) : (
                <span className="hint">No values used yet</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="lb-fg">
        <FilterHeading name="Energy" onClear={filter.emin > 1 || filter.emax < 5 ? () => clear({ emin: 1, emax: 5 }, "energy") : undefined} clearLabel="Clear energy" focusTo='select[aria-label="Lowest energy"]' />
        <div className="lb-erange">
          <label>
            From{" "}
            <select
              className="input lb-sel"
              aria-label="Lowest energy"
              value={filter.emin}
              onChange={(e) => {
                const emin = Number(e.target.value);
                setFilter({ emin, emax: Math.max(emin, filter.emax) });
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            to{" "}
            <select
              className="input lb-sel"
              aria-label="Highest energy"
              value={filter.emax}
              onChange={(e) => {
                const emax = Number(e.target.value);
                setFilter({ emax, emin: Math.min(emax, filter.emin) });
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="lb-fg">
        <FilterHeading name="Folders" onClear={filter.folder || filter.hideFolders.length ? () => clear({ folder: "", hideFolders: [] }, "folder") : undefined} clearLabel="Clear folder" focusTo=".lb-folders button" />
        <ul className="lb-folders">
          {folderList.map((f) => {
            // Round 9 (item 34): a folder works like a chip: once shows only it, again hides its tracks, again clears.
            const hidden = filter.hideFolders.includes(f.path);
            const chosen = filter.folder === f.path;
            const tip = f.path ? `${f.path}${chosen ? ": click again to hide its tracks" : hidden ? ": hidden. Click to show it again" : ""}` : "Every folder";
            return (
              <li key={`${f.sub ? "s" : "r"}:${f.path}`} className={cx(f.sub && "sub", "r9-fo", hidden && "is-hide")}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  title={tip}
                  onClick={() => {
                    const next = cycleFolder(filter, f.path);
                    setFilter({ folder: next.folder, hideFolders: next.hideFolders });
                    if (f.path) say(`${shortPath(f.path)} ${next.now === "hide" ? "hidden" : next.now === "off" ? "shown again" : "shown"}. ${shownCount()} tracks shown`);
                  }}
                >
                  <Icon name={hidden ? "close" : f.watched ? "eye" : "folder"} size="s" />
                  <span className="ellipsis grow">
                    {f.label}
                    {hidden && <span className="sr-only">, hidden</span>}
                  </span>
                  {f.watched && <span className="hint">watched</span>}
                  {f.root?.newKind && <span className="hint">{KIND_NAMES[f.root.newKind]}</span>}
                  <span className="num lb-n">{f.count}</span>
                </button>
                {f.root && <FolderActions root={f.root} tracks={tracks} />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** A filter's heading, with Clear beside it while something is chosen there (item 21). */
function FilterHeading({ id, name, onClear, clearLabel, focusTo }: { id?: string; name: string; onClear?: () => void; clearLabel?: string; focusTo?: string }) {
  return (
    <div className="lb-fhrow">
      <h3 className="lb-fh" id={id}>
        {name}
      </h3>
      {onClear && (
        <button type="button" className="btn s ghost lb-fclear" aria-label={clearLabel ?? `Clear ${name}`} title={clearLabel ?? `Clear ${name}`} onClick={() => {
            onClear();
            // UX-R4: Clear goes away, so focus goes to the control it cleared.
            const to = focusTo ?? (id ? `[aria-labelledby="${id}"] .chips button` : null);
            if (to) focusSoon([to]);
          }}>
          Clear
        </button>
      )}
    </div>
  );
}
