/**
 * Tags (#/tags; DAT-10, design/prototype/src/views/r7tags.js): the game master's tag vocabulary. One box per group
 * (Mood, Leitmotif, Scene type and his own) in the order he keeps; each tag with its colour dot, its name and how many
 * tracks it finds, indented under the tag it sits inside. A tag's ⋯ renames, merges, nests, adds other words, colours,
 * moves and deletes it; Rename, Merge and Delete change every track and dynamic rule in one step with Undo. Opened from
 * the Library's ⋯ (Tags and groups…) and Look and feel (Tag colours…). A tag's name always shows with its colour.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PadColor, TagGroup, TagRef } from "../../../common/lyre/api";
import { isRefused } from "../../../common/lyre/api";
import { tagTreeOf } from "../../../common/lyre/lookup";
import { useLyreApi, useTagGroups, useTracks } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { MenuButton, type MenuEntry } from "../../kit/Menu";
import { Pane } from "../../kit/Pane";
import { useAnnounce } from "../../shell/Announcer";
import { TopLead } from "../../shell/TopBar";
import { useSave } from "../../shell/useSave";
import { useUndoNote } from "../../shell/UndoNote";
import { PAD_COLOUR } from "../boards/boardModel";
import type { ScreenProps } from "..";
import { COLOUR_CHOICES, childrenOf, colourName, orderedTags, otherTags, ownCount, sameLevel, tagCount, tagWords, tracksText, type ShownTag } from "./tagsModel";
import "./tags.css";

/** The dialog open now, with the group (and tag) it is for. */
type Sheet =
  | { kind: "rename" | "merge" | "delete" | "inside" | "words" | "colour"; group: TagGroup; tag: string }
  | { kind: "groupRename" | "groupColour" | "groupDelete" | "addTag"; group: TagGroup }
  | { kind: "newGroup" };

/** Lyre's starting vocabulary, offered again when every group is gone (r7tags.js STARTER). */
const STARTER: [string, string[]][] = [
  ["Mood", ["Melancholy", "Heroic", "Tense", "Wistful", "Warm", "Triumphant", "Eerie"]],
  ["Leitmotif", []],
  ["Scene type", ["Combat", "Exploration", "Tavern", "Travel", "Rest"]],
];

/** The data-k of a tag's ⋯ and of a group's buttons, so focus can find them again after the list is drawn anew. */
const tagKey = (groupId: string, tag: string) => `tg-more-${groupId}-${tag}`;

export function TagsScreen(_props: ScreenProps) {
  const api = useLyreApi();
  const groups = useTagGroups().data;
  const tracks = useTracks().data ?? [];
  const save = useSave();
  const { offer } = useUndoNote();
  const { say, toast } = useAnnounce();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const tree = useMemo(() => tagTreeOf(groups ?? []), [groups]);

  // After a change the lists are drawn anew; focus goes to the control named here once it is on the page.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    const k = CSS.escape(key);
    const el = document.querySelector<HTMLElement>(`[data-k="${k}"], [data-k-wrap="${k}"] button`);
    if (el) {
      focusNext.current = null;
      el.focus();
    }
  });
  const close = () => setSheet(null);
  const thenFocus = (key: string) => {
    focusNext.current = key;
  };

  /** Rename, merge and delete: one undoable step for every track, said in the Undo note. */
  const changeEveryTrack = async (write: () => Promise<Awaited<ReturnType<typeof api.tags.renameTag>>>, words: (n: number) => string, focus: string, focusAfterUndo: string) => {
    const result = await write();
    if (isRefused(result)) {
      toast(result.refusal.message);
      return;
    }
    close();
    thenFocus(focus);
    const text = words(result.value.tracks);
    // UX-R19: Undo puts focus back where the change was made from.
    offer(text, result.undoLabel, `[data-k="${focusAfterUndo}"], [data-k-wrap="${focusAfterUndo}"] button`);
    say(`${text}. Undo is at the bottom right, or press Ctrl+Z.`);
  };

  const ref = (group: TagGroup, tag: string): TagRef => ({ group: group.id, value: tag });

  const tagMenu = (group: TagGroup, tag: string): MenuEntry[] => {
    const level = sameLevel(group, tag);
    const at = level.indexOf(tag);
    const move = (by: -1 | 1) => (): void =>
      void save(`order of ${group.name} tags`, () => api.tags.moveTag(ref(group, tag), by), { key: `tg-ord-${group.id}` }).then(() => thenFocus(tagKey(group.id, tag)));
    return [
      { label: "Rename…", icon: "edit", onSelect: () => setSheet({ kind: "rename", group, tag }) },
      { label: "Merge into…", icon: "link", onSelect: () => setSheet({ kind: "merge", group, tag }) },
      { label: "Put inside…", icon: "folder", onSelect: () => setSheet({ kind: "inside", group, tag }) },
      { label: "Other words…", icon: "search", onSelect: () => setSheet({ kind: "words", group, tag }) },
      { label: "Colour…", icon: "palette", onSelect: () => setSheet({ kind: "colour", group, tag }) },
      ...(at > 0 ? [{ label: "Move up", icon: "chevup" as const, onSelect: move(-1) }] : []),
      ...(at < level.length - 1 ? [{ label: "Move down", icon: "chevdown" as const, onSelect: move(1) }] : []),
      { separator: true },
      { label: "Delete…", icon: "trash", danger: true, onSelect: () => setSheet({ kind: "delete", group, tag }) },
    ];
  };

  const groupMenu = (group: TagGroup, index: number, count: number): MenuEntry[] => {
    const move = (by: -1 | 1) => (): void =>
      void save("order of tag groups", () => api.tags.moveGroup(group.id, by), { key: "tg-gord" }).then(() => thenFocus(`tg-gmore-${group.id}`));
    return [
      { label: "Rename group…", icon: "edit", onSelect: () => setSheet({ kind: "groupRename", group }) },
      { label: "Colour…", icon: "palette", onSelect: () => setSheet({ kind: "groupColour", group }) },
      ...(index > 0 ? [{ label: "Move up", icon: "chevup" as const, onSelect: move(-1) }] : []),
      ...(index < count - 1 ? [{ label: "Move down", icon: "chevdown" as const, onSelect: move(1) }] : []),
      { separator: true },
      { label: "Delete group…", icon: "trash", danger: true, onSelect: () => setSheet({ kind: "groupDelete", group }) },
    ];
  };

  const startWithLyresTags = async () => {
    for (const [name, tags] of STARTER) {
      const made = await api.tags.createGroup(name);
      if (isRefused(made)) {
        toast(made.refusal.message);
        return;
      }
      for (const tag of tags) await api.tags.createTag(made.value.id, tag);
    }
    say("Saved: Lyre's starting tags");
  };

  const list = groups ?? [];
  return (
    <>
      <div className="viewhead">
        <TopLead />
        <h1>Tags</h1>
        <span className="grow" />
        <Button icon="plus" data-k="tg-newgroup" onClick={() => setSheet({ kind: "newGroup" })}>
          New group
        </Button>
      </div>
      <div className="viewbody tg-body" data-scroll="body">
        {groups === undefined ? null : list.length ? (
          <div className="tg-grid">
            {list.map((g, i) => (
              <Pane
                key={g.id}
                id={`tg-${g.id}`}
                title={g.name}
                icon="tag"
                kind="plain"
                size="auto"
                noMax
                className="tg-pane"
                actions={
                  <>
                    <Button size="s" icon="plus" data-k={`tg-add-${g.id}`} onClick={() => setSheet({ kind: "addTag", group: g })}>
                      Add tag
                    </Button>
                    <span data-k-wrap={`tg-gmore-${g.id}`}>
                      <MenuButton label={`More for the ${g.name} group`} icon="more" size="s" className="ghost" items={groupMenu(g, i, list.length)} />
                    </span>
                  </>
                }
              >
                {g.values.length ? (
                  <ul className="list tg-list" aria-label={`${g.name} tags`}>
                    {orderedTags(g).map((shown) => (
                      <TagRow key={shown.info.name} group={g} shown={shown} count={tagCount(tracks, g.id, shown.info.name, tree)} menu={tagMenu(g, shown.info.name)} />
                    ))}
                  </ul>
                ) : (
                  <p className="empty">No tags yet.</p>
                )}
              </Pane>
            ))}
          </div>
        ) : (
          <div className="empty">
            <b>No tag groups.</b>{" "}
            <Button size="s" onClick={() => void startWithLyresTags()}>
              Use Lyre&apos;s starting tags
            </Button>
          </div>
        )}
      </div>
      {sheet && (
        <TagSheet
          sheet={sheet}
          tracksWith={(g, tag) => ownCount(tracks, g.id, tag)}
          tracksInGroup={(g) => tracks.filter((t) => (t.tags[g.id] ?? []).length > 0).length}
          onClose={close}
          onRename={(g, tag, name) =>
            void changeEveryTrack(() => api.tags.renameTag(ref(g, tag), name), (n) => `Renamed ${tag} to ${name} on ${tracksText(n)}`, tagKey(g.id, name), tagKey(g.id, tag))
          }
          onMerge={(g, tag, into) =>
            void changeEveryTrack(() => api.tags.mergeTag(ref(g, tag), into), (n) => `Merged ${tag} into ${into} on ${tracksText(n)}`, tagKey(g.id, into), tagKey(g.id, tag))
          }
          onDelete={(g, tag) => void changeEveryTrack(() => api.tags.deleteTag(ref(g, tag)), (n) => `Deleted ${tag} from ${tracksText(n)}`, `tg-add-${g.id}`, tagKey(g.id, tag))}
          onDeleteGroup={(g) => void changeEveryTrack(() => api.tags.deleteGroup(g.id), (n) => `Deleted the ${g.name} group from ${tracksText(n)}`, "tg-newgroup", `tg-gmore-${g.id}`)}
          onWrite={async (what, write, focus) => {
            const done = await save(what, write);
            if (done) {
              close();
              if (focus) thenFocus(focus);
            }
          }}
          api={api}
        />
      )}
    </>
  );
}

function TagRow({ group, shown, count, menu }: { group: TagGroup; shown: ShownTag; count: number; menu: MenuEntry[] }) {
  const { info, depth } = shown;
  const words = tagWords(info, count);
  const id = `tgd-${group.id}-${info.name.replace(/\W/g, "_")}`;
  const colour = info.color ?? group.color;
  return (
    <li className="tg-row" style={{ "--depth": depth } as React.CSSProperties} aria-describedby={id} title={words}>
      <span className="chip tg-chip">
        <span className={`dot tgdot-${group.id}`} style={colour ? { background: PAD_COLOUR[colour].hex } : undefined} />
        {/* UX-6: a name cut short has its full text on hover. */}
        <span className="ellipsis" title={info.name}>
          {info.name}
        </span>
      </span>
      <span className="sr-only" id={id}>
        {words}
      </span>
      <span className="grow" />
      <span className="num faint" aria-hidden="true">
        {count}
      </span>
      <span data-k-wrap={tagKey(group.id, info.name)}>
        <MenuButton label={`More for ${info.name}`} icon="more" size="s" className="ghost" items={menu} />
      </span>
    </li>
  );
}

type Write = Parameters<ReturnType<typeof useSave>>[1];

interface SheetProps {
  sheet: Sheet;
  api: ReturnType<typeof useLyreApi>;
  tracksWith: (group: TagGroup, tag: string) => number;
  tracksInGroup: (group: TagGroup) => number;
  onClose: () => void;
  onRename: (group: TagGroup, tag: string, name: string) => void;
  onMerge: (group: TagGroup, tag: string, into: string) => void;
  onDelete: (group: TagGroup, tag: string) => void;
  onDeleteGroup: (group: TagGroup) => void;
  onWrite: (what: string, write: Write, focus?: string) => Promise<void>;
}

/** Every dialog of the screen: a name, a choice of tag, other words, a colour, or a question before deleting. */
function TagSheet({ sheet, api, tracksWith, tracksInGroup, onClose, onRename, onMerge, onDelete, onDeleteGroup, onWrite }: SheetProps) {
  const { toast } = useAnnounce();
  const group = sheet.kind === "newGroup" ? null : sheet.group;
  const tag = "tag" in sheet ? sheet.tag : "";
  const info = group?.tags.find((t) => t.name === tag);
  const firstChoice = group && tag ? (otherTags(group, tag)[0]?.info.name ?? "") : "";
  const [name, setName] = useState(sheet.kind === "rename" ? tag : sheet.kind === "groupRename" ? (group?.name ?? "") : "");
  const [choice, setChoice] = useState(sheet.kind === "merge" ? firstChoice : sheet.kind === "inside" ? (info?.parent ?? "") : "");
  const [words, setWords] = useState((info?.also ?? []).join(", "));
  const [colour, setColour] = useState<string>((sheet.kind === "groupColour" ? group?.color : info?.color) ?? "");

  const nameField = (placeholder?: string) => (
    <div className="field">
      <label htmlFor="tg-name">Name</label>
      <input className="input" id="tg-name" autoComplete="off" value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
    </div>
  );
  const tagSelect = (label: string, first?: string) => (
    <div className="field">
      <label htmlFor="tg-choice">{label}</label>
      <select className="input" id="tg-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {first !== undefined && <option value="">{first}</option>}
        {group &&
          otherTags(group, tag).map((t) => (
            <option key={t.info.name} value={t.info.name}>
              {" ".repeat(t.depth)}
              {t.info.name}
            </option>
          ))}
      </select>
    </div>
  );
  const footer = (label: string, act: () => void) => (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={act}>
        {label}
      </Button>
    </>
  );
  const named = (then: (value: string) => void) => () => {
    const value = name.trim();
    if (!value) toast("Give it a name");
    else then(value);
  };
  const colourPicker = (own: boolean) => (
    <>
      <div className="tg-colours" role="radiogroup" aria-label="Colour">
        {[["", own ? "The group's colour" : "None"], ...COLOUR_CHOICES.map((c) => [c, colourName(c)])].map(([value, label]) => (
          <label key={value} className="lk-radio tg-col">
            <input type="radio" name="tg-col" value={value} checked={colour === value} onChange={() => setColour(value)} />
            <span className="tg-sw" style={{ background: value ? PAD_COLOUR[value as PadColor].hex : "transparent" }} aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="hint">The name always shows with its colour.</p>
    </>
  );
  const chosenColour = (colour || null) as PadColor | null;

  switch (sheet.kind) {
    case "newGroup":
      return (
        <Dialog enterSubmits open title="New group" onClose={onClose} footer={footer("Add group", named((n) => void onWrite(`tag group “${n}”`, () => api.tags.createGroup(n))))}>
          {nameField("For example Faction")}
        </Dialog>
      );
    case "addTag": {
      const g = sheet.group;
      return (
        <Dialog enterSubmits
          open
          title={`Add a tag to ${g.name}`}
          onClose={onClose}
          footer={footer(
            "Add tag",
            named((n) => {
              if (g.values.includes(n)) toast(`${n} is already here`);
              else void onWrite(`tag “${n}” in ${g.name}`, () => api.tags.createTag(g.id, n, choice || null), tagKey(g.id, n));
            }),
          )}
        >
          {nameField()}
          {g.values.length > 0 && tagSelect("Inside", "Nothing: a tag of its own")}
        </Dialog>
      );
    }
    case "rename":
      return (
        <Dialog enterSubmits
          open
          title={`Rename ${tag}`}
          onClose={onClose}
          footer={footer(
            "Rename",
            named((n) => {
              if (n === tag) onClose();
              else if (sheet.group.values.includes(n)) toast(`${n} is already a tag here: use Merge into… instead`);
              else onRename(sheet.group, tag, n);
            }),
          )}
        >
          {nameField()}
        </Dialog>
      );
    case "merge":
      return (
        <Dialog open title={`Merge ${tag}`} onClose={onClose} footer={footer("Merge", () => choice && onMerge(sheet.group, tag, choice))}>
          {tagSelect(`Merge ${tag} into`)}
          <p className="hint">Its tracks get the other tag. Typing {tag.toLowerCase()} still finds it.</p>
        </Dialog>
      );
    case "delete": {
      const kids = childrenOf(sheet.group, tag);
      return (
        <Dialog open title={`Delete ${tag}?`} onClose={onClose} footer={footer("Delete", () => onDelete(sheet.group, tag))}>
          <p>
            It comes off {tracksText(tracksWith(sheet.group, tag))}.
            {kids.length > 0 && ` ${kids.join(", ")} move${kids.length === 1 ? "s" : ""} up a level.`}
          </p>
        </Dialog>
      );
    }
    case "inside":
      return (
        <Dialog
          open
          title={`Put ${tag} inside`}
          onClose={onClose}
          footer={footer("Done", () =>
            void onWrite(choice ? `${tag} inside ${choice}` : `${tag} as a tag of its own`, () => api.tags.updateTag({ group: sheet.group.id, value: tag }, { parent: choice || null }), tagKey(sheet.group.id, tag)),
          )}
        >
          {tagSelect("Inside", "Nothing: a tag of its own")}
        </Dialog>
      );
    case "words":
      return (
        <Dialog
          open
          title={`Other words for ${tag}`}
          onClose={onClose}
          footer={footer("Done", () => {
            const also = words
              .split(",")
              .map((w) => w.trim().toLowerCase())
              .filter(Boolean);
            void onWrite(`other words for ${tag}`, () => api.tags.updateTag({ group: sheet.group.id, value: tag }, { also }), tagKey(sheet.group.id, tag));
          })}
        >
          <div className="field">
            <label htmlFor="tg-also">Other words, separated by commas</label>
            <input className="input" id="tg-also" autoComplete="off" placeholder="For example sad, sorrowful" value={words} onChange={(e) => setWords(e.target.value)} />
          </div>
          <p className="hint">Typing one of them while tagging offers {tag}.</p>
        </Dialog>
      );
    case "colour":
      return (
        <Dialog
          open
          title={`Colour of ${tag}`}
          onClose={onClose}
          footer={footer("Done", () => void onWrite(`${tag} colour`, () => api.tags.updateTag({ group: sheet.group.id, value: tag }, { color: chosenColour }), tagKey(sheet.group.id, tag)))}
        >
          {colourPicker(true)}
        </Dialog>
      );
    case "groupColour":
      return (
        <Dialog
          open
          title={`Colour of ${sheet.group.name}`}
          onClose={onClose}
          footer={footer("Done", () => void onWrite(`${sheet.group.name} colour`, () => api.tags.updateGroup(sheet.group.id, { color: chosenColour }), `tg-gmore-${sheet.group.id}`))}
        >
          {colourPicker(false)}
        </Dialog>
      );
    case "groupRename":
      return (
        <Dialog
          open
          title={`Rename the ${sheet.group.name} group`}
          onClose={onClose}
          footer={footer("Rename", named((n) => void onWrite(`group name “${n}”`, () => api.tags.updateGroup(sheet.group.id, { name: n }), `tg-gmore-${sheet.group.id}`)))}
        >
          {nameField()}
        </Dialog>
      );
    case "groupDelete":
      return (
        <Dialog open title={`Delete the ${sheet.group.name} group?`} onClose={onClose} footer={footer("Delete", () => onDeleteGroup(sheet.group))}>
          <p>
            Its {sheet.group.values.length} tags come off {tracksText(tracksInGroup(sheet.group))}.
          </p>
        </Dialog>
      );
  }
}
