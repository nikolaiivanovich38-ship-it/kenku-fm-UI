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
  /** Extra words the search matches (track titles inside a playlist, tags). */
  search?: string;
  /** Drawn a step in (a scene under its session). */
  indent?: boolean;
  /** Anything the screen needs for filters. */
  tags?: readonly string[];
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
  /** What is inside an item, behind an expander that starts closed; null for items with nothing to show. */
  renderContents?: (item: PickerItem) => React.ReactNode;
  /** Buttons at the end of an item's row (the screens add Preview here). */
  renderActions?: (item: PickerItem) => React.ReactNode;
  /** A line under the list, e.g. the preview hint. */
  hint?: React.ReactNode;
  okLabel?: string;
  /** The ticked ids, in the order they were ticked (items already ticked first). */
  onDone: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Choose from a long list in a sheet (the prototype's L.pickerSheet): search, an optional Show filter, groups,
 * expanders to look inside before adding, and Cancel or Done. The screens build the items from the library.
 */
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
  onDone,
  onClose,
}: PickerDialogProps) {
  const [chosen, setChosen] = useState<string[]>([...selected]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(filters?.[0]?.id ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const activeFilter = filters?.find((f) => f.id === filter);
  const needle = query.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (!needle || `${item.label} ${item.sub ?? ""} ${item.search ?? ""}`.toLowerCase().includes(needle)) &&
      (!activeFilter || activeFilter.test(item)),
  );
  const groups: { name: string; items: PickerItem[] }[] = [];
  for (const item of visible) {
    const name = item.group ?? "";
    let group = groups.find((g) => g.name === name);
    if (!group) {
      group = { name, items: [] };
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
        {groups.map((group) => (
          <React.Fragment key={group.name}>
            {group.name && <div className="pk-group">{group.name}</div>}
            {group.items.map((item) => {
              const contents = renderContents?.(item);
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
        ))}
      </div>
      {hint !== undefined ? (
        hint
      ) : renderContents ? (
        <p className="hint" style={{ marginTop: 6 }}>
          <Icon name="chevdown" size="s" /> shows what is inside.
        </p>
      ) : null}
    </Dialog>
  );
}
