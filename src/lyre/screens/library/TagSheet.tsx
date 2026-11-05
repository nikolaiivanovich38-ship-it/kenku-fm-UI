/**
 * Tag… on the ticked tracks (library.js tsBody): add or remove tags in bulk, see how many of the tracks have each
 * already, and create new values. The values are created when the tags are added.
 */
import React, { useState } from "react";
import type { LibraryTrack, TagGroup, TagRef } from "../../../common/lyre/api";
import { tagValue } from "../../../common/lyre/text";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { useAnnounce } from "../../shell/Announcer";
import { plural } from "./model";

export interface TagSheetProps {
  tracks: LibraryTrack[];
  groups: TagGroup[];
  onClose: () => void;
  /** Applies the change; resolves when done (the sheet closes then). */
  onApply: (mode: "add" | "remove", tags: TagRef[]) => Promise<void>;
}

export function TagSheet({ tracks, groups, onClose, onApply }: TagSheetProps) {
  const { say } = useAnnounce();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [picked, setPicked] = useState<TagRef[]>([]);
  const [made, setMade] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const n = tracks.length;
  const has = (g: string, v: string) => tracks.filter((t) => (t.tags[g] ?? []).includes(v)).length;
  const isPicked = (g: string, v: string) => picked.some((p) => p.group === g && p.value === v);
  const toggle = (g: string, v: string) => setPicked(isPicked(g, v) ? picked.filter((p) => !(p.group === g && p.value === v)) : [...picked, { group: g, value: v }]);

  const create = (g: TagGroup) => {
    const v = tagValue(typed[g.id] ?? "");
    if (!v) return;
    const known = [...g.values, ...(made[g.id] ?? [])].find((x) => x.toLowerCase() === v.toLowerCase());
    const value = known ?? v;
    if (!known) setMade({ ...made, [g.id]: [...(made[g.id] ?? []), v] });
    if (!isPicked(g.id, value)) setPicked([...picked, { group: g.id, value }]);
    setTyped({ ...typed, [g.id]: "" });
    say(known ? `${value} ticked` : `Created ${value} in ${g.name} and ticked it`);
  };

  // Picks in the order of the groups, as the message lists them.
  const ordered = groups.flatMap((g) => picked.filter((p) => p.group === g.id));
  const k = ordered.length;
  const label = k ? (mode === "add" ? `Add ${plural(k, "tag")} to ${plural(n, "track")}` : `Remove ${plural(k, "tag")} from ${plural(n, "track")}`) : "Tick a tag first";

  return (
    <Dialog
      open
      title={`Tag ${plural(n, "track")}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={mode === "remove" ? "danger" : "primary"}
            disabled={!k || busy}
            onClick={async () => {
              setBusy(true);
              await onApply(mode, ordered);
            }}
          >
            {label}
          </Button>
        </>
      }
    >
      <p className="muted lb-tsintro">&quot;All&quot; or &quot;2 of 3&quot; on a tag: how many of the {plural(n, "selected track")} have it already.</p>
      <div className="seg s lb-seg24" role="group" aria-label="Add or remove">
        <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")}>
          <Icon name="plus" size="s" />
          Add tags
        </button>
        <button
          type="button"
          aria-pressed={mode === "remove"}
          onClick={() => {
            setMode("remove");
            // Only tags some of the tracks have can be removed.
            setPicked(picked.filter((p) => has(p.group, p.value) > 0));
          }}
        >
          <Icon name="minus" size="s" />
          Remove tags
        </button>
      </div>
      {groups.map((g) => (
        <fieldset key={g.id} className="lb-tsg">
          <legend>{g.name}</legend>
          <div className="chips">
            {[...g.values, ...(made[g.id] ?? [])].map((v) => {
              const count = has(g.id, v);
              const on = isPicked(g.id, v);
              const cover = count === n ? "all" : count ? `${count} of ${n}` : "";
              return (
                <button
                  key={v}
                  type="button"
                  className="chip lb-tsc"
                  aria-pressed={on}
                  disabled={mode === "remove" && !count}
                  aria-label={`${v}, ${cover === "all" ? "all have it" : cover ? `${cover} have it` : "none have it"}`}
                  onClick={() => toggle(g.id, v)}
                >
                  {on && <Icon name="check" size="s" />}
                  {v}
                  {cover && <span className="lb-cov">{cover}</span>}
                </button>
              );
            })}
          </div>
          {mode === "add" && (
            <div className="lb-tsnew">
              <input
                className="input"
                value={typed[g.id] ?? ""}
                placeholder={`New ${g.name.toLowerCase()} value`}
                aria-label={`New ${g.name} value`}
                onChange={(e) => setTyped({ ...typed, [g.id]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create(g);
                  }
                }}
              />
              <button type="button" className="btn s" onClick={() => create(g)}>
                Create
              </button>
            </div>
          )}
        </fieldset>
      ))}
    </Dialog>
  );
}
