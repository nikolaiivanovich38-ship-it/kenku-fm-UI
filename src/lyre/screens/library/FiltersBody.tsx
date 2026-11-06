/** The Library's Filters box: kind, New, Missing (DAT-8), shape (DAT-13), tag values, energy and folders (library.js filtersBody). */
import React, { useMemo } from "react";
import type { FolderRoot, LibraryTrack, TagGroup } from "../../../common/lyre/api";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { cx } from "../../kit/cx";
import { getLibraryState, setLibraryState } from "./libraryState";
import { shapeOf } from "../../../common/domain";
import { ShapeGlyph } from "../../kit/ShapeGlyph";
import { folderRows, isNewish, kindOk, SHAPES, visibleTracks, type KindFilter, type LibraryFilter } from "./model";

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
  // Each tag value's count among the tracks of this kind, in one pass.
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of base) for (const [g, values] of Object.entries(t.tags)) for (const v of values) out.set(`${g}\u0000${v}`, (out.get(`${g}\u0000${v}`) ?? 0) + 1);
    return out;
  }, [base]);
  const folderList = useMemo(() => folderRows(tracks, folders, filter.folder, filter.kind), [tracks, folders, filter.folder, filter.kind]);
  const setFilter = (change: Partial<LibraryFilter>) => setLibraryState((s) => ({ filter: { ...s.filter, ...change } }));
  const shownCount = () => {
    const s = getLibraryState();
    return visibleTracks(tracks, s.filter, s.q, s.sort, missing).length;
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
      <div className="lb-fg" role="group" aria-labelledby="lb-fh-shape">
        <h3 className="lb-fh" id="lb-fh-shape">
          Shape
        </h3>
        <div className="chips">
          {SHAPES.map(([shape, word]) => {
            const on = filter.shapes.includes(shape);
            return (
              <button
                key={shape}
                type="button"
                className="chip lb-fchip"
                aria-pressed={on}
                onClick={() => {
                  setFilter({ shapes: on ? filter.shapes.filter((x) => x !== shape) : [...filter.shapes, shape] });
                  say(`${shownCount()} tracks shown`);
                }}
              >
                {on ? <Icon name="check" size="s" /> : <ShapeGlyph shape={shape} />}
                {word}
                <span className="lb-n num">{shapeCounts.get(shape) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>
      {groups.map((g) => {
        const ticked = filter.tags[g.id] ?? [];
        const values = g.values.map((v) => [v, counts.get(`${g.id}\u0000${v}`) ?? 0] as const).filter(([v, n]) => n > 0 || ticked.includes(v));
        return (
          <div key={g.id} className="lb-fg" role="group" aria-labelledby={`lb-fh-${g.id}`}>
            <h3 className="lb-fh" id={`lb-fh-${g.id}`}>
              {g.name}
            </h3>
            <div className="chips">
              {values.length ? (
                values.map(([v, n]) => {
                  const on = ticked.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className="chip lb-fchip"
                      aria-pressed={on}
                      onClick={() => {
                        setFilter({ tags: { ...filter.tags, [g.id]: on ? ticked.filter((x) => x !== v) : [...ticked, v] } });
                        say(`${shownCount()} tracks shown`);
                      }}
                    >
                      {on && <Icon name="check" size="s" />}
                      {v}
                      <span className="lb-n num">{n}</span>
                    </button>
                  );
                })
              ) : (
                <span className="hint">No values used yet</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="lb-fg">
        <h3 className="lb-fh">Energy</h3>
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
        <h3 className="lb-fh">Folders</h3>
        <ul className="lb-folders">
          {folderList.map((f) => (
            <li key={`${f.sub ? "s" : "r"}:${f.path}`} className={f.sub ? "sub" : undefined}>
              <button type="button" aria-pressed={filter.folder === f.path} title={f.path || "Every folder"} onClick={() => setFilter({ folder: f.path })}>
                <Icon name={f.watched ? "eye" : "folder"} size="s" />
                <span className="ellipsis grow">{f.label}</span>
                {f.watched && <span className="hint">watched</span>}
                <span className="num lb-n">{f.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
