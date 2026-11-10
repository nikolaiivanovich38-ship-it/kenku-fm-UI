/**
 * ORG-4 (design round 7, r7org.js): folders on the Playlists and Pad boards pages. A folder row folds and unfolds
 * and says how many it holds; its ⋯ has Rename…, New folder inside…, Colour… and Delete folder (what was in it moves
 * up a level, with Undo). A playlist or board goes in with its ⋯ › Move to folder… (which can make a New folder…
 * holding it) or by dragging it onto the folder row. There is no New folder button: an empty folder is rarely wanted.
 * Folding is kept on this computer, like an open box; a search or filter shows the folders holding what it found, open.
 */
import React, { useState } from "react";
import { folderPath } from "../../../common/domain/round7";
import type { FolderInfo, FolderKind, PadColor } from "../../../common/lyre/api";
import { isRefused } from "../../../common/lyre/api";
import { useLyreApi, useOrgFolders } from "../../api";
import { Button } from "../../kit/Button";
import { Dialog } from "../../kit/Dialog";
import { Icon } from "../../kit/Icon";
import { MenuButton, type MenuEntry } from "../../kit/Menu";
import { useAnnounce } from "../../shell/Announcer";
import { useSave } from "../../shell/useSave";
import { useUndoNote } from "../../shell/UndoNote";
import { PAD_COLOUR } from "../boards/boardModel";
import { COLOUR_CHOICES, colourName } from "../tags/tagsModel";
import { folderTree, type FolderNode } from "./folderModel";
import "./folders.css";

const WORDS: Record<FolderKind, [string, string]> = { playlists: ["playlist", "playlists"], boards: ["board", "boards"] };
const count = (kind: FolderKind, n: number) => `${n} ${WORDS[kind][n === 1 ? 0 : 1]}`;

/** What a drag of a playlist or board carries, so a folder row knows it can take it. */
export const ORG_DRAG_TYPE = "application/x-lyre-org-item";
export function orgDragProps(kind: FolderKind, id: string): Pick<React.HTMLAttributes<HTMLElement>, "onDragStart"> & { draggable: true } {
  return {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData(ORG_DRAG_TYPE, `${kind}:${id}`);
      event.dataTransfer.effectAllowed = "copyMove";
    },
  };
}

/* ---------- folded folders, kept on this computer ---------- */
const CLOSED_KEY = "lyre-folders-closed";
function readClosed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function keepClosed(closed: Set<string>): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]));
  } catch {
    /* storage unavailable: folding lasts for this visit only */
  }
}

type Sheet = { kind: "new"; parentId: string | null; moveIn?: { id: string; name: string } } | { kind: "rename"; folder: FolderInfo } | { kind: "colour"; folder: FolderInfo } | { kind: "moveTo"; itemId: string; name: string; current: string | null };

/** One kind's folders, their dialogs and the ⋯ entry for an item. Draw the list with `list`. */
export function useFolders(kind: FolderKind) {
  const api = useLyreApi();
  const folders = useOrgFolders(kind).data ?? [];
  const save = useSave();
  const { offer } = useUndoNote();
  const { say, toast } = useAnnounce();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [closed, setClosed] = useState(readClosed);
  const [over, setOver] = useState<string | null>(null);

  const setFolded = (id: string, fold: boolean) => {
    const next = new Set(closed);
    if (fold) next.add(id);
    else next.delete(id);
    keepClosed(next);
    setClosed(next);
  };
  const moveInto = async (itemId: string, folder: FolderInfo | null, itemName: string) => {
    if (folder) setFolded(folder.id, false);
    await save(folder ? `${itemName} in ${folder.name}` : `${itemName} out of its folder`, () => api.folders.moveInto(kind, itemId, folder?.id ?? null));
  };
  const deleteFolder = async (folder: FolderInfo) => {
    const result = await api.folders.delete(folder.id);
    if (isRefused(result)) {
      toast(result.refusal.message);
      return;
    }
    const text = `Deleted the folder ${folder.name}; what was in it moved up a level.`;
    offer(text, result.undoLabel);
    say(text);
  };
  const folderMenu = (folder: FolderInfo): MenuEntry[] => [
    { label: "Rename…", icon: "edit", onSelect: () => setSheet({ kind: "rename", folder }) },
    { label: "New folder inside…", icon: "folder", onSelect: () => setSheet({ kind: "new", parentId: folder.id }) },
    { label: "Colour…", icon: "palette", onSelect: () => setSheet({ kind: "colour", folder }) },
    { separator: true },
    { label: "Delete folder", icon: "trash", onSelect: () => void deleteFolder(folder) },
  ];

  /** The ⋯ entry of a playlist or board. */
  const moveToEntry = (item: { id: string; folderId: string | null }, name: string): MenuEntry => ({
    label: "Move to folder…",
    icon: "folder",
    onSelect: () => setSheet({ kind: "moveTo", itemId: item.id, name, current: item.folderId }),
  });

  /**
   * The list: folders first at each level, then the items. `nameOf` names an item for the Saved pop-up after a drop.
   */
  function list<T extends { id: string; folderId: string | null }>(props: {
    label: string;
    className: string;
    all: readonly T[];
    shown: readonly T[];
    filtered: boolean;
    renderItem: (item: T) => React.ReactNode;
    nameOf: (id: string) => string;
  }) {
    const tree = folderTree(folders, props.all, props.shown, props.filtered);
    const drop = (folder: FolderInfo): React.HTMLAttributes<HTMLDivElement> => ({
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes(ORG_DRAG_TYPE)) return;
        // Handled here: the page's drop guard (SEC-7) would otherwise refuse the drop.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        if (over !== folder.id) setOver(folder.id);
      },
      onDragLeave: () => setOver((o) => (o === folder.id ? null : o)),
      onDrop: (event) => {
        const data = event.dataTransfer.getData(ORG_DRAG_TYPE);
        setOver(null);
        if (!data.startsWith(`${kind}:`)) return;
        event.preventDefault();
        event.stopPropagation();
        const id = data.slice(kind.length + 1);
        void moveInto(id, folder, props.nameOf(id));
      },
    });
    const node = (n: FolderNode<T>): React.ReactNode => {
      const open = props.filtered || !closed.has(n.folder.id);
      const path = folderPath(folders, n.folder.id);
      return (
        <li key={`fo-${n.folder.id}`} className={n.folder.color ? "fo fo-c" : "fo"} style={n.folder.color ? ({ "--fo": PAD_COLOUR[n.folder.color].hex } as React.CSSProperties) : undefined}>
          <div className={over === n.folder.id ? "fo-row fo-over" : "fo-row"} {...drop(n.folder)}>
            <button
              type="button"
              className="fo-toggle"
              data-k={`fo-${n.folder.id}`}
              aria-expanded={open}
              aria-label={`Folder ${n.folder.name}, ${count(kind, n.total)}`}
              title={`${path}: drop ${WORDS[kind][1]} here`}
              onClick={() => {
                setFolded(n.folder.id, open);
                say(`${n.folder.name} ${open ? "folded" : "open"}`);
              }}
            >
              <Icon name="chevdown" size="s" className="chev" />
              <Icon name="folder" size="s" className="fo-i" />
              <span className="ellipsis">{n.folder.name}</span>
              <span className="num faint fo-n">{count(kind, n.total)}</span>
            </button>
            <MenuButton label={`More for the folder ${n.folder.name}`} icon="more" size="s" className="ghost" items={folderMenu(n.folder)} />
          </div>
          {open && (
            <ul className={`fo-in ${props.className}`} aria-label={`In ${n.folder.name}`}>
              {n.folders.map(node)}
              {n.items.map(props.renderItem)}
            </ul>
          )}
        </li>
      );
    };
    return (
      <ul className={props.className} aria-label={props.label}>
        {tree.folders.map(node)}
        {tree.items.map(props.renderItem)}
      </ul>
    );
  }

  const dialogs = sheet && (
    <FolderSheet
      sheet={sheet}
      folders={folders}
      onClose={() => setSheet(null)}
      onNew={async (name, parentId, moveIn) => {
        // Move to folder… › New folder… makes the folder with that playlist or board in it.
        const done = await save(moveIn ? `${moveIn.name} in ${name}` : `folder “${name}”`, () => api.folders.create(kind, { name, parentId, ...(moveIn ? { moveIn: moveIn.id } : {}) }));
        if (!done) return;
        if (parentId) setFolded(parentId, false);
        setSheet(null);
      }}
      onMoveTo={(itemId, name, folder) => {
        setSheet(null);
        void moveInto(itemId, folder, name);
      }}
      onNewFrom={(itemId, name) => setSheet({ kind: "new", parentId: null, moveIn: { id: itemId, name } })}
      onRename={async (folder, name) => {
        if (await save(`folder name “${name}”`, () => api.folders.update(folder.id, { name }))) setSheet(null);
      }}
      onColour={async (folder, color) => {
        if (await save(`${folder.name} colour`, () => api.folders.update(folder.id, { color }))) setSheet(null);
      }}
    />
  );

  /** Move to folder… for a playlist or board, from a menu of its own. */
  const openMoveTo = (item: { id: string; folderId: string | null }, name: string) => setSheet({ kind: "moveTo", itemId: item.id, name, current: item.folderId });

  return { folders, list, moveToEntry, openMoveTo, dialogs };
}

function FolderSheet({
  sheet,
  folders,
  onClose,
  onNew,
  onMoveTo,
  onNewFrom,
  onRename,
  onColour,
}: {
  sheet: Sheet;
  folders: readonly FolderInfo[];
  onClose: () => void;
  onNew: (name: string, parentId: string | null, moveIn: { id: string; name: string } | undefined) => Promise<void>;
  onMoveTo: (itemId: string, name: string, folder: FolderInfo | null) => void;
  onNewFrom: (itemId: string, name: string) => void;
  onRename: (folder: FolderInfo, name: string) => Promise<void>;
  onColour: (folder: FolderInfo, color: PadColor | null) => Promise<void>;
}) {
  const { toast } = useAnnounce();
  const [name, setName] = useState(sheet.kind === "rename" ? sheet.folder.name : "");
  const [choice, setChoice] = useState(sheet.kind === "moveTo" ? (sheet.current ?? "") : sheet.kind === "colour" ? (sheet.folder.color ?? "") : "");
  const named = (then: (value: string) => void) => () => {
    const value = name.trim();
    if (!value) toast("Give the folder a name");
    else then(value);
  };
  const nameField = (
    <div className="field">
      <label htmlFor="fo-name">Name</label>
      <input className="input" id="fo-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
    </div>
  );
  if (sheet.kind === "new") {
    return (
      <Dialog
        open
        title="New folder"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={named((n) => void onNew(n, sheet.parentId, sheet.moveIn))}>
              Add folder
            </Button>
          </>
        }
      >
        {nameField}
      </Dialog>
    );
  }
  if (sheet.kind === "rename") {
    return (
      <Dialog
        open
        title={`Rename ${sheet.folder.name}`}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={named((n) => void onRename(sheet.folder, n))}>
              Rename
            </Button>
          </>
        }
      >
        {nameField}
      </Dialog>
    );
  }
  if (sheet.kind === "colour") {
    return (
      <Dialog
        open
        title={`Colour of ${sheet.folder.name}`}
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void onColour(sheet.folder, (choice || null) as PadColor | null)}>
              Done
            </Button>
          </>
        }
      >
        <div className="tg-colours" role="radiogroup" aria-label="Colour">
          {[["", "None"], ...COLOUR_CHOICES.map((c) => [c, colourName(c)])].map(([value, label]) => (
            <label key={value} className="lk-radio tg-col">
              <input type="radio" name="fo-col" value={value} checked={choice === value} onChange={() => setChoice(value)} />
              <span className="tg-sw" style={{ background: value ? PAD_COLOUR[value as PadColor].hex : "transparent" }} aria-hidden="true" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      title={`Move ${sheet.name} to`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button icon="folder" onClick={() => onNewFrom(sheet.itemId, sheet.name)}>
            New folder…
          </Button>
          <Button variant="primary" onClick={() => onMoveTo(sheet.itemId, sheet.name, folders.find((f) => f.id === choice) ?? null)}>
            Move
          </Button>
        </>
      }
    >
      {folders.length ? (
        <div className="fo-pick" role="radiogroup" aria-label="Folder">
          {[["", "No folder"], ...folders.map((f) => [f.id, folderPath(folders, f.id)])].map(([value, label]) => (
            <label key={value} className="lk-radio">
              <input type="radio" name="fo-to" value={value} checked={choice === value} onChange={() => setChoice(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      ) : (
        <p>No folders yet. New folder… makes one with {sheet.name} in it.</p>
      )}
    </Dialog>
  );
}
