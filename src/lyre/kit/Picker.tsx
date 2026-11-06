import React, { useState } from "react";
import { Button, Segmented } from "./Button";
import { Dialog } from "./Dialog";
import { ExpanderButton } from "./Expander";
import { SearchField } from "./Fields";
import { Icon } from "./Icon";
import { cx } from "./cx";

export interface PickerItem {
  id: string;
  label: string;
  /** A second line: kind, length, where it is used. */
  sub?: string;
  /** Items are listed under their group's heading, in the order the groups first appear. */
  group?: string;
  /** The group's own key when two groups may share a name (a campaign's id); the group's name by default. */
  groupId?: string;
  /** Extra words the search matches (track titles inside a playlist, tags). */
  search?: string;
  /** Drawn a step in (a scene under its session). */
  indent?: boolean;
  /** Anything the screen needs for filters. */
  tags?: readonly string[];
}

/** What an item's contents can tick (ORG-10: single tracks inside an open playlist), shared with the list's boxes. */
export interface PickerTicks {
  isTicked(id: string): boolean;
  tick(id: string, on: boolean): void;
}

export interface PickerFilter {
  id: string;
  label: string;
  test: (item: PickerItem) => boolean;
}

export interface PickerDialogProps {
  open: boolean;
  title: string;
  intro?: React.ReactNode;
  items: readonly PickerItem[];
  /** Ticked when the picker opens. */
  selected?: readonly string[];
  /** Tick many (checkboxes) or pick one (radio buttons). */
  multi?: boolean;
  /** A "Show" switch above the list, e.g. All, Playlists, Tracks, FX; the first is on at the start. */
  filters?: readonly PickerFilter[];
  /**
   * What is inside an item, behind an expander that starts closed; null for items with nothing to show. `ticks` lets
   * the contents have boxes of their own, ticked in the same list as the items (the same id ticks both).
   */
  renderContents?: (item: PickerItem, ticks: PickerTicks) => React.ReactNode;
  /** Buttons at the end of an item's row (the screens add Preview here). */
  renderActions?: (item: PickerItem) => React.ReactNode;
  /** A line under the list, e.g. the preview hint. */
  hint?: React.ReactNode;
  okLabel?: string;
  /**
   * Fold the groups ("Use in…" lists every campaign): each group's heading is a button that shows or hides it,
   * with how many of its items are ticked. Groups start folded, except `openGroups` and those with an item ticked;
   * while searching every match shows.
   */
  fold?: boolean;
  /** With fold: the groups open at the start (the campaign in hand), by their key (groupId, else name). */
  openGroups?: readonly string[];
  /** The ticked ids, in the order they were ticked (items already ticked first). */
  onDone: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Choose from a long list in a sheet (the prototype's L.pickerSheet): search, an optional Show filter, groups,
 * expanders to look inside before adding, and Cancel or Done. The screens build the items from the library.
 */
const groupKey = (item: PickerItem): string => item.groupId ?? item.group ?? "";

export function PickerDialog(props: PickerDialogProps) {
  // A fresh state each time it opens.
  return props.open ? <PickerBody {...props} /> : null;
}

function PickerBody({
  title,
  intro,
  items,
  selected = [],
  multi = true,
  filters,
  renderContents,
  renderActions,
  hint,
  okLabel = "Done",
  fold = false,
  openGroups = [],
  onDone,
  onClose,
}: PickerDialogProps) {
  const [chosen, setChosen] = useState<string[]>([...selected]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(filters?.[0]?.id ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(
    () => new Set([...openGroups, ...items.filter((item) => selected.includes(item.id)).map(groupKey)]),
  );
  const toggleGroup = (name: string) =>
    setUnfolded((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const tickedIn = (key: string) => items.filter((item) => groupKey(item) === key && chosen.includes(item.id)).length;

  const activeFilter = filters?.find((f) => f.id === filter);
  const needle = query.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (!needle || `${item.label} ${item.sub ?? ""} ${item.search ?? ""}`.toLowerCase().includes(needle)) &&
      (!activeFilter || activeFilter.test(item)),
  );
  const groups: { key: string; name: string; items: PickerItem[] }[] = [];
  for (const item of visible) {
    const key = groupKey(item);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, name: item.group ?? "", items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  const pick = (id: string, on: boolean) => {
    if (!multi) {
      setChosen([id]);
    } else {
      setChosen((current) => (on ? (current.includes(id) ? current : [...current, id]) : current.filter((x) => x !== id)));
    }
  };
  const ticks: PickerTicks = { isTicked: (id) => chosen.includes(id), tick: pick };

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted grow" aria-live="polite">
            {multi ? `${chosen.length} chosen` : ""}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onDone(chosen)}>
            {okLabel}
          </Button>
        </>
      }
    >
      {intro && (
        <p className="muted" style={{ marginBottom: 8 }}>
          {intro}
        </p>
      )}
      <div className="row-flex" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        <SearchField className="grow" label="Search the list" value={query} onChange={setQuery} />
        {filters && <Segmented label="Show" value={filter} onChange={setFilter} options={filters.map((f) => ({ value: f.id, label: f.label }))} />}
      </div>
      <div className="pk-list" role="group" aria-label={title}>
        {groups.length === 0 && <p className="empty">Nothing matches{needle ? ` "${query.trim()}"` : " this filter"}.</p>}
        {groups.map((group) => {
          const shown = !fold || !!needle || !group.name || unfolded.has(group.key);
          return (
            <React.Fragment key={group.key}>
              {group.name && fold && (
                // While searching every match shows, so the heading cannot fold its group.
                <button type="button" className="pk-groupbtn" aria-expanded={shown} disabled={!!needle} onClick={() => toggleGroup(group.key)}>
                  <Icon name="chevdown" size="s" />
                  {group.name}
                  <span className="hint" style={{ marginLeft: "auto" }}>
                    {tickedIn(group.key)} ticked
                  </span>
                </button>
              )}
              {group.name && !fold && <div className="pk-group">{group.name}</div>}
              {shown &&
                group.items.map((item) => {
                  const contents = renderContents?.(item, ticks);
                  const open = !!expanded[item.id];
                  return (
                    <React.Fragment key={item.id}>
                      <div className="pk-row">
                        {contents ? (
                          <ExpanderButton label={item.label} expanded={open} onToggle={() => setExpanded({ ...expanded, [item.id]: !open })} />
                        ) : (
                          <span style={{ width: 24, flex: "none" }} />
                        )}
                        <label className={cx("pk-item", item.indent && "indent")}>
                          <input
                            type={multi ? "checkbox" : "radio"}
                            name="picker"
                            value={item.id}
                            checked={chosen.includes(item.id)}
                            onChange={(event) => pick(item.id, event.target.checked)}
                          />
                          <span className="grow">
                            <span className="ellipsis" style={{ display: "block" }}>
                              {item.label}
                            </span>
                            {item.sub && (
                              <span className="hint ellipsis" style={{ display: "block" }}>
                                {item.sub}
                              </span>
                            )}
                          </span>
                        </label>
                        {renderActions?.(item)}
                      </div>
                      {contents && open && <div className="xp-body">{contents}</div>}
                    </React.Fragment>
                  );
                })}
            </React.Fragment>
          );
        })}
      </div>
      {hint !== undefined ? (
        hint
      ) : renderContents ? (
        <p className="hint" style={{ marginTop: 6 }}>
          The arrow <Icon name="chevdown" size="s" /> beside a name shows what is inside.
        </p>
      ) : null}
    </Dialog>
  );
}
